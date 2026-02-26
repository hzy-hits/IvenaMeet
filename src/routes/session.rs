use crate::error::{AppError, AppResult};
use crate::request_meta;
use crate::services::livekit::PublishPermission;
use crate::services::session::SessionClaims;
use crate::state::AppState;
use axum::{
    Json, Router,
    extract::State,
    http::{HeaderMap, header::AUTHORIZATION},
    routing::post,
};
use serde::Serialize;
use tracing::{info, warn};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/sessions/refresh", post(refresh_session))
        .route("/sessions/heartbeat", post(session_heartbeat))
}

#[derive(Serialize)]
struct RefreshResp {
    app_session_token: String,
    app_session_expires_in_seconds: u64,
}

#[derive(Serialize)]
struct SessionHeartbeatResp {
    ok: bool,
    app_session_expires_in_seconds: u64,
}

async fn refresh_session(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<RefreshResp>> {
    let request_id = request_meta::request_id(&headers);
    let token = bearer_from_headers(&headers)
        .ok_or_else(|| AppError::Unauthorized("missing app session token".to_string()))?;
    let mut redis = state.redis.clone();
    let (new_token, claims) = state
        .session_service
        .refresh(&mut redis, token, state.config.session_ttl_seconds)
        .await?;
    enforce_member_media_lease(
        &state,
        &mut redis,
        &claims,
        &request_id,
        "/sessions/refresh",
    )
    .await?;
    let owner = session_owner(&claims);
    let rotated = state
        .presence_service
        .touch_owner(
            &mut redis,
            &claims.room_id,
            &claims.user_name,
            &owner,
            state.config.session_ttl_seconds,
            now_ts(),
        )
        .await?;
    if !rotated {
        let _ = state.session_service.revoke(&mut redis, &new_token).await;
        warn!(
            request_id,
            route = "/sessions/refresh",
            room_id = claims.room_id,
            user_name = claims.user_name,
            result = "denied",
            "identity lock not owned by current session"
        );
        return Err(AppError::Unauthorized(
            "identity already in use".to_string(),
        ));
    }
    info!(
        request_id,
        route = "/sessions/refresh",
        room_id = claims.room_id,
        user_name = claims.user_name,
        result = "ok",
        "session refreshed"
    );

    Ok(Json(RefreshResp {
        app_session_token: new_token,
        app_session_expires_in_seconds: state.config.session_ttl_seconds,
    }))
}

async fn session_heartbeat(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<SessionHeartbeatResp>> {
    let request_id = request_meta::request_id(&headers);
    let token = bearer_from_headers(&headers)
        .ok_or_else(|| AppError::Unauthorized("missing app session token".to_string()))?;

    let mut redis = state.redis.clone();
    let claims = state.session_service.verify(&mut redis, token).await?;
    enforce_member_media_lease(
        &state,
        &mut redis,
        &claims,
        &request_id,
        "/sessions/heartbeat",
    )
    .await?;
    let owner = session_owner(&claims);
    let touched = state
        .presence_service
        .touch_owner(
            &mut redis,
            &claims.room_id,
            &claims.user_name,
            &owner,
            state.config.session_ttl_seconds,
            now_ts(),
        )
        .await?;
    if !touched {
        warn!(
            request_id,
            route = "/sessions/heartbeat",
            room_id = claims.room_id,
            user_name = claims.user_name,
            result = "denied",
            "identity lock not owned by current session"
        );
        return Err(AppError::Unauthorized(
            "identity already in use".to_string(),
        ));
    }
    info!(
        request_id,
        route = "/sessions/heartbeat",
        room_id = claims.room_id,
        user_name = claims.user_name,
        result = "ok",
        "session heartbeat accepted"
    );

    Ok(Json(SessionHeartbeatResp {
        ok: true,
        app_session_expires_in_seconds: state.config.session_ttl_seconds,
    }))
}

fn bearer_from_headers(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
}

fn session_owner(claims: &SessionClaims) -> String {
    claims
        .jti
        .as_deref()
        .filter(|v| !v.is_empty())
        .unwrap_or(&claims.user_name)
        .to_string()
}

fn now_ts() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

async fn enforce_member_media_lease(
    state: &AppState,
    redis: &mut redis::aio::ConnectionManager,
    claims: &SessionClaims,
    request_id: &str,
    route: &'static str,
) -> AppResult<()> {
    if claims.role != "member" {
        return Ok(());
    }

    let effective = state
        .stage_permission_service
        .resolve_member(
            redis,
            &claims.room_id,
            &claims.user_name,
            state.config.room_ttl_seconds,
            now_ts(),
        )
        .await?;

    if !(effective.expired_camera || effective.expired_screen_share) {
        return Ok(());
    }

    state
        .livekit_service
        .update_participant_publish_permission(
            &claims.room_id,
            &claims.user_name,
            PublishPermission {
                camera: effective.camera_allowed,
                screen_share: effective.screen_share_allowed,
            },
        )
        .await?;

    if effective.expired_camera {
        let _ = state
            .livekit_service
            .mute_participant_track_source(
                &claims.room_id,
                &claims.user_name,
                livekit_protocol::TrackSource::Camera,
                true,
            )
            .await?;
    }
    if effective.expired_screen_share {
        let _ = state
            .livekit_service
            .mute_participant_track_source(
                &claims.room_id,
                &claims.user_name,
                livekit_protocol::TrackSource::ScreenShare,
                true,
            )
            .await?;
    }

    warn!(
        request_id,
        route,
        room_id = claims.room_id,
        user_name = claims.user_name,
        expired_camera = effective.expired_camera,
        expired_screen_share = effective.expired_screen_share,
        result = "lease_expired",
        "member media grant lease expired; publish permission revoked"
    );

    Ok(())
}

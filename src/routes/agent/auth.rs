use crate::error::{AppError, AppResult};
use crate::middleware::control_auth::ControlPrincipal;
use crate::services::session::SessionClaims;
use crate::state::AppState;
use axum::http::{HeaderMap, header::AUTHORIZATION};
use tracing::warn;

pub(super) fn bearer_from_headers(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
}

pub(super) async fn verify_app_session_in_room(
    state: &AppState,
    headers: &HeaderMap,
    room_id: &str,
    request_id: &str,
    route: &'static str,
) -> AppResult<(String, SessionClaims, u64)> {
    let token = bearer_from_headers(headers)
        .ok_or_else(|| AppError::Unauthorized("missing app session token".to_string()))?;
    let mut redis = state.redis.clone();
    let claims = state.session_service.verify(&mut redis, token).await?;
    if claims.room_id != room_id {
        warn!(
            request_id,
            route,
            user_name = claims.user_name,
            token_room_id = claims.room_id,
            path_room_id = room_id,
            result = "denied",
            "agent app session room mismatch"
        );
        return Err(AppError::Unauthorized(
            "app session does not match room".to_string(),
        ));
    }
    let ttl = state.session_service.ttl_seconds(&mut redis, token).await?;
    Ok((token.to_string(), claims, ttl))
}

pub(super) async fn verify_control_principal(
    state: &AppState,
    headers: &HeaderMap,
) -> AppResult<ControlPrincipal> {
    let token = bearer_from_headers(headers)
        .ok_or_else(|| AppError::Unauthorized("missing control token".to_string()))?;

    if token == state.config.admin_token {
        return Ok(ControlPrincipal::Admin);
    }

    let mut redis = state.redis.clone();
    let claims = state
        .host_session_service
        .verify(&mut redis, token)
        .await
        .map_err(|_| AppError::Unauthorized("invalid control token".to_string()))?;
    if claims.role != "host" {
        return Err(AppError::Unauthorized(
            "control token is not host role".to_string(),
        ));
    }
    Ok(ControlPrincipal::Host(claims))
}

pub(super) async fn ensure_invite_scope(
    state: &AppState,
    principal: &ControlPrincipal,
    request_id: &str,
    route: &'static str,
    room_id: &str,
    host_identity: &str,
) -> AppResult<()> {
    if let ControlPrincipal::Host(claims) = principal {
        if claims.room_id != room_id || claims.user_name != host_identity {
            warn!(
                request_id,
                route,
                room_id,
                host_identity,
                token_room_id = claims.room_id,
                token_user_name = claims.user_name,
                result = "denied",
                "agent host token scope mismatch"
            );
            return Err(AppError::Unauthorized(
                "host token scope mismatch".to_string(),
            ));
        }
    }

    let room = state
        .storage_service
        .get_room_active(room_id.to_string())
        .await?
        .ok_or_else(|| AppError::BadRequest("room not active".to_string()))?;
    if room.host_identity != host_identity {
        warn!(
            request_id,
            route,
            room_id,
            host_identity,
            result = "denied",
            "agent host identity mismatch"
        );
        return Err(AppError::Unauthorized("host identity mismatch".to_string()));
    }
    Ok(())
}

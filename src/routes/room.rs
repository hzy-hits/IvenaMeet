use crate::error::{AppError, AppResult};
use crate::middleware::control_auth::ControlPrincipal;
use crate::request_meta;
use crate::services::livekit::{PublishPermission, UserRole};
use crate::services::stage_permission::MemberMediaPermission;
use crate::services::session::SessionClaims;
use crate::state::AppState;
use crate::validation;
use axum::{
    Json, Router,
    extract::{ConnectInfo, Extension, State},
    http::{HeaderMap, header::AUTHORIZATION},
    routing::post,
};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use tracing::{info, warn};

const JOIN_LOCK_TTL_SECONDS: u64 = 30;
const HOST_STALE_SECONDS: i64 = 60;
const MEMBER_STALE_SECONDS: i64 = 180;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/rooms/join", post(join_room))
        .route("/rooms/leave", post(leave_room))
        .route("/rooms/reconnect", post(reconnect_room))
}

pub fn control_router() -> Router<AppState> {
    Router::new().route("/rooms/host/force-reclaim", post(force_reclaim_host_lock))
}

#[derive(Deserialize)]
pub struct JoinReq {
    pub room_id: String,
    pub user_name: String,
    pub redeem_token: Option<String>,
    pub role: Option<String>,
    pub nickname: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Serialize)]
pub struct JoinResp {
    pub lk_url: String,
    pub token: String,
    pub expires_in_seconds: u64,
    pub role: String,
    pub camera_allowed: bool,
    pub screen_share_allowed: bool,
    pub nickname: String,
    pub avatar_url: Option<String>,
    pub app_session_token: String,
    pub app_session_expires_in_seconds: u64,
    pub host_session_token: Option<String>,
    pub host_session_expires_in_seconds: Option<u64>,
}

#[derive(Serialize)]
pub struct ReconnectResp {
    pub lk_url: String,
    pub token: String,
    pub expires_in_seconds: u64,
    pub role: String,
    pub camera_allowed: bool,
    pub screen_share_allowed: bool,
}

#[derive(Serialize)]
pub struct LeaveResp {
    pub released: bool,
}

#[derive(Deserialize)]
pub struct ForceReclaimReq {
    pub room_id: String,
    pub host_identity: String,
}

#[derive(Serialize)]
pub struct ForceReclaimResp {
    pub reclaimed: bool,
    pub reason: String,
    pub stale_age_seconds: i64,
}

async fn join_room(
    State(state): State<AppState>,
    peer: ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(req): Json<JoinReq>,
) -> AppResult<Json<JoinResp>> {
    let request_id = request_meta::request_id(&headers);
    let room_id = validation::room_id(&req.room_id)?;
    let user_name = validation::user_name(&req.user_name)?;

    let role = match req.role.as_deref() {
        None => UserRole::Member,
        Some(raw) => UserRole::from_str(raw)
            .ok_or_else(|| AppError::BadRequest("role must be host or member".to_string()))?,
    };

    if role == UserRole::Host {
        let token = bearer_from_headers(&headers).ok_or_else(|| {
            AppError::Unauthorized(
                "host join requires admin token or host session token".to_string(),
            )
        })?;
        if token != state.config.admin_token {
            let mut redis = state.redis.clone();
            let claims = state
                .host_session_service
                .verify(&mut redis, token)
                .await
                .map_err(|_| {
                    warn!(
                        request_id,
                        route = "/rooms/join",
                        room_id,
                        user_name,
                        "host join denied: invalid host session token"
                    );
                    AppError::Unauthorized("invalid host session token".to_string())
                })?;
            if claims.role != "host" || claims.room_id != room_id || claims.user_name != user_name {
                warn!(
                    request_id,
                    route = "/rooms/join",
                    room_id,
                    user_name,
                    token_room_id = claims.room_id,
                    token_user_name = claims.user_name,
                    token_role = claims.role,
                    "host join denied: host session scope mismatch"
                );
                return Err(AppError::Unauthorized(
                    "host session scope mismatch".to_string(),
                ));
            }
        }
        state
            .storage_service
            .ensure_room_for_host(
                room_id.clone(),
                user_name.clone(),
                state.config.room_ttl_seconds,
            )
            .await?;
    } else {
        let room = state
            .storage_service
            .get_room_active(room_id.clone())
            .await?
            .ok_or_else(|| AppError::BadRequest("room not active or expired".to_string()))?;
        if user_name == room.host_identity {
            warn!(
                request_id,
                route = "/rooms/join",
                room_id,
                user_name,
                role = "member",
                result = "denied",
                "member attempted to use host identity"
            );
            return Err(AppError::Unauthorized(
                "member cannot use host identity".to_string(),
            ));
        }
        if state.config.require_invite {
            let redeem_token = req
                .redeem_token
                .as_deref()
                .ok_or_else(|| AppError::BadRequest("redeem_token is required".to_string()))?;
            let mut redis = state.redis.clone();
            state
                .invite_service
                .consume_redeem(&mut redis, redeem_token, &room.room_id, &user_name)
                .await?;
        }
    }

    let ip = request_meta::client_ip(&state.config.trusted_proxy_ips, &headers, peer);
    let mut redis = state.redis.clone();
    state
        .rate_limit_service
        .check(
            &mut redis,
            "room_join",
            &ip,
            state.config.rate_limit_room_join,
            state.config.rate_limit_window_seconds,
        )
        .await?;

    let owner_hint = if role == UserRole::Member {
        if let Some(token) = bearer_from_headers(&headers) {
            let mut redis_for_hint = state.redis.clone();
            match state
                .session_service
                .verify(&mut redis_for_hint, token)
                .await
            {
                Ok(claims) if claims.room_id == room_id && claims.user_name == user_name => {
                    Some(session_owner(&claims))
                }
                _ => None,
            }
        } else {
            None
        }
    } else {
        None
    };
    let join_owner =
        owner_hint.unwrap_or_else(|| format!("join:{}", uuid::Uuid::new_v4().simple()));
    let stale_limit_seconds = if role == UserRole::Host {
        HOST_STALE_SECONDS
    } else {
        MEMBER_STALE_SECONDS
    };
    let mut acquired = state
        .presence_service
        .acquire_identity(
            &mut redis,
            &room_id,
            &user_name,
            &join_owner,
            JOIN_LOCK_TTL_SECONDS,
            now_ts(),
        )
        .await?;
    if !acquired {
        if let Some(current) = state
            .presence_service
            .get_state(&mut redis, &room_id, &user_name)
            .await?
        {
            let stale_age_seconds = if current.heartbeat_ts <= 0 {
                stale_limit_seconds + 1
            } else {
                now_ts().saturating_sub(current.heartbeat_ts)
            };

            let livekit_active = match state
                .livekit_service
                .is_identity_active(&room_id, &user_name)
                .await
            {
                Ok(v) => Some(v),
                Err(e) => {
                    warn!(
                        request_id,
                        route = "/rooms/join",
                        room_id,
                        user_name,
                        error = e.to_string(),
                        result = "livekit_probe_failed",
                        "identity activity probe failed; fallback to stale age"
                    );
                    None
                }
            };
            let should_reclaim =
                matches!(livekit_active, Some(false)) || stale_age_seconds > stale_limit_seconds;
            if should_reclaim {
                warn!(
                    request_id,
                    route = "/rooms/join",
                    room_id,
                    user_name,
                    current_owner = current.owner,
                    stale_age_seconds,
                    stale_limit_seconds,
                    livekit_active = match livekit_active {
                        Some(true) => "active",
                        Some(false) => "inactive",
                        None => "unknown",
                    },
                    result = "reclaiming_stale_lock",
                    "identity lock reclaiming before retry"
                );
                state
                    .presence_service
                    .force_delete(&mut redis, &room_id, &user_name)
                    .await?;
                let _ = state
                    .session_service
                    .revoke(&mut redis, &current.owner)
                    .await;
                acquired = state
                    .presence_service
                    .acquire_identity(
                        &mut redis,
                        &room_id,
                        &user_name,
                        &join_owner,
                        JOIN_LOCK_TTL_SECONDS,
                        now_ts(),
                    )
                    .await?;
            }
        }
    }
    if !acquired {
        warn!(
            request_id,
            route = "/rooms/join",
            room_id,
            user_name,
            ip,
            role = match role {
                UserRole::Host => "host",
                UserRole::Member => "member",
            },
            result = "denied",
            "identity already in use"
        );
        return Err(AppError::Unauthorized(
            "identity already in use".to_string(),
        ));
    }

    let nickname = req
        .nickname
        .as_deref()
        .map(validation::nickname)
        .transpose()?
        .unwrap_or_else(|| user_name.clone());
    let requested_avatar_url = validation::avatar_url(req.avatar_url)?;
    let existing_avatar_url = if requested_avatar_url.is_none() {
        match state.storage_service.get_user(user_name.clone()).await {
            Ok(existing) => existing.and_then(|u| u.avatar_url),
            Err(e) => {
                let _ = state
                    .presence_service
                    .release_if_owner(&mut redis, &room_id, &user_name, &join_owner)
                    .await;
                return Err(e);
            }
        }
    } else {
        None
    };
    let avatar_url = resolved_join_avatar_url(requested_avatar_url, existing_avatar_url);

    let profile = match state
        .storage_service
        .upsert_user(user_name.clone(), nickname, avatar_url)
        .await
    {
        Ok(v) => v,
        Err(e) => {
            let _ = state
                .presence_service
                .release_if_owner(&mut redis, &room_id, &user_name, &join_owner)
                .await;
            return Err(e);
        }
    };

    let media_permission = match role {
        UserRole::Host => MemberMediaPermission::host_default(),
        UserRole::Member => state
            .stage_permission_service
            .get_or_default_member(&mut redis, &room_id, &user_name, state.config.room_ttl_seconds)
            .await?,
    };
    let token = match state
        .livekit_service
        .issue_room_token(
            &user_name,
            &room_id,
            role,
            PublishPermission {
                camera: media_permission.camera,
                screen_share: media_permission.screen_share,
            },
        )
    {
        Ok(t) => t,
        Err(e) => {
            let _ = state
                .presence_service
                .release_if_owner(&mut redis, &room_id, &user_name, &join_owner)
                .await;
            return Err(e);
        }
    };
    let app_claims = SessionClaims {
        user_name: user_name.clone(),
        room_id: room_id.clone(),
        role: match role {
            UserRole::Host => "host".to_string(),
            UserRole::Member => "member".to_string(),
        },
        jti: Some(uuid::Uuid::new_v4().simple().to_string()),
    };
    let app_owner = session_owner(&app_claims);
    let app_session_token = match state
        .session_service
        .issue(&mut redis, app_claims, state.config.session_ttl_seconds)
        .await
    {
        Ok(t) => t,
        Err(e) => {
            let _ = state
                .presence_service
                .release_if_owner(&mut redis, &room_id, &user_name, &join_owner)
                .await;
            return Err(e);
        }
    };

    let promoted = match state
        .presence_service
        .promote_owner(
            &mut redis,
            &room_id,
            &user_name,
            &join_owner,
            &app_owner,
            state.config.session_ttl_seconds,
            now_ts(),
        )
        .await
    {
        Ok(v) => v,
        Err(e) => {
            let _ = state
                .session_service
                .revoke(&mut redis, &app_session_token)
                .await;
            let _ = state
                .presence_service
                .release_if_owner(&mut redis, &room_id, &user_name, &join_owner)
                .await;
            return Err(e);
        }
    };
    if !promoted {
        let _ = state
            .session_service
            .revoke(&mut redis, &app_session_token)
            .await;
        let _ = state
            .presence_service
            .release_if_owner(&mut redis, &room_id, &user_name, &join_owner)
            .await;
        warn!(
            request_id,
            route = "/rooms/join",
            room_id,
            user_name,
            ip,
            result = "denied",
            "identity lock lost before session bind"
        );
        return Err(AppError::Unauthorized(
            "identity lock lost; retry join".to_string(),
        ));
    }

    let host_session_token = if role == UserRole::Host {
        let issued = match state
            .host_session_service
            .issue(
                &mut redis,
                SessionClaims {
                    user_name: user_name.clone(),
                    room_id: room_id.clone(),
                    role: "host".to_string(),
                    jti: None,
                },
                state.config.host_session_ttl_seconds,
            )
            .await
        {
            Ok(v) => v,
            Err(e) => {
                let _ = state
                    .session_service
                    .revoke(&mut redis, &app_session_token)
                    .await;
                let _ = state
                    .presence_service
                    .release_if_owner(&mut redis, &room_id, &user_name, &app_owner)
                    .await;
                return Err(e);
            }
        };
        Some(issued)
    } else {
        None
    };

    info!(
        request_id,
        route = "/rooms/join",
        room_id,
        user_name,
        ip,
        role = match role {
            UserRole::Host => "host",
            UserRole::Member => "member",
        },
        result = "ok",
        "join room"
    );

    Ok(Json(JoinResp {
        lk_url: state.livekit_service.public_ws_url().to_string(),
        token,
        expires_in_seconds: state.config.token_ttl_seconds,
        role: match role {
            UserRole::Host => "host".to_string(),
            UserRole::Member => "member".to_string(),
        },
        camera_allowed: media_permission.camera,
        screen_share_allowed: media_permission.screen_share,
        nickname: profile.nickname,
        avatar_url: profile.avatar_url,
        app_session_token,
        app_session_expires_in_seconds: state.config.session_ttl_seconds,
        host_session_token,
        host_session_expires_in_seconds: if role == UserRole::Host {
            Some(state.config.host_session_ttl_seconds)
        } else {
            None
        },
    }))
}

async fn reconnect_room(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<ReconnectResp>> {
    let request_id = request_meta::request_id(&headers);
    let app_session_token = bearer_from_headers(&headers)
        .ok_or_else(|| AppError::Unauthorized("missing app session token".to_string()))?;

    let mut redis = state.redis.clone();
    let claims = state
        .session_service
        .verify(&mut redis, app_session_token)
        .await?;

    let _room = state
        .storage_service
        .get_room_active(claims.room_id.clone())
        .await?
        .ok_or_else(|| AppError::BadRequest("room not active or expired".to_string()))?;

    let lock_ok = state
        .presence_service
        .touch_owner(
            &mut redis,
            &claims.room_id,
            &claims.user_name,
            &session_owner(&claims),
            state.config.session_ttl_seconds,
            now_ts(),
        )
        .await?;
    if !lock_ok {
        warn!(
            request_id,
            route = "/rooms/reconnect",
            room_id = claims.room_id,
            user_name = claims.user_name,
            result = "denied",
            "identity lock not owned by session"
        );
        return Err(AppError::Unauthorized(
            "identity already in use".to_string(),
        ));
    }

    let role = UserRole::from_str(&claims.role)
        .ok_or_else(|| AppError::Unauthorized("session role invalid".to_string()))?;
    let media_permission = match role {
        UserRole::Host => MemberMediaPermission::host_default(),
        UserRole::Member => state
            .stage_permission_service
            .get_or_default_member(
                &mut redis,
                &claims.room_id,
                &claims.user_name,
                state.config.room_ttl_seconds,
            )
            .await?,
    };
    let token = state.livekit_service.issue_room_token(
        &claims.user_name,
        &claims.room_id,
        role,
        PublishPermission {
            camera: media_permission.camera,
            screen_share: media_permission.screen_share,
        },
    )?;

    info!(
        request_id,
        route = "/rooms/reconnect",
        room_id = claims.room_id,
        user_name = claims.user_name,
        result = "ok",
        "room reconnect token issued"
    );

    Ok(Json(ReconnectResp {
        lk_url: state.livekit_service.public_ws_url().to_string(),
        token,
        expires_in_seconds: state.config.token_ttl_seconds,
        role: claims.role,
        camera_allowed: media_permission.camera,
        screen_share_allowed: media_permission.screen_share,
    }))
}

async fn leave_room(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<LeaveResp>> {
    let request_id = request_meta::request_id(&headers);
    let app_session_token = bearer_from_headers(&headers)
        .ok_or_else(|| AppError::Unauthorized("missing app session token".to_string()))?;

    let mut redis = state.redis.clone();
    let claims = state
        .session_service
        .verify(&mut redis, app_session_token)
        .await?;

    let released = state
        .presence_service
        .release_if_owner(
            &mut redis,
            &claims.room_id,
            &claims.user_name,
            &session_owner(&claims),
        )
        .await?;
    state
        .session_service
        .revoke(&mut redis, app_session_token)
        .await?;

    if released {
        info!(
            request_id,
            route = "/rooms/leave",
            room_id = claims.room_id,
            user_name = claims.user_name,
            result = "ok",
            "leave room"
        );
    } else {
        warn!(
            request_id,
            route = "/rooms/leave",
            room_id = claims.room_id,
            user_name = claims.user_name,
            result = "ok",
            "leave room: lock not owned or already expired"
        );
    }

    Ok(Json(LeaveResp { released }))
}

async fn force_reclaim_host_lock(
    State(state): State<AppState>,
    Extension(principal): Extension<ControlPrincipal>,
    headers: HeaderMap,
    Json(req): Json<ForceReclaimReq>,
) -> AppResult<Json<ForceReclaimResp>> {
    let request_id = request_meta::request_id(&headers);
    let room_id = validation::room_id(&req.room_id)?;
    let host_identity = validation::user_name(&req.host_identity)?;

    match principal {
        ControlPrincipal::Admin => {}
        ControlPrincipal::Host(claims) => {
            if claims.role != "host"
                || claims.room_id != room_id
                || claims.user_name != host_identity
            {
                return Err(AppError::Unauthorized(
                    "host session scope mismatch".to_string(),
                ));
            }
        }
    }

    let mut redis = state.redis.clone();
    let current = state
        .presence_service
        .get_state(&mut redis, &room_id, &host_identity)
        .await?;
    let Some(current) = current else {
        info!(
            request_id,
            route = "/rooms/host/force-reclaim",
            room_id,
            host_identity,
            result = "ok",
            "no stale presence lock to reclaim"
        );
        return Ok(Json(ForceReclaimResp {
            reclaimed: true,
            reason: "no_lock".to_string(),
            stale_age_seconds: 0,
        }));
    };

    let now = now_ts();
    let stale_age_seconds = if current.heartbeat_ts <= 0 {
        HOST_STALE_SECONDS + 1
    } else {
        now.saturating_sub(current.heartbeat_ts)
    };
    let livekit_active = match state
        .livekit_service
        .is_identity_active(&room_id, &host_identity)
        .await
    {
        Ok(v) => Some(v),
        Err(e) => {
            warn!(
                request_id,
                route = "/rooms/host/force-reclaim",
                room_id,
                host_identity,
                error = e.to_string(),
                result = "livekit_probe_failed",
                "force reclaim livekit probe failed; fallback to stale age"
            );
            None
        }
    };
    let deny_reclaim = matches!(livekit_active, Some(true))
        || (livekit_active.is_none() && stale_age_seconds <= HOST_STALE_SECONDS);
    if deny_reclaim {
        warn!(
            request_id,
            route = "/rooms/host/force-reclaim",
            room_id,
            host_identity,
            current_owner = current.owner,
            stale_age_seconds,
            livekit_active = match livekit_active {
                Some(true) => "active",
                Some(false) => "inactive",
                None => "unknown",
            },
            result = "denied",
            "presence lock still active"
        );
        return Err(AppError::Unauthorized(
            "identity already in use".to_string(),
        ));
    }

    state
        .presence_service
        .force_delete(&mut redis, &room_id, &host_identity)
        .await?;
    let _ = state
        .session_service
        .revoke(&mut redis, &current.owner)
        .await;

    info!(
        request_id,
        route = "/rooms/host/force-reclaim",
        room_id,
        host_identity,
        stale_age_seconds,
        result = "ok",
        "stale presence lock reclaimed"
    );

    Ok(Json(ForceReclaimResp {
        reclaimed: true,
        reason: "stale_reclaimed".to_string(),
        stale_age_seconds,
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

fn resolved_join_avatar_url(
    requested_avatar_url: Option<String>,
    existing_avatar_url: Option<String>,
) -> Option<String> {
    requested_avatar_url.or(existing_avatar_url)
}

#[cfg(test)]
mod tests {
    use super::resolved_join_avatar_url;

    #[test]
    fn join_avatar_keeps_existing_when_request_omits_avatar() {
        let got = resolved_join_avatar_url(None, Some("/api/avatars/a.webp".to_string()));
        assert_eq!(got.as_deref(), Some("/api/avatars/a.webp"));
    }

    #[test]
    fn join_avatar_uses_requested_when_provided() {
        let got = resolved_join_avatar_url(
            Some("/api/avatars/new.webp".to_string()),
            Some("/api/avatars/old.webp".to_string()),
        );
        assert_eq!(got.as_deref(), Some("/api/avatars/new.webp"));
    }
}

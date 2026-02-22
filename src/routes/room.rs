use crate::error::{AppError, AppResult};
use crate::request_meta;
use crate::services::livekit::UserRole;
use crate::services::session::SessionClaims;
use crate::state::AppState;
use crate::validation;
use axum::{
    Json, Router,
    extract::{ConnectInfo, State},
    http::HeaderMap,
    routing::post,
};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use tracing::{info, warn};

pub fn router() -> Router<AppState> {
    Router::new().route("/rooms/join", post(join_room))
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
    pub app_session_token: String,
    pub app_session_expires_in_seconds: u64,
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
        let token = bearer_from_headers(&headers)
            .ok_or_else(|| AppError::Unauthorized("host join requires admin token".to_string()))?;
        if token != state.config.admin_token {
            warn!(
                request_id,
                route = "/rooms/join",
                room_id,
                user_name,
                "host join denied: invalid admin token"
            );
            return Err(AppError::Unauthorized("invalid admin token".to_string()));
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

    let nickname = req
        .nickname
        .as_deref()
        .map(validation::nickname)
        .transpose()?
        .unwrap_or_else(|| user_name.clone());
    let avatar_url = validation::avatar_url(req.avatar_url)?;

    state
        .storage_service
        .upsert_user(user_name.clone(), nickname, avatar_url)
        .await?;

    let token = state
        .livekit_service
        .issue_room_token(&user_name, &room_id, role)?;
    let app_session_token = state
        .session_service
        .issue(
            &mut redis,
            SessionClaims {
                user_name: user_name.clone(),
                room_id: room_id.clone(),
                role: match role {
                    UserRole::Host => "host".to_string(),
                    UserRole::Member => "member".to_string(),
                },
            },
            state.config.session_ttl_seconds,
        )
        .await?;

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
        app_session_token,
        app_session_expires_in_seconds: state.config.session_ttl_seconds,
    }))
}

fn bearer_from_headers(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
}

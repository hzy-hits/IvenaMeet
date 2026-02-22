use crate::error::{AppError, AppResult};
use crate::services::livekit::UserRole;
use crate::state::AppState;
use axum::{Json, Router, extract::State, http::HeaderMap, routing::post};
use serde::{Deserialize, Serialize};

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
}

async fn join_room(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<JoinReq>,
) -> AppResult<Json<JoinResp>> {
    if req.room_id.trim().is_empty() {
        return Err(AppError::BadRequest("room_id is required".to_string()));
    }
    if req.user_name.trim().is_empty() {
        return Err(AppError::BadRequest("user_name is required".to_string()));
    }

    let role = match req.role.as_deref() {
        None => UserRole::Member,
        Some(raw) => UserRole::from_str(raw)
            .ok_or_else(|| AppError::BadRequest("role must be host or member".to_string()))?,
    };

    if role == UserRole::Host {
        let token = bearer_from_headers(&headers)
            .ok_or_else(|| AppError::Unauthorized("host join requires admin token".to_string()))?;
        if token != state.config.admin_token {
            return Err(AppError::Unauthorized("invalid admin token".to_string()));
        }
        state
            .storage_service
            .ensure_room_for_host(
                req.room_id.clone(),
                req.user_name.clone(),
                state.config.room_ttl_seconds,
            )
            .await?;
    } else {
        let room = state
            .storage_service
            .get_room_active(req.room_id.clone())
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
                .consume_redeem(&mut redis, redeem_token, &room.room_id, &req.user_name)
                .await?;
        }
    }

    let ip = client_ip(&headers);
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
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(req.user_name.as_str())
        .to_string();

    state
        .storage_service
        .upsert_user(req.user_name.clone(), nickname, req.avatar_url.clone())
        .await?;

    let token = state
        .livekit_service
        .issue_room_token(&req.user_name, &req.room_id, role)?;

    Ok(Json(JoinResp {
        lk_url: state.livekit_service.public_ws_url().to_string(),
        token,
        expires_in_seconds: state.config.token_ttl_seconds,
        role: match role {
            UserRole::Host => "host".to_string(),
            UserRole::Member => "member".to_string(),
        },
    }))
}

fn bearer_from_headers(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
}

fn client_ip(headers: &HeaderMap) -> String {
    if let Some(raw) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        if let Some(first) = raw.split(',').next() {
            let ip = first.trim();
            if !ip.is_empty() {
                return ip.to_string();
            }
        }
    }
    if let Some(ip) = headers.get("x-real-ip").and_then(|v| v.to_str().ok()) {
        return ip.to_string();
    }
    "unknown".to_string()
}

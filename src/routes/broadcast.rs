use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::{Json, Router, extract::State, http::HeaderMap, routing::post};
use serde::{Deserialize, Serialize};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/broadcast/issue", post(issue_broadcast_start))
        .route("/broadcast/start", post(start_broadcast))
        .route("/broadcast/stop", post(stop_broadcast))
}

#[derive(Deserialize)]
pub struct IssueBroadcastReq {
    pub room_id: String,
    pub host_identity: String,
}

#[derive(Serialize)]
pub struct IssueBroadcastResp {
    pub start_token: String,
    pub expires_in_seconds: u64,
}

#[derive(Deserialize)]
pub struct StartBroadcastReq {
    pub room_id: String,
    pub participant_identity: String,
    pub participant_name: Option<String>,
    pub start_token: String,
}

#[derive(Serialize)]
pub struct StartBroadcastResp {
    pub whip_url: String,
    pub stream_key: String,
    pub ingress_id: String,
}

#[derive(Deserialize)]
pub struct StopBroadcastReq {
    pub ingress_id: String,
}

async fn issue_broadcast_start(
    State(state): State<AppState>,
    Json(req): Json<IssueBroadcastReq>,
) -> AppResult<Json<IssueBroadcastResp>> {
    if req.room_id.trim().is_empty() || req.host_identity.trim().is_empty() {
        return Err(AppError::BadRequest(
            "room_id and host_identity are required".to_string(),
        ));
    }

    let room = state
        .storage_service
        .get_room_active(req.room_id.clone())
        .await?
        .ok_or_else(|| AppError::BadRequest("room not active or expired".to_string()))?;
    if room.host_identity != req.host_identity {
        return Err(AppError::Unauthorized("host identity mismatch".to_string()));
    }

    let mut redis = state.redis.clone();
    let token = state
        .invite_service
        .issue_broadcast_start(
            &mut redis,
            &req.room_id,
            &req.host_identity,
            state.config.broadcast_issue_ttl_seconds,
        )
        .await?;

    Ok(Json(IssueBroadcastResp {
        start_token: token,
        expires_in_seconds: state.config.broadcast_issue_ttl_seconds,
    }))
}

async fn start_broadcast(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<StartBroadcastReq>,
) -> AppResult<Json<StartBroadcastResp>> {
    if req.room_id.trim().is_empty() {
        return Err(AppError::BadRequest("room_id is required".to_string()));
    }
    if req.participant_identity.trim().is_empty() {
        return Err(AppError::BadRequest(
            "participant_identity is required".to_string(),
        ));
    }
    if req.start_token.trim().is_empty() {
        return Err(AppError::BadRequest("start_token is required".to_string()));
    }

    let room = state
        .storage_service
        .get_room_active(req.room_id.clone())
        .await?
        .ok_or_else(|| AppError::BadRequest("room not active or expired".to_string()))?;
    if room.host_identity != req.participant_identity {
        return Err(AppError::Unauthorized("host identity mismatch".to_string()));
    }

    let ip = client_ip(&headers);
    let mut redis = state.redis.clone();
    state
        .rate_limit_service
        .check(
            &mut redis,
            "broadcast_start",
            &ip,
            state.config.rate_limit_broadcast_start,
            state.config.rate_limit_window_seconds,
        )
        .await?;
    state
        .invite_service
        .consume_broadcast_start(
            &mut redis,
            &req.start_token,
            &req.room_id,
            &req.participant_identity,
        )
        .await?;

    let ingress = state
        .livekit_service
        .create_whip_ingress(
            &req.room_id,
            &req.participant_identity,
            req.participant_name.as_deref().unwrap_or("Host Stream"),
        )
        .await?;

    Ok(Json(StartBroadcastResp {
        whip_url: ingress.whip_url,
        stream_key: ingress.stream_key,
        ingress_id: ingress.ingress_id,
    }))
}

async fn stop_broadcast(
    State(state): State<AppState>,
    Json(req): Json<StopBroadcastReq>,
) -> AppResult<Json<serde_json::Value>> {
    if req.ingress_id.trim().is_empty() {
        return Err(AppError::BadRequest("ingress_id is required".to_string()));
    }

    state
        .livekit_service
        .delete_ingress(&req.ingress_id)
        .await?;

    Ok(Json(serde_json::json!({ "status": "stopped" })))
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

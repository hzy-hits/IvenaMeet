use crate::error::{AppError, AppResult};
use crate::middleware::control_auth::ControlPrincipal;
use crate::request_meta;
use crate::state::AppState;
use crate::validation;
use axum::{
    Json, Router,
    extract::{ConnectInfo, Extension, State},
    http::HeaderMap,
    routing::post,
};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use tracing::{info, warn};

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
    Extension(principal): Extension<ControlPrincipal>,
    headers: HeaderMap,
    Json(req): Json<IssueBroadcastReq>,
) -> AppResult<Json<IssueBroadcastResp>> {
    let request_id = request_meta::request_id(&headers);
    let room_id = validation::room_id(&req.room_id)?;
    let host_identity = validation::user_name(&req.host_identity)?;
    if let ControlPrincipal::Host(claims) = principal {
        if claims.room_id != room_id || claims.user_name != host_identity {
            warn!(
                request_id,
                route = "/broadcast/issue",
                room_id,
                host_identity,
                token_room_id = claims.room_id,
                token_user_name = claims.user_name,
                result = "denied",
                "host token scope mismatch"
            );
            return Err(AppError::Unauthorized("host token scope mismatch".to_string()));
        }
    }

    let room = state
        .storage_service
        .get_room_active(room_id.clone())
        .await?
        .ok_or_else(|| AppError::BadRequest("room not active or expired".to_string()))?;
    if room.host_identity != host_identity {
        warn!(
            request_id,
            route = "/broadcast/issue",
            room_id,
            host_identity,
            result = "denied",
            "host identity mismatch"
        );
        return Err(AppError::Unauthorized("host identity mismatch".to_string()));
    }

    let mut redis = state.redis.clone();
    let token = state
        .invite_service
        .issue_broadcast_start(
            &mut redis,
            &room_id,
            &host_identity,
            state.config.broadcast_issue_ttl_seconds,
        )
        .await?;

    info!(
        request_id,
        route = "/broadcast/issue",
        room_id,
        host_identity,
        result = "ok",
        "broadcast start token issued"
    );

    Ok(Json(IssueBroadcastResp {
        start_token: token,
        expires_in_seconds: state.config.broadcast_issue_ttl_seconds,
    }))
}

async fn start_broadcast(
    State(state): State<AppState>,
    peer: ConnectInfo<SocketAddr>,
    Extension(principal): Extension<ControlPrincipal>,
    headers: HeaderMap,
    Json(req): Json<StartBroadcastReq>,
) -> AppResult<Json<StartBroadcastResp>> {
    let request_id = request_meta::request_id(&headers);
    let room_id = validation::room_id(&req.room_id)?;
    let participant_identity = validation::user_name(&req.participant_identity)?;
    if let ControlPrincipal::Host(claims) = principal {
        if claims.room_id != room_id || claims.user_name != participant_identity {
            warn!(
                request_id,
                route = "/broadcast/start",
                room_id,
                participant_identity,
                token_room_id = claims.room_id,
                token_user_name = claims.user_name,
                result = "denied",
                "host token scope mismatch"
            );
            return Err(AppError::Unauthorized("host token scope mismatch".to_string()));
        }
    }
    let participant_name = req
        .participant_name
        .as_deref()
        .map(validation::nickname)
        .transpose()?
        .unwrap_or_else(|| "Host Stream".to_string());
    let start_token = req.start_token.trim();
    if start_token.is_empty() {
        return Err(AppError::BadRequest("start_token is required".to_string()));
    }

    let room = state
        .storage_service
        .get_room_active(room_id.clone())
        .await?
        .ok_or_else(|| AppError::BadRequest("room not active or expired".to_string()))?;
    if room.host_identity != participant_identity {
        warn!(
            request_id,
            route = "/broadcast/start",
            room_id,
            participant_identity,
            result = "denied",
            "host identity mismatch"
        );
        return Err(AppError::Unauthorized("host identity mismatch".to_string()));
    }

    let ip = request_meta::client_ip(&state.config.trusted_proxy_ips, &headers, peer);
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
        .consume_broadcast_start(&mut redis, start_token, &room_id, &participant_identity)
        .await?;

    let ingress = state
        .livekit_service
        .create_whip_ingress(&room_id, &participant_identity, &participant_name)
        .await?;

    info!(
        request_id,
        route = "/broadcast/start",
        room_id,
        participant_identity,
        ip,
        ingress_id = ingress.ingress_id,
        result = "ok",
        "broadcast started"
    );

    Ok(Json(StartBroadcastResp {
        whip_url: ingress.whip_url,
        stream_key: ingress.stream_key,
        ingress_id: ingress.ingress_id,
    }))
}

async fn stop_broadcast(
    State(state): State<AppState>,
    Extension(_principal): Extension<ControlPrincipal>,
    headers: HeaderMap,
    Json(req): Json<StopBroadcastReq>,
) -> AppResult<Json<serde_json::Value>> {
    let request_id = request_meta::request_id(&headers);
    let ingress_id = req.ingress_id.trim();
    if ingress_id.is_empty() {
        return Err(AppError::BadRequest("ingress_id is required".to_string()));
    }

    state.livekit_service.delete_ingress(ingress_id).await?;
    info!(
        request_id,
        route = "/broadcast/stop",
        ingress_id,
        result = "ok",
        "broadcast stopped"
    );

    Ok(Json(serde_json::json!({ "status": "stopped" })))
}

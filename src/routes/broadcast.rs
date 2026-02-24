use crate::error::{AppError, AppResult};
use crate::middleware::control_auth::ControlPrincipal;
use crate::request_meta;
use crate::services::storage::RoomBroadcastInfo;
use crate::state::AppState;
use crate::validation;
use axum::{
    Json, Router,
    extract::{ConnectInfo, Extension, State},
    http::HeaderMap,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use tracing::{info, warn};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/broadcast/issue", post(issue_broadcast_start))
        .route("/broadcast/start", post(start_broadcast))
        .route("/broadcast/current", get(current_broadcast))
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

#[derive(Deserialize)]
pub struct CurrentBroadcastReq {
    pub room_id: String,
    pub host_identity: String,
}

#[derive(Serialize)]
pub struct CurrentBroadcastResp {
    pub active: bool,
    pub whip_url: Option<String>,
    pub stream_key: Option<String>,
    pub ingress_id: Option<String>,
}

impl CurrentBroadcastResp {
    const fn inactive() -> Self {
        Self {
            active: false,
            whip_url: None,
            stream_key: None,
            ingress_id: None,
        }
    }
}

fn ingress_not_found_error(err: &AppError) -> bool {
    let msg = err.to_string().to_ascii_lowercase();
    msg.contains("not found") || msg.contains("404")
}

fn start_resp_from_record(record: &RoomBroadcastInfo) -> StartBroadcastResp {
    StartBroadcastResp {
        whip_url: record.whip_url.clone(),
        stream_key: record.stream_key.clone(),
        ingress_id: record.ingress_id.clone(),
    }
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
            return Err(AppError::Unauthorized(
                "host token scope mismatch".to_string(),
            ));
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
            return Err(AppError::Unauthorized(
                "host token scope mismatch".to_string(),
            ));
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

    if let Some(existing) = state
        .storage_service
        .get_room_broadcast(room_id.clone())
        .await?
    {
        if existing.host_identity == participant_identity {
            match state
                .livekit_service
                .get_ingress(&existing.ingress_id)
                .await?
            {
                Some(_) => {
                    info!(
                        request_id,
                        route = "/broadcast/start",
                        room_id,
                        participant_identity,
                        ingress_id = existing.ingress_id,
                        result = "ok",
                        "broadcast reused (idempotent)"
                    );
                    return Ok(Json(start_resp_from_record(&existing)));
                }
                None => {
                    state
                        .storage_service
                        .delete_room_broadcast(room_id.clone())
                        .await?;
                    warn!(
                        request_id,
                        route = "/broadcast/start",
                        room_id,
                        participant_identity,
                        ingress_id = existing.ingress_id,
                        result = "stale",
                        "stale broadcast record cleared before recreation"
                    );
                }
            }
        } else {
            let _ = state.livekit_service.delete_ingress(&existing.ingress_id).await;
            state
                .storage_service
                .delete_room_broadcast(room_id.clone())
                .await?;
            warn!(
                request_id,
                route = "/broadcast/start",
                room_id,
                participant_identity,
                stale_host_identity = existing.host_identity,
                result = "stale",
                "stale broadcast record host mismatch cleared before recreation"
            );
        }
    }

    // Keep WHIP ingress identity separate from the host's interactive identity.
    // Reusing the exact same identity can trigger participant replacement churn in LiveKit.
    let ingress_identity = format!("{participant_identity}__ingress");
    let ingress = state
        .livekit_service
        .create_whip_ingress(&room_id, &ingress_identity, &participant_name)
        .await?;
    state
        .storage_service
        .upsert_room_broadcast(
            room_id.clone(),
            participant_identity.clone(),
            participant_identity.clone(),
            participant_name.clone(),
            ingress_identity.clone(),
            ingress.ingress_id.clone(),
            ingress.whip_url.clone(),
            ingress.stream_key.clone(),
        )
        .await?;

    info!(
        request_id,
        route = "/broadcast/start",
        room_id,
        participant_identity,
        ingress_identity,
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

async fn current_broadcast(
    State(state): State<AppState>,
    Extension(principal): Extension<ControlPrincipal>,
    headers: HeaderMap,
    axum::extract::Query(req): axum::extract::Query<CurrentBroadcastReq>,
) -> AppResult<Json<CurrentBroadcastResp>> {
    let request_id = request_meta::request_id(&headers);
    let room_id = validation::room_id(&req.room_id)?;
    let host_identity = validation::user_name(&req.host_identity)?;

    if let ControlPrincipal::Host(claims) = principal {
        if claims.room_id != room_id || claims.user_name != host_identity {
            warn!(
                request_id,
                route = "/broadcast/current",
                room_id,
                host_identity,
                token_room_id = claims.room_id,
                token_user_name = claims.user_name,
                result = "denied",
                "host token scope mismatch"
            );
            return Err(AppError::Unauthorized(
                "host token scope mismatch".to_string(),
            ));
        }
    }

    let room = state
        .storage_service
        .get_room_active(room_id.clone())
        .await?;
    if let Some(room) = room {
        if room.host_identity != host_identity {
            warn!(
                request_id,
                route = "/broadcast/current",
                room_id,
                host_identity,
                result = "denied",
                "host identity mismatch"
            );
            return Err(AppError::Unauthorized("host identity mismatch".to_string()));
        }
    } else {
        if let Some(stale) = state
            .storage_service
            .get_room_broadcast(room_id.clone())
            .await?
        {
            let _ = state
                .livekit_service
                .delete_ingress(&stale.ingress_id)
                .await;
            state.storage_service.delete_room_broadcast(room_id).await?;
        }
        return Ok(Json(CurrentBroadcastResp::inactive()));
    }

    let Some(record) = state
        .storage_service
        .get_room_broadcast(room_id.clone())
        .await?
    else {
        return Ok(Json(CurrentBroadcastResp::inactive()));
    };
    if record.host_identity != host_identity {
        let _ = state.livekit_service.delete_ingress(&record.ingress_id).await;
        state.storage_service.delete_room_broadcast(room_id).await?;
        return Ok(Json(CurrentBroadcastResp::inactive()));
    }

    if state
        .livekit_service
        .get_ingress(&record.ingress_id)
        .await?
        .is_none()
    {
        state
            .storage_service
            .delete_room_broadcast(record.room_id)
            .await?;
        return Ok(Json(CurrentBroadcastResp::inactive()));
    }

    Ok(Json(CurrentBroadcastResp {
        active: true,
        whip_url: Some(record.whip_url),
        stream_key: Some(record.stream_key),
        ingress_id: Some(record.ingress_id),
    }))
}

async fn stop_broadcast(
    State(state): State<AppState>,
    Extension(principal): Extension<ControlPrincipal>,
    headers: HeaderMap,
    Json(req): Json<StopBroadcastReq>,
) -> AppResult<Json<serde_json::Value>> {
    let request_id = request_meta::request_id(&headers);
    let ingress_id = req.ingress_id.trim();
    if ingress_id.is_empty() {
        return Err(AppError::BadRequest("ingress_id is required".to_string()));
    }

    let existing = state
        .storage_service
        .get_room_broadcast_by_ingress_id(ingress_id.to_string())
        .await?;
    if let ControlPrincipal::Host(claims) = &principal {
        let Some(record) = &existing else {
            warn!(
                request_id,
                route = "/broadcast/stop",
                ingress_id,
                token_room_id = claims.room_id,
                token_user_name = claims.user_name,
                result = "denied",
                "host can only stop ingress tracked in own room"
            );
            return Err(AppError::Unauthorized(
                "host can only stop ingress tracked in own room".to_string(),
            ));
        };
        if claims.room_id != record.room_id || claims.user_name != record.host_identity {
            warn!(
                request_id,
                route = "/broadcast/stop",
                ingress_id,
                token_room_id = claims.room_id,
                token_user_name = claims.user_name,
                record_room_id = record.room_id,
                record_host_identity = record.host_identity,
                result = "denied",
                "host token scope mismatch"
            );
            return Err(AppError::Unauthorized(
                "host token scope mismatch".to_string(),
            ));
        }
    }

    match state.livekit_service.delete_ingress(ingress_id).await {
        Ok(_) => {}
        Err(err) if ingress_not_found_error(&err) => {
            warn!(
                request_id,
                route = "/broadcast/stop",
                ingress_id,
                result = "stale",
                "ingress already absent on livekit; cleaning local record"
            );
        }
        Err(err) => return Err(err),
    }
    state
        .storage_service
        .delete_room_broadcast_by_ingress_id(ingress_id.to_string())
        .await?;
    info!(
        request_id,
        route = "/broadcast/stop",
        ingress_id,
        result = "ok",
        "broadcast stopped"
    );

    Ok(Json(serde_json::json!({ "status": "stopped" })))
}

pub async fn cleanup_expired_room_broadcasts(state: &AppState) -> AppResult<usize> {
    let stale = state
        .storage_service
        .list_room_broadcasts_for_expired_rooms(64)
        .await?;
    let mut cleaned = 0_usize;

    for record in stale {
        match state
            .livekit_service
            .delete_ingress(&record.ingress_id)
            .await
        {
            Ok(_) => {}
            Err(err) if ingress_not_found_error(&err) => {}
            Err(err) => {
                warn!(
                    room_id = record.room_id,
                    ingress_id = record.ingress_id,
                    error = %err,
                    "failed to delete expired room ingress; will retry"
                );
                continue;
            }
        }

        state
            .storage_service
            .delete_room_broadcast(record.room_id)
            .await?;
        cleaned += 1;
    }

    Ok(cleaned)
}

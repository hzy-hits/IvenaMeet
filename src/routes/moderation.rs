use crate::error::{AppError, AppResult};
use crate::middleware::control_auth::ControlPrincipal;
use crate::request_meta;
use crate::state::AppState;
use crate::validation;
use axum::{
    Json, Router,
    extract::{Extension, State},
    http::HeaderMap,
    routing::post,
};
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/moderation/mute", post(mute_member))
        .route("/moderation/mute-all", post(mute_all_members))
}

#[derive(Deserialize)]
pub struct MuteMemberReq {
    pub room_id: String,
    pub host_identity: String,
    pub target_identity: String,
    pub muted: bool,
}

#[derive(Deserialize)]
pub struct MuteAllReq {
    pub room_id: String,
    pub host_identity: String,
    pub muted: bool,
}

#[derive(Serialize)]
pub struct MuteResp {
    pub affected_tracks: u32,
}

async fn mute_member(
    State(state): State<AppState>,
    Extension(principal): Extension<ControlPrincipal>,
    headers: HeaderMap,
    Json(req): Json<MuteMemberReq>,
) -> AppResult<Json<MuteResp>> {
    let request_id = request_meta::request_id(&headers);
    let room_id = validation::room_id(&req.room_id)?;
    let host_identity = validation::user_name(&req.host_identity)?;
    let target_identity = validation::user_name(&req.target_identity)?;
    if let ControlPrincipal::Host(claims) = principal {
        if claims.room_id != room_id || claims.user_name != host_identity {
            warn!(
                request_id,
                route = "/moderation/mute",
                room_id,
                host_identity,
                target_identity,
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
            route = "/moderation/mute",
            room_id,
            host_identity,
            target_identity,
            result = "denied",
            "host identity mismatch"
        );
        return Err(AppError::Unauthorized("host identity mismatch".to_string()));
    }

    let affected = state
        .livekit_service
        .mute_participant_microphone(&room_id, &target_identity, req.muted)
        .await?;

    info!(
        request_id,
        route = "/moderation/mute",
        room_id,
        host_identity,
        target_identity,
        muted = req.muted,
        affected_tracks = affected,
        result = "ok",
        "participant microphone moderation"
    );

    Ok(Json(MuteResp {
        affected_tracks: affected,
    }))
}

async fn mute_all_members(
    State(state): State<AppState>,
    Extension(principal): Extension<ControlPrincipal>,
    headers: HeaderMap,
    Json(req): Json<MuteAllReq>,
) -> AppResult<Json<MuteResp>> {
    let request_id = request_meta::request_id(&headers);
    let room_id = validation::room_id(&req.room_id)?;
    let host_identity = validation::user_name(&req.host_identity)?;
    if let ControlPrincipal::Host(claims) = principal {
        if claims.room_id != room_id || claims.user_name != host_identity {
            warn!(
                request_id,
                route = "/moderation/mute-all",
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
            route = "/moderation/mute-all",
            room_id,
            host_identity,
            result = "denied",
            "host identity mismatch"
        );
        return Err(AppError::Unauthorized("host identity mismatch".to_string()));
    }

    let affected = state
        .livekit_service
        .mute_all_microphones(&room_id, Some(&host_identity), req.muted)
        .await?;

    info!(
        request_id,
        route = "/moderation/mute-all",
        room_id,
        host_identity,
        muted = req.muted,
        affected_tracks = affected,
        result = "ok",
        "all participant microphone moderation"
    );

    Ok(Json(MuteResp {
        affected_tracks: affected,
    }))
}

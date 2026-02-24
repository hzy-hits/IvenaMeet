use crate::error::{AppError, AppResult};
use crate::middleware::control_auth::ControlPrincipal;
use crate::request_meta;
use crate::services::livekit::PublishPermission;
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
        .route("/moderation/media-permission", post(set_member_media_permission))
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

#[derive(Deserialize)]
pub struct SetMemberMediaPermissionReq {
    pub room_id: String,
    pub host_identity: String,
    pub target_identity: String,
    pub feature: String,
    pub enabled: bool,
}

#[derive(Serialize)]
pub struct SetMemberMediaPermissionResp {
    pub affected_tracks: u32,
    pub camera_allowed: bool,
    pub screen_share_allowed: bool,
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

async fn set_member_media_permission(
    State(state): State<AppState>,
    Extension(principal): Extension<ControlPrincipal>,
    headers: HeaderMap,
    Json(req): Json<SetMemberMediaPermissionReq>,
) -> AppResult<Json<SetMemberMediaPermissionResp>> {
    let request_id = request_meta::request_id(&headers);
    let room_id = validation::room_id(&req.room_id)?;
    let host_identity = validation::user_name(&req.host_identity)?;
    let target_identity = validation::user_name(&req.target_identity)?;
    if target_identity == host_identity {
        return Err(AppError::BadRequest(
            "target_identity must be a member identity".to_string(),
        ));
    }
    let feature = parse_media_feature(&req.feature)?;

    if let ControlPrincipal::Host(claims) = principal {
        if claims.room_id != room_id || claims.user_name != host_identity {
            warn!(
                request_id,
                route = "/moderation/media-permission",
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
            route = "/moderation/media-permission",
            room_id,
            host_identity,
            target_identity,
            result = "denied",
            "host identity mismatch"
        );
        return Err(AppError::Unauthorized("host identity mismatch".to_string()));
    }
    if room.host_identity == target_identity {
        return Err(AppError::BadRequest(
            "cannot moderate host identity".to_string(),
        ));
    }

    let mut redis = state.redis.clone();
    let mut permission = state
        .stage_permission_service
        .get_or_default_member(
            &mut redis,
            &room_id,
            &target_identity,
            state.config.room_ttl_seconds,
        )
        .await?;

    match feature {
        MediaFeature::Camera => permission.camera = req.enabled,
        MediaFeature::ScreenShare => permission.screen_share = req.enabled,
    }

    state
        .stage_permission_service
        .set_member(
            &mut redis,
            &room_id,
            &target_identity,
            permission,
            state.config.room_ttl_seconds,
        )
        .await?;

    let publish_permission = PublishPermission {
        camera: permission.camera,
        screen_share: permission.screen_share,
    };
    state
        .livekit_service
        .update_participant_publish_permission(&room_id, &target_identity, publish_permission)
        .await?;

    let affected_tracks = if req.enabled {
        0
    } else {
        let source = match feature {
            MediaFeature::Camera => livekit_protocol::TrackSource::Camera,
            MediaFeature::ScreenShare => livekit_protocol::TrackSource::ScreenShare,
        };
        state
            .livekit_service
            .mute_participant_track_source(&room_id, &target_identity, source, true)
            .await?
    };

    info!(
        request_id,
        route = "/moderation/media-permission",
        room_id,
        host_identity,
        target_identity,
        feature = feature.as_str(),
        enabled = req.enabled,
        affected_tracks,
        camera_allowed = permission.camera,
        screen_share_allowed = permission.screen_share,
        result = "ok",
        "member media permission updated"
    );

    Ok(Json(SetMemberMediaPermissionResp {
        affected_tracks,
        camera_allowed: permission.camera,
        screen_share_allowed: permission.screen_share,
    }))
}

#[derive(Clone, Copy)]
enum MediaFeature {
    Camera,
    ScreenShare,
}

impl MediaFeature {
    fn as_str(self) -> &'static str {
        match self {
            Self::Camera => "camera",
            Self::ScreenShare => "screen_share",
        }
    }
}

fn parse_media_feature(raw: &str) -> AppResult<MediaFeature> {
    match raw.trim() {
        "camera" => Ok(MediaFeature::Camera),
        "screen_share" => Ok(MediaFeature::ScreenShare),
        _ => Err(AppError::BadRequest(
            "feature must be camera or screen_share".to_string(),
        )),
    }
}

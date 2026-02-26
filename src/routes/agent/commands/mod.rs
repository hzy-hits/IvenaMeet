mod issue_invite;
mod refresh_session;
mod send_message;

use super::IDEMPOTENCY_TTL_SECONDS;
use super::types::{AgentCommandName, CommandRequest, CommandResponse};
use super::utils::now_ts;
use crate::error::{AppError, AppResult};
use crate::services::livekit::PublishPermission;
use crate::services::session::SessionClaims;
use crate::state::AppState;
use crate::validation;
use axum::{
    Json,
    extract::{ConnectInfo, State},
    http::HeaderMap,
};
use std::net::SocketAddr;
use tracing::warn;

pub(super) async fn run_command(
    State(state): State<AppState>,
    peer: ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(req): Json<CommandRequest>,
) -> AppResult<Json<CommandResponse>> {
    let room_id = validation::room_id(&req.room_id)?;
    match req.command {
        AgentCommandName::RefreshSession => {
            refresh_session::run(state, headers, room_id, req).await
        }
        AgentCommandName::SendMessage => {
            send_message::run(state, peer, headers, room_id, req).await
        }
        AgentCommandName::IssueInvite => issue_invite::run(state, headers, room_id, req).await,
    }
}

async fn claim_command_idempotency(
    state: &AppState,
    room_id: &str,
    actor: &str,
    command: &str,
    key: &str,
) -> AppResult<bool> {
    let redis_key = format!("agent:idempotency:{room_id}:{actor}:{command}:{key}");
    let mut redis = state.redis.clone();
    let result: Option<String> = redis::cmd("SET")
        .arg(redis_key)
        .arg("1")
        .arg("NX")
        .arg("EX")
        .arg(IDEMPOTENCY_TTL_SECONDS)
        .query_async(&mut redis)
        .await
        .map_err(|e| AppError::Redis(e.to_string()))?;
    Ok(result.is_some())
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

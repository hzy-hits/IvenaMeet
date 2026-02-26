use super::auth::verify_app_session_in_room;
use super::types::{
    BroadcastSnapshot, ChatSnapshot, ContextQuery, ContextResponse, InviteSnapshot, RoomSnapshot,
    SessionSnapshot,
};
use super::utils::{command_capabilities, message_snapshot, now_ts};
use super::{AGENT_SCHEMA_VERSION, SESSION_EXPIRING_HINT_SECONDS};
use crate::error::{AppError, AppResult};
use crate::request_meta;
use crate::state::AppState;
use crate::validation;
use axum::{
    Json,
    extract::{Query, State},
    http::HeaderMap,
};
use tracing::{info, warn};

pub(super) async fn get_context(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ContextQuery>,
) -> AppResult<Json<ContextResponse>> {
    const ROUTE: &str = "/agent/v1/context";

    let request_id = request_meta::request_id(&headers);
    let room_id = validation::room_id(&query.room_id)?;
    let (_token, claims, session_ttl) =
        verify_app_session_in_room(&state, &headers, &room_id, &request_id, ROUTE).await?;
    let room = state
        .storage_service
        .get_room_active(room_id.clone())
        .await?
        .ok_or_else(|| AppError::BadRequest("room not active or expired".to_string()))?;

    let message_limit = query.message_limit.unwrap_or(20).clamp(1, 80);
    let recent_messages = state
        .storage_service
        .list_messages(room_id.clone(), message_limit, None)
        .await?;
    let latest_seq = recent_messages.last().map(|m| m.id).unwrap_or(0);
    let broadcast = state
        .storage_service
        .get_room_broadcast(room_id.clone())
        .await?;

    let invite = if claims.role == "host" && room.host_identity == claims.user_name {
        let mut redis = state.redis.clone();
        match state
            .invite_service
            .list_tickets(&mut redis, &room_id)
            .await
        {
            Ok(items) => Some(InviteSnapshot {
                active_tickets: items.len() as u64,
                total_remaining_uses: items.iter().map(|v| v.remaining_uses).sum(),
            }),
            Err(err) => {
                warn!(
                    request_id,
                    route = ROUTE,
                    room_id,
                    user_name = claims.user_name,
                    error = %err,
                    "failed to load invite summary for agent context"
                );
                None
            }
        }
    } else {
        None
    };

    let response = ContextResponse {
        schema_version: AGENT_SCHEMA_VERSION,
        generated_at: now_ts(),
        room: RoomSnapshot {
            room_id: room.room_id,
            host_identity: room.host_identity.clone(),
            expires_at: room.expires_at,
        },
        session: SessionSnapshot {
            user_name: claims.user_name.clone(),
            role: claims.role.clone(),
            session_expires_in_seconds: session_ttl,
            is_expiring_soon: session_ttl <= SESSION_EXPIRING_HINT_SECONDS,
        },
        chat: ChatSnapshot {
            latest_seq,
            next_event_cursor: latest_seq,
            recent_messages: recent_messages.into_iter().map(message_snapshot).collect(),
        },
        broadcast: BroadcastSnapshot {
            active: broadcast.is_some(),
            ingress_id: broadcast.as_ref().map(|v| v.ingress_id.clone()),
            participant_identity: broadcast.as_ref().map(|v| v.participant_identity.clone()),
        },
        invite,
        commands: command_capabilities(
            claims.role.as_str(),
            room.host_identity == claims.user_name,
        ),
    };

    info!(
        request_id,
        route = ROUTE,
        room_id,
        user_name = claims.user_name,
        result = "ok",
        "agent context generated"
    );
    Ok(Json(response))
}

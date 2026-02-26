use super::AGENT_SCHEMA_VERSION;
use super::auth::verify_app_session_in_room;
use super::types::{EventItem, EventsQuery, EventsResponse};
use crate::error::{AppError, AppResult};
use crate::request_meta;
use crate::state::AppState;
use crate::validation;
use axum::{
    Json,
    extract::{Query, State},
    http::HeaderMap,
};
use serde_json::json;
use tracing::info;

pub(super) async fn list_events(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<EventsQuery>,
) -> AppResult<Json<EventsResponse>> {
    const ROUTE: &str = "/agent/v1/events";

    let request_id = request_meta::request_id(&headers);
    let room_id = validation::room_id(&query.room_id)?;
    let (_token, claims, _ttl) =
        verify_app_session_in_room(&state, &headers, &room_id, &request_id, ROUTE).await?;

    let _room = state
        .storage_service
        .get_room_active(room_id.clone())
        .await?
        .ok_or_else(|| AppError::BadRequest("room not active or expired".to_string()))?;

    let after_seq = query.after_seq.filter(|v| *v > 0).unwrap_or(0);
    let limit = query.limit.unwrap_or(80).clamp(1, 200);
    let messages = state
        .storage_service
        .list_messages(room_id.clone(), limit, Some(after_seq))
        .await?;

    let items = messages
        .iter()
        .map(|m| EventItem {
            seq: m.id,
            event_type: "chat.message.created".to_string(),
            at: m.created_at,
            payload: json!({
                "seq": m.id,
                "room_id": m.room_id,
                "user_name": m.user_name,
                "nickname": m.nickname,
                "role": m.role,
                "text": m.text,
                "client_id": m.client_id,
                "created_at": m.created_at,
            }),
        })
        .collect::<Vec<_>>();
    let next_seq = items.last().map(|item| item.seq).unwrap_or(after_seq);

    info!(
        request_id,
        route = ROUTE,
        room_id,
        user_name = claims.user_name,
        after_seq,
        next_seq,
        result = "ok",
        "agent events listed"
    );

    Ok(Json(EventsResponse {
        schema_version: AGENT_SCHEMA_VERSION,
        room_id,
        after_seq,
        next_seq,
        items,
    }))
}

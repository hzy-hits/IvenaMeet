use crate::error::{AppError, AppResult};
use crate::request_meta;
use crate::services::storage::ChatMessage;
use crate::state::AppState;
use crate::validation;
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::{HeaderMap, header::AUTHORIZATION},
    response::sse::{Event, KeepAlive, Sse},
    routing::{get, post},
};
use futures_util::stream::StreamExt;
use serde::{Deserialize, Serialize};
use std::{convert::Infallible, time::Duration};
use tokio_stream::wrappers::{BroadcastStream, errors::BroadcastStreamRecvError};
use tracing::{info, warn};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/rooms/:room_id/messages", get(list_messages))
        .route("/rooms/:room_id/messages", post(create_message))
        .route("/rooms/:room_id/messages/stream", get(stream_messages))
}

#[derive(Debug, Deserialize)]
struct ListQuery {
    limit: Option<i64>,
    after_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct StreamQuery {
    after_id: Option<i64>,
}

#[derive(Debug, Serialize)]
struct ListMessagesResp {
    items: Vec<MessageItem>,
}

#[derive(Debug, Deserialize)]
struct CreateMessageReq {
    text: String,
    client_id: Option<String>,
}

#[derive(Debug, Serialize)]
struct MessageItem {
    id: i64,
    room_id: String,
    user_name: String,
    nickname: String,
    avatar_url: Option<String>,
    role: String,
    client_id: Option<String>,
    text: String,
    created_at: i64,
}

async fn list_messages(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<ListQuery>,
) -> AppResult<Json<ListMessagesResp>> {
    let request_id = request_meta::request_id(&headers);
    let room_id = validation::room_id(&room_id)?;

    let _room = state
        .storage_service
        .get_room_active(room_id.clone())
        .await?
        .ok_or_else(|| AppError::BadRequest("room not active or expired".to_string()))?;

    let limit = query.limit.unwrap_or(50).clamp(1, 200);
    let after_id = query.after_id.filter(|v| *v > 0);
    let messages = state
        .storage_service
        .list_messages(room_id, limit, after_id)
        .await?;
    info!(
        request_id,
        route = "/rooms/:room_id/messages [GET]",
        limit,
        after_id = after_id.unwrap_or(0),
        result = "ok",
        "messages listed"
    );

    Ok(Json(ListMessagesResp {
        items: messages.into_iter().map(message_item).collect(),
    }))
}

async fn create_message(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    headers: HeaderMap,
    Json(req): Json<CreateMessageReq>,
) -> AppResult<Json<MessageItem>> {
    let request_id = request_meta::request_id(&headers);
    let room_id = validation::room_id(&room_id)?;
    let text = validation::message_text(&req.text)?;
    let client_id = validation::client_id(req.client_id)?;

    let _room = state
        .storage_service
        .get_room_active(room_id.clone())
        .await?
        .ok_or_else(|| AppError::BadRequest("room not active or expired".to_string()))?;

    let app_session_token = bearer_from_headers(&headers)
        .ok_or_else(|| AppError::Unauthorized("missing app session token".to_string()))?;
    let mut redis = state.redis.clone();
    let claims = state
        .session_service
        .verify(&mut redis, app_session_token)
        .await?;
    if claims.room_id != room_id {
        warn!(
            request_id,
            route = "/rooms/:room_id/messages [POST]",
            user_name = claims.user_name,
            token_room_id = claims.room_id,
            path_room_id = room_id,
            result = "denied",
            "room mismatch for session token"
        );
        return Err(AppError::Unauthorized(
            "app session does not match room".to_string(),
        ));
    }

    let profile = state
        .storage_service
        .get_user(claims.user_name.clone())
        .await?;
    if profile.is_none() {
        return Err(AppError::BadRequest(
            "user not found; upsert user first".to_string(),
        ));
    }

    let m = state
        .storage_service
        .insert_message(room_id, claims.user_name, claims.role, client_id, text)
        .await?;
    let _ = state.chat_bus.send(m.clone());
    info!(
        request_id,
        route = "/rooms/:room_id/messages [POST]",
        room_id = m.room_id,
        user_name = m.user_name,
        result = "ok",
        "message created"
    );

    Ok(Json(message_item(m)))
}

async fn stream_messages(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<StreamQuery>,
) -> AppResult<Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>>> {
    let request_id = request_meta::request_id(&headers);
    let room_id = validation::room_id(&room_id)?;
    let after_id = query.after_id.filter(|v| *v > 0).unwrap_or(0);

    let app_session_token = bearer_from_headers(&headers)
        .ok_or_else(|| AppError::Unauthorized("missing app session token".to_string()))?;
    let mut redis = state.redis.clone();
    let claims = state
        .session_service
        .verify(&mut redis, app_session_token)
        .await?;
    if claims.room_id != room_id {
        warn!(
            request_id,
            route = "/rooms/:room_id/messages/stream [GET]",
            user_name = claims.user_name,
            token_room_id = claims.room_id,
            path_room_id = room_id,
            result = "denied",
            "room mismatch for session token"
        );
        return Err(AppError::Unauthorized(
            "app session does not match room".to_string(),
        ));
    }

    let _room = state
        .storage_service
        .get_room_active(room_id.clone())
        .await?
        .ok_or_else(|| AppError::BadRequest("room not active or expired".to_string()))?;

    let backlog = state
        .storage_service
        .list_messages(room_id.clone(), 200, Some(after_id))
        .await?;
    let initial = tokio_stream::iter(
        backlog
            .into_iter()
            .map(|m| Ok::<Event, Infallible>(message_event(m))),
    );

    let room_for_live = room_id.clone();
    let rx = state.chat_bus.subscribe();
    let live = BroadcastStream::new(rx).filter_map(move |next| {
        let room_for_live = room_for_live.clone();
        async move {
            match next {
                Ok(m) if m.room_id == room_for_live && m.id > after_id => {
                    Some(Ok::<Event, Infallible>(message_event(m)))
                }
                Ok(_) => None,
                Err(BroadcastStreamRecvError::Lagged(skipped)) => Some(Ok::<Event, Infallible>(
                    Event::default().event("lagged").data(skipped.to_string()),
                )),
            }
        }
    });

    info!(
        request_id,
        route = "/rooms/:room_id/messages/stream [GET]",
        room_id,
        user_name = claims.user_name,
        after_id,
        result = "ok",
        "message stream opened"
    );

    Ok(Sse::new(initial.chain(live)).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keepalive"),
    ))
}

fn bearer_from_headers(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
}

fn message_item(m: ChatMessage) -> MessageItem {
    MessageItem {
        id: m.id,
        room_id: m.room_id,
        user_name: m.user_name,
        nickname: m.nickname,
        avatar_url: m.avatar_url,
        role: m.role,
        client_id: m.client_id,
        text: m.text,
        created_at: m.created_at,
    }
}

fn message_event(m: ChatMessage) -> Event {
    let item = message_item(m);
    let data = serde_json::to_string(&item)
        .unwrap_or_else(|_| "{\"error\":\"failed to serialize message\"}".to_string());
    Event::default().event("message").data(data)
}

use crate::error::{AppError, AppResult};
use crate::request_meta;
use crate::state::AppState;
use crate::validation;
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::{HeaderMap, header::AUTHORIZATION},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/rooms/:room_id/messages", get(list_messages))
        .route("/rooms/:room_id/messages", post(create_message))
}

#[derive(Debug, Deserialize)]
struct ListQuery {
    limit: Option<i64>,
}

#[derive(Debug, Serialize)]
struct ListMessagesResp {
    items: Vec<MessageItem>,
}

#[derive(Debug, Deserialize)]
struct CreateMessageReq {
    text: String,
}

#[derive(Debug, Serialize)]
struct MessageItem {
    id: i64,
    room_id: String,
    user_name: String,
    nickname: String,
    avatar_url: Option<String>,
    role: String,
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
    let messages = state.storage_service.list_messages(room_id, limit).await?;
    info!(
        request_id,
        route = "/rooms/:room_id/messages [GET]",
        limit,
        result = "ok",
        "messages listed"
    );

    Ok(Json(ListMessagesResp {
        items: messages
            .into_iter()
            .map(|m| MessageItem {
                id: m.id,
                room_id: m.room_id,
                user_name: m.user_name,
                nickname: m.nickname,
                avatar_url: m.avatar_url,
                role: m.role,
                text: m.text,
                created_at: m.created_at,
            })
            .collect(),
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
        .insert_message(room_id, claims.user_name, claims.role, text)
        .await?;
    info!(
        request_id,
        route = "/rooms/:room_id/messages [POST]",
        room_id = m.room_id,
        user_name = m.user_name,
        result = "ok",
        "message created"
    );

    Ok(Json(MessageItem {
        id: m.id,
        room_id: m.room_id,
        user_name: m.user_name,
        nickname: m.nickname,
        avatar_url: m.avatar_url,
        role: m.role,
        text: m.text,
        created_at: m.created_at,
    }))
}

fn bearer_from_headers(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
}

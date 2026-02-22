use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};

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
    user_name: String,
    role: String,
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
    Query(query): Query<ListQuery>,
) -> AppResult<Json<ListMessagesResp>> {
    if room_id.trim().is_empty() {
        return Err(AppError::BadRequest("room_id is required".to_string()));
    }

    let _room = state
        .storage_service
        .get_room_active(room_id.clone())
        .await?
        .ok_or_else(|| AppError::BadRequest("room not active or expired".to_string()))?;

    let limit = query.limit.unwrap_or(50).clamp(1, 200);
    let messages = state.storage_service.list_messages(room_id, limit).await?;

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
    Json(req): Json<CreateMessageReq>,
) -> AppResult<Json<MessageItem>> {
    if room_id.trim().is_empty() {
        return Err(AppError::BadRequest("room_id is required".to_string()));
    }
    if req.user_name.trim().is_empty() {
        return Err(AppError::BadRequest("user_name is required".to_string()));
    }
    if req.text.trim().is_empty() {
        return Err(AppError::BadRequest("text is required".to_string()));
    }

    let _room = state
        .storage_service
        .get_room_active(room_id.clone())
        .await?
        .ok_or_else(|| AppError::BadRequest("room not active or expired".to_string()))?;

    let role = match req.role.as_str() {
        "host" | "member" => req.role,
        _ => {
            return Err(AppError::BadRequest(
                "role must be host or member".to_string(),
            ));
        }
    };

    let profile = state
        .storage_service
        .get_user(req.user_name.clone())
        .await?;
    if profile.is_none() {
        return Err(AppError::BadRequest(
            "user not found; upsert user first".to_string(),
        ));
    }

    let m = state
        .storage_service
        .insert_message(room_id, req.user_name, role, req.text)
        .await?;

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

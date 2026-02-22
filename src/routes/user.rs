use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::{Json, Router, extract::State, routing::post};
use serde::{Deserialize, Serialize};

pub fn router() -> Router<AppState> {
    Router::new().route("/users/upsert", post(upsert_user))
}

#[derive(Debug, Deserialize)]
pub struct UpsertUserReq {
    pub user_name: String,
    pub nickname: String,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct UpsertUserResp {
    pub user_name: String,
    pub nickname: String,
    pub avatar_url: Option<String>,
}

async fn upsert_user(
    State(state): State<AppState>,
    Json(req): Json<UpsertUserReq>,
) -> AppResult<Json<UpsertUserResp>> {
    if req.user_name.trim().is_empty() {
        return Err(AppError::BadRequest("user_name is required".to_string()));
    }
    if req.nickname.trim().is_empty() {
        return Err(AppError::BadRequest("nickname is required".to_string()));
    }

    let profile = state
        .storage_service
        .upsert_user(req.user_name, req.nickname, req.avatar_url)
        .await?;

    Ok(Json(UpsertUserResp {
        user_name: profile.user_name,
        nickname: profile.nickname,
        avatar_url: profile.avatar_url,
    }))
}

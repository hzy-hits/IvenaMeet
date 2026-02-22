use crate::error::AppResult;
use crate::request_meta;
use crate::state::AppState;
use crate::validation;
use axum::{Json, Router, extract::State, http::HeaderMap, routing::post};
use serde::{Deserialize, Serialize};
use tracing::info;

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
    headers: HeaderMap,
    Json(req): Json<UpsertUserReq>,
) -> AppResult<Json<UpsertUserResp>> {
    let request_id = request_meta::request_id(&headers);
    let user_name = validation::user_name(&req.user_name)?;
    let nickname = validation::nickname(&req.nickname)?;
    let avatar_url = validation::avatar_url(req.avatar_url)?;

    let profile = state
        .storage_service
        .upsert_user(user_name, nickname, avatar_url)
        .await?;
    info!(
        request_id,
        route = "/users/upsert",
        user_name = profile.user_name,
        result = "ok",
        "user upserted"
    );

    Ok(Json(UpsertUserResp {
        user_name: profile.user_name,
        nickname: profile.nickname,
        avatar_url: profile.avatar_url,
    }))
}

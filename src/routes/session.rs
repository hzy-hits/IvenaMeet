use crate::error::{AppError, AppResult};
use crate::request_meta;
use crate::state::AppState;
use axum::{
    Json, Router,
    extract::State,
    http::{HeaderMap, header::AUTHORIZATION},
    routing::post,
};
use serde::Serialize;
use tracing::info;

pub fn router() -> Router<AppState> {
    Router::new().route("/sessions/refresh", post(refresh_session))
}

#[derive(Serialize)]
struct RefreshResp {
    app_session_token: String,
    app_session_expires_in_seconds: u64,
}

async fn refresh_session(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<RefreshResp>> {
    let request_id = request_meta::request_id(&headers);
    let token = bearer_from_headers(&headers)
        .ok_or_else(|| AppError::Unauthorized("missing app session token".to_string()))?;
    let mut redis = state.redis.clone();
    let (new_token, _claims) = state
        .session_service
        .refresh(&mut redis, token, state.config.session_ttl_seconds)
        .await?;
    info!(
        request_id,
        route = "/sessions/refresh",
        result = "ok",
        "session refreshed"
    );

    Ok(Json(RefreshResp {
        app_session_token: new_token,
        app_session_expires_in_seconds: state.config.session_ttl_seconds,
    }))
}

fn bearer_from_headers(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
}

use crate::state::AppState;
use axum::{Json, Router, extract::State, routing::get};
use serde_json::json;

pub fn router() -> Router<AppState> {
    Router::new().route("/healthz", get(healthz))
}

async fn healthz(State(_state): State<AppState>) -> Json<serde_json::Value> {
    Json(json!({ "ok": true }))
}

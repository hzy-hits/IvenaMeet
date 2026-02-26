mod auth;
mod commands;
mod context;
mod events;
mod types;
mod utils;

use crate::state::AppState;
use axum::{
    Router,
    routing::{get, post},
};

const AGENT_SCHEMA_VERSION: &str = "agent.v1";
const IDEMPOTENCY_TTL_SECONDS: u64 = 120;
const SESSION_EXPIRING_HINT_SECONDS: u64 = 120;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/agent/v1/context", get(context::get_context))
        .route("/agent/v1/events", get(events::list_events))
        .route("/agent/v1/commands", post(commands::run_command))
}

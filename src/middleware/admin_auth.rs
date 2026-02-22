use axum::{
    extract::State,
    http::{Request, header::AUTHORIZATION},
    middleware::Next,
    response::Response,
};
use tracing::warn;

use crate::error::{AppError, AppResult};
use crate::state::AppState;

pub async fn require_admin(
    State(state): State<AppState>,
    req: Request<axum::body::Body>,
    next: Next,
) -> AppResult<Response> {
    let auth = req
        .headers()
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| {
            warn!("admin auth failed: missing authorization header");
            AppError::Unauthorized("missing authorization header".to_string())
        })?;

    let token = auth.strip_prefix("Bearer ").ok_or_else(|| {
        warn!("admin auth failed: invalid authorization scheme");
        AppError::Unauthorized("invalid authorization scheme".to_string())
    })?;

    if token != state.config.admin_token {
        warn!("admin auth failed: invalid token");
        return Err(AppError::Unauthorized("invalid admin token".to_string()));
    }

    Ok(next.run(req).await)
}

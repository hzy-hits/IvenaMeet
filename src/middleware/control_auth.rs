use axum::{
    extract::State,
    http::{Request, header::AUTHORIZATION},
    middleware::Next,
    response::Response,
};
use tracing::warn;

use crate::error::{AppError, AppResult};
use crate::services::session::SessionClaims;
use crate::state::AppState;

#[derive(Clone, Debug)]
pub enum ControlPrincipal {
    Admin,
    Host(SessionClaims),
}

pub async fn require_control(
    State(state): State<AppState>,
    mut req: Request<axum::body::Body>,
    next: Next,
) -> AppResult<Response> {
    let auth = req
        .headers()
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| AppError::Unauthorized("missing authorization header".to_string()))?;
    let token = auth
        .strip_prefix("Bearer ")
        .ok_or_else(|| AppError::Unauthorized("invalid authorization scheme".to_string()))?;

    if token == state.config.admin_token {
        req.extensions_mut().insert(ControlPrincipal::Admin);
        return Ok(next.run(req).await);
    }

    let mut redis = state.redis.clone();
    let claims = state
        .host_session_service
        .verify(&mut redis, token)
        .await
        .map_err(|_| AppError::Unauthorized("invalid control token".to_string()))?;
    if claims.role != "host" {
        warn!(user_name = claims.user_name, room_id = claims.room_id, "control auth failed: non-host role");
        return Err(AppError::Unauthorized("control token is not host role".to_string()));
    }

    req.extensions_mut().insert(ControlPrincipal::Host(claims));
    Ok(next.run(req).await)
}

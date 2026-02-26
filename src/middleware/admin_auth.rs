use axum::{
    extract::ConnectInfo,
    extract::State,
    http::{Request, header::AUTHORIZATION},
    middleware::Next,
    response::Response,
};
use std::net::SocketAddr;
use tracing::{info, warn};

use crate::error::{AppError, AppResult};
use crate::state::AppState;

pub async fn require_admin(
    State(state): State<AppState>,
    req: Request<axum::body::Body>,
    next: Next,
) -> AppResult<Response> {
    let route = req.uri().path().to_string();
    let peer_ip = req
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|v| v.0.ip());
    if let Some(ip) = peer_ip {
        if !state.config.is_control_peer_allowed(ip) {
            warn!(
                route = route.as_str(),
                peer_ip = %ip,
                result = "denied",
                "admin auth failed: peer ip not in allowlist"
            );
            return Err(AppError::Unauthorized(
                "admin peer ip not allowed".to_string(),
            ));
        }
    }

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

    if !state.config.is_bootstrap_admin_token(token) {
        warn!(
            route = route.as_str(),
            result = "denied",
            "admin auth failed: invalid token"
        );
        return Err(AppError::Unauthorized("invalid admin token".to_string()));
    }

    info!(
        route = route.as_str(),
        peer_ip = peer_ip
            .map(|v| v.to_string())
            .unwrap_or_else(|| "unknown".to_string()),
        principal = "bootstrap_admin",
        result = "ok",
        "admin auth passed"
    );
    Ok(next.run(req).await)
}

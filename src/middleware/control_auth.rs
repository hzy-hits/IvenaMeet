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
                "control auth failed: peer ip not in allowlist"
            );
            return Err(AppError::Unauthorized(
                "control peer ip not allowed".to_string(),
            ));
        }
    }

    let auth = req
        .headers()
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| AppError::Unauthorized("missing authorization header".to_string()))?;
    let token = auth
        .strip_prefix("Bearer ")
        .ok_or_else(|| AppError::Unauthorized("invalid authorization scheme".to_string()))?;

    if state.config.is_runtime_admin_token(token) {
        req.extensions_mut().insert(ControlPrincipal::Admin);
        info!(
            route = route.as_str(),
            peer_ip = peer_ip
                .map(|v| v.to_string())
                .unwrap_or_else(|| "unknown".to_string()),
            principal = "runtime_admin",
            result = "ok",
            "control auth passed"
        );
        return Ok(next.run(req).await);
    }

    let mut redis = state.redis.clone();
    let claims = state
        .host_session_service
        .verify(&mut redis, token)
        .await
        .map_err(|_| AppError::Unauthorized("invalid control token".to_string()))?;
    if claims.role != "host" {
        warn!(
            route = route.as_str(),
            user_name = claims.user_name,
            room_id = claims.room_id,
            result = "denied",
            "control auth failed: non-host role"
        );
        return Err(AppError::Unauthorized(
            "control token is not host role".to_string(),
        ));
    }

    info!(
        route = route.as_str(),
        peer_ip = peer_ip
            .map(|v| v.to_string())
            .unwrap_or_else(|| "unknown".to_string()),
        principal = "host_session",
        user_name = claims.user_name.as_str(),
        room_id = claims.room_id.as_str(),
        result = "ok",
        "control auth passed"
    );
    req.extensions_mut().insert(ControlPrincipal::Host(claims));
    Ok(next.run(req).await)
}

use crate::error::{AppError, AppResult};
use crate::request_meta;
use crate::services::session::SessionClaims;
use crate::state::AppState;
use crate::validation;
use axum::{
    Json, Router,
    extract::{ConnectInfo, State},
    http::{HeaderMap, header::AUTHORIZATION},
    routing::post,
};
use google_authenticator::GoogleAuthenticator;
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use tracing::{info, warn};

pub fn admin_router() -> Router<AppState> {
    Router::new().route("/host/mfa/enroll", post(enroll_mfa))
}

pub fn public_router() -> Router<AppState> {
    Router::new()
        .route("/host/login/totp", post(login_with_totp))
        .route("/host/sessions/refresh", post(refresh_host_session))
}

#[derive(Deserialize)]
pub struct EnrollMfaReq {
    pub host_identity: String,
    pub reset_mfa: Option<bool>,
}

#[derive(Serialize)]
pub struct EnrollMfaResp {
    pub secret: String,
    pub otpauth_url: String,
    pub qr_svg: String,
    pub issuer: String,
    pub account_name: String,
}

#[derive(Deserialize)]
pub struct HostLoginReq {
    pub room_id: String,
    pub host_identity: String,
    pub totp_code: String,
}

#[derive(Serialize)]
pub struct HostLoginResp {
    pub host_session_token: String,
    pub expires_in_seconds: u64,
}

async fn enroll_mfa(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<EnrollMfaReq>,
) -> AppResult<Json<EnrollMfaResp>> {
    let request_id = request_meta::request_id(&headers);
    let host_identity = validation::user_name(&req.host_identity)?;
    let reset_mfa = req.reset_mfa.unwrap_or(false);

    let ga = GoogleAuthenticator::new();
    let mut redis = state.redis.clone();
    let existing = state
        .host_auth_service
        .get_totp_secret(&mut redis, &host_identity)
        .await?;
    let secret = if reset_mfa || existing.is_none() {
        let s = ga.create_secret(32);
        state
            .host_auth_service
            .set_totp_secret(&mut redis, &host_identity, &s)
            .await?;
        s
    } else {
        existing.expect("checked is_some above")
    };
    // Return standard otpauth URI instead of external chart URL.
    let otpauth_url = format!(
        "otpauth://totp/{}?secret={}&issuer={}",
        pct_encode(&host_identity),
        secret,
        pct_encode(&state.config.host_mfa_issuer)
    );
    let qr_svg = ga
        .qr_code(
            &secret,
            &state.config.host_mfa_issuer,
            &host_identity,
            256,
            256,
            google_authenticator::ErrorCorrectionLevel::Medium,
        )
        .map_err(|e| AppError::Config(format!("failed to generate qr svg: {e}")))?;

    info!(
        request_id,
        route = "/host/mfa/enroll",
        host_identity,
        reset_mfa,
        result = "ok",
        "host mfa enrolled"
    );

    Ok(Json(EnrollMfaResp {
        secret,
        otpauth_url,
        qr_svg,
        issuer: state.config.host_mfa_issuer.clone(),
        account_name: host_identity,
    }))
}

async fn login_with_totp(
    State(state): State<AppState>,
    peer: ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(req): Json<HostLoginReq>,
) -> AppResult<Json<HostLoginResp>> {
    let request_id = request_meta::request_id(&headers);
    let room_id = validation::room_id(&req.room_id)?;
    let host_identity = validation::user_name(&req.host_identity)?;
    let totp_code = req.totp_code.trim();
    if totp_code.len() != 6 || !totp_code.chars().all(|c| c.is_ascii_digit()) {
        return Err(AppError::BadRequest(
            "6-digit totp_code is required".to_string(),
        ));
    }

    let ip = request_meta::client_ip(&state.config.trusted_proxy_ips, &headers, peer);
    let mut redis = state.redis.clone();
    state
        .rate_limit_service
        .check(
            &mut redis,
            "host_login_totp",
            &ip,
            state.config.rate_limit_host_login_totp,
            state.config.rate_limit_window_seconds,
        )
        .await?;

    let secret = state
        .host_auth_service
        .get_totp_secret(&mut redis, &host_identity)
        .await?
        .ok_or_else(|| AppError::Unauthorized("mfa not enrolled for host".to_string()))?;

    let ga = GoogleAuthenticator::new();
    if !ga.verify_code(&secret, totp_code, 1, 0) {
        warn!(
            request_id,
            route = "/host/login/totp",
            room_id,
            host_identity,
            ip,
            result = "denied",
            "invalid totp code"
        );
        return Err(AppError::Unauthorized("invalid totp code".to_string()));
    }

    state
        .storage_service
        .ensure_room_for_host(
            room_id.clone(),
            host_identity.clone(),
            state.config.room_ttl_seconds,
        )
        .await?;

    let host_session_token = state
        .host_session_service
        .issue(
            &mut redis,
            SessionClaims {
                user_name: host_identity.clone(),
                room_id: room_id.clone(),
                role: "host".to_string(),
            },
            state.config.host_session_ttl_seconds,
        )
        .await?;

    info!(
        request_id,
        route = "/host/login/totp",
        room_id,
        host_identity,
        ip,
        result = "ok",
        "host login verified by totp"
    );

    Ok(Json(HostLoginResp {
        host_session_token,
        expires_in_seconds: state.config.host_session_ttl_seconds,
    }))
}

async fn refresh_host_session(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<Json<HostLoginResp>> {
    let request_id = request_meta::request_id(&headers);
    let token = bearer_from_headers(&headers)
        .ok_or_else(|| AppError::Unauthorized("missing host session token".to_string()))?;
    let mut redis = state.redis.clone();
    let (new_token, claims) = state
        .host_session_service
        .refresh(&mut redis, token, state.config.host_session_ttl_seconds)
        .await?;
    if claims.role != "host" {
        return Err(AppError::Unauthorized(
            "host session token is not host role".to_string(),
        ));
    }

    info!(
        request_id,
        route = "/host/sessions/refresh",
        room_id = claims.room_id,
        host_identity = claims.user_name,
        result = "ok",
        "host session refreshed"
    );

    Ok(Json(HostLoginResp {
        host_session_token: new_token,
        expires_in_seconds: state.config.host_session_ttl_seconds,
    }))
}

fn bearer_from_headers(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
}

fn pct_encode(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for b in input.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}

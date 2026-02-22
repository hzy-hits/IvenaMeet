use crate::error::{AppError, AppResult};
use crate::state::AppState;
use axum::{Json, Router, extract::State, http::HeaderMap, routing::post};
use serde::{Deserialize, Serialize};

pub fn router() -> Router<AppState> {
    Router::new().route("/invites/redeem", post(redeem_invite))
}

#[derive(Deserialize)]
struct RedeemInviteReq {
    room_id: String,
    user_name: String,
    invite_ticket: String,
    invite_code: String,
}

#[derive(Serialize)]
struct RedeemInviteResp {
    redeem_token: String,
    expires_in_seconds: u64,
}

async fn redeem_invite(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<RedeemInviteReq>,
) -> AppResult<Json<RedeemInviteResp>> {
    if req.room_id.trim().is_empty()
        || req.user_name.trim().is_empty()
        || req.invite_ticket.trim().is_empty()
        || req.invite_code.trim().is_empty()
    {
        return Err(AppError::BadRequest(
            "room_id, user_name, invite_ticket, invite_code are required".to_string(),
        ));
    }

    let ip = client_ip(&headers);
    let mut redis = state.redis.clone();
    state
        .rate_limit_service
        .check(
            &mut redis,
            "invite_redeem",
            &ip,
            state.config.rate_limit_invite_redeem,
            state.config.rate_limit_window_seconds,
        )
        .await?;

    let room = state
        .storage_service
        .get_room_active(req.room_id.clone())
        .await?
        .ok_or_else(|| AppError::BadRequest("room not active or expired".to_string()))?;

    let redeem_token = state
        .invite_service
        .redeem_ticket(
            &mut redis,
            &room.room_id,
            &req.user_name,
            &req.invite_ticket,
            &req.invite_code,
            state.config.redeem_ttl_seconds,
        )
        .await?;

    Ok(Json(RedeemInviteResp {
        redeem_token,
        expires_in_seconds: state.config.redeem_ttl_seconds,
    }))
}

fn client_ip(headers: &HeaderMap) -> String {
    if let Some(raw) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        if let Some(first) = raw.split(',').next() {
            let ip = first.trim();
            if !ip.is_empty() {
                return ip.to_string();
            }
        }
    }
    if let Some(ip) = headers.get("x-real-ip").and_then(|v| v.to_str().ok()) {
        return ip.to_string();
    }
    "unknown".to_string()
}

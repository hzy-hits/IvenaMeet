use crate::error::{AppError, AppResult};
use crate::request_meta;
use crate::state::AppState;
use crate::validation;
use axum::{
    Json, Router,
    extract::{ConnectInfo, State},
    http::HeaderMap,
    routing::post,
};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use tracing::info;

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
    ticket_remaining_uses: u64,
    expires_in_seconds: u64,
}

async fn redeem_invite(
    State(state): State<AppState>,
    peer: ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(req): Json<RedeemInviteReq>,
) -> AppResult<Json<RedeemInviteResp>> {
    let request_id = request_meta::request_id(&headers);
    let room_id = validation::room_id(&req.room_id)?;
    let user_name = validation::user_name(&req.user_name)?;
    let invite_ticket = req.invite_ticket.trim();
    let invite_code = req.invite_code.trim();
    if invite_ticket.is_empty() || invite_code.is_empty() {
        return Err(AppError::BadRequest(
            "invite_ticket and invite_code are required".to_string(),
        ));
    }

    let ip = request_meta::client_ip(&state.config.trusted_proxy_ips, &headers, peer);
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
        .get_room_active(room_id)
        .await?
        .ok_or_else(|| AppError::BadRequest("room not active or expired".to_string()))?;

    let redeemed = state
        .invite_service
        .redeem_ticket(
            &mut redis,
            &room.room_id,
            &user_name,
            invite_ticket,
            invite_code,
            state.config.redeem_ttl_seconds,
        )
        .await?;

    info!(
        request_id,
        route = "/invites/redeem",
        room_id = room.room_id,
        user_name,
        ip,
        result = "ok",
        "invite redeemed"
    );

    Ok(Json(RedeemInviteResp {
        redeem_token: redeemed.redeem_token,
        ticket_remaining_uses: redeemed.remaining_uses,
        expires_in_seconds: state.config.redeem_ttl_seconds,
    }))
}

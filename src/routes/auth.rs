use crate::error::AppResult;
use crate::state::AppState;
use axum::{Json, Router, extract::State, routing::post};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};

pub fn router() -> Router<AppState> {
    Router::new().route("/auth/invite", post(create_invite))
}

#[derive(Serialize)]
struct CreateInviteResp {
    invite_code: String,
    invite_ticket: String,
    invite_url: String,
    expires_at: chrono::DateTime<Utc>,
}

#[derive(Deserialize)]
struct CreateInviteReq {
    room_id: String,
    host_identity: String,
}

async fn create_invite(
    State(state): State<AppState>,
    Json(req): Json<CreateInviteReq>,
) -> AppResult<Json<CreateInviteResp>> {
    let room = state
        .storage_service
        .get_room_active(req.room_id.clone())
        .await?
        .ok_or_else(|| crate::error::AppError::BadRequest("room not active".to_string()))?;
    if room.host_identity != req.host_identity {
        return Err(crate::error::AppError::Unauthorized(
            "host identity mismatch".to_string(),
        ));
    }

    let mut redis = state.redis.clone();
    let issued = state
        .invite_service
        .create_ticket(&mut redis, &req.room_id, &req.host_identity)
        .await?;
    let expires_at = Utc::now() + Duration::seconds(state.config.invite_ttl_seconds as i64);
    let invite_url = format!(
        "{}/invite?room={}&ticket={}",
        state.config.meet_base_url.trim_end_matches('/'),
        req.room_id,
        issued.invite_ticket
    );

    Ok(Json(CreateInviteResp {
        invite_code: issued.invite_code,
        invite_ticket: issued.invite_ticket,
        invite_url,
        expires_at,
    }))
}

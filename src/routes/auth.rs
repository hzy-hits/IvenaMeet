use crate::error::AppResult;
use crate::middleware::control_auth::ControlPrincipal;
use crate::request_meta;
use crate::state::AppState;
use crate::validation;
use axum::{Json, Router, extract::{Extension, State}, http::HeaderMap, routing::post};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

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
    Extension(principal): Extension<ControlPrincipal>,
    headers: HeaderMap,
    Json(req): Json<CreateInviteReq>,
) -> AppResult<Json<CreateInviteResp>> {
    let request_id = request_meta::request_id(&headers);
    let room_id = validation::room_id(&req.room_id)?;
    let host_identity = validation::user_name(&req.host_identity)?;

    if let ControlPrincipal::Host(claims) = principal {
        if claims.room_id != room_id || claims.user_name != host_identity {
            warn!(
                request_id,
                route = "/auth/invite",
                room_id,
                host_identity,
                token_room_id = claims.room_id,
                token_user_name = claims.user_name,
                result = "denied",
                "host token scope mismatch"
            );
            return Err(crate::error::AppError::Unauthorized(
                "host token scope mismatch".to_string(),
            ));
        }
    }

    let room = state
        .storage_service
        .get_room_active(room_id.clone())
        .await?
        .ok_or_else(|| crate::error::AppError::BadRequest("room not active".to_string()))?;
    if room.host_identity != host_identity {
        warn!(
            request_id,
            route = "/auth/invite",
            room_id,
            host_identity,
            result = "denied",
            "host identity mismatch"
        );
        return Err(crate::error::AppError::Unauthorized(
            "host identity mismatch".to_string(),
        ));
    }

    let mut redis = state.redis.clone();
    let issued = state
        .invite_service
        .create_ticket(&mut redis, &room_id, &host_identity)
        .await?;
    let expires_at = Utc::now() + Duration::seconds(state.config.invite_ttl_seconds as i64);
    let invite_url = format!(
        "{}/?room={}&ticket={}",
        state.config.meet_base_url.trim_end_matches('/'),
        room_id,
        issued.invite_ticket
    );
    info!(
        request_id,
        route = "/auth/invite",
        room_id,
        host_identity,
        result = "ok",
        "invite issued"
    );

    Ok(Json(CreateInviteResp {
        invite_code: issued.invite_code,
        invite_ticket: issued.invite_ticket,
        invite_url,
        expires_at,
    }))
}

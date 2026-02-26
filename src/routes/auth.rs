use crate::error::{AppError, AppResult};
use crate::middleware::control_auth::ControlPrincipal;
use crate::request_meta;
use crate::state::AppState;
use crate::validation;
use axum::{
    Json, Router,
    extract::{Extension, Query, State},
    http::HeaderMap,
    routing::{get, post},
};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/invite", post(create_invite))
        .route("/auth/invites", get(list_invites))
        .route("/auth/invite/revoke", post(revoke_invite))
}

#[derive(Serialize)]
struct CreateInviteResp {
    invite_code: String,
    invite_ticket: String,
    invite_max_uses: u64,
    invite_url: String,
    expires_at: chrono::DateTime<Utc>,
}

#[derive(Deserialize)]
struct CreateInviteReq {
    room_id: String,
    host_identity: String,
}

#[derive(Deserialize)]
struct ListInvitesQuery {
    room_id: String,
    host_identity: String,
}

#[derive(Serialize)]
struct InviteItemResp {
    invite_code: String,
    invite_ticket: String,
    remaining_uses: u64,
    expires_at: chrono::DateTime<Utc>,
}

#[derive(Serialize)]
struct ListInvitesResp {
    items: Vec<InviteItemResp>,
}

#[derive(Deserialize)]
struct RevokeInviteReq {
    room_id: String,
    host_identity: String,
    invite_ticket: String,
}

#[derive(Serialize)]
struct RevokeInviteResp {
    revoked: bool,
}

async fn create_invite(
    State(state): State<AppState>,
    Extension(principal): Extension<ControlPrincipal>,
    headers: HeaderMap,
    Json(req): Json<CreateInviteReq>,
) -> AppResult<Json<CreateInviteResp>> {
    const ROUTE: &str = "/auth/invite";

    let request_id = request_meta::request_id(&headers);
    let room_id = validation::room_id(&req.room_id)?;
    let host_identity = validation::user_name(&req.host_identity)?;
    ensure_invite_scope(
        &state,
        &principal,
        &request_id,
        ROUTE,
        &room_id,
        &host_identity,
    )
    .await?;

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
        route = ROUTE,
        room_id,
        host_identity,
        result = "ok",
        "invite issued"
    );

    Ok(Json(CreateInviteResp {
        invite_code: issued.invite_code,
        invite_ticket: issued.invite_ticket,
        invite_max_uses: issued.max_uses,
        invite_url,
        expires_at,
    }))
}

async fn list_invites(
    State(state): State<AppState>,
    Extension(principal): Extension<ControlPrincipal>,
    headers: HeaderMap,
    Query(query): Query<ListInvitesQuery>,
) -> AppResult<Json<ListInvitesResp>> {
    const ROUTE: &str = "/auth/invites";

    let request_id = request_meta::request_id(&headers);
    let room_id = validation::room_id(&query.room_id)?;
    let host_identity = validation::user_name(&query.host_identity)?;
    ensure_invite_scope(
        &state,
        &principal,
        &request_id,
        ROUTE,
        &room_id,
        &host_identity,
    )
    .await?;

    let mut redis = state.redis.clone();
    let items = state
        .invite_service
        .list_tickets(&mut redis, &room_id)
        .await?;
    let now = Utc::now();
    let items = items
        .into_iter()
        .map(|item| InviteItemResp {
            invite_code: item.invite_code,
            invite_ticket: item.invite_ticket,
            remaining_uses: item.remaining_uses,
            expires_at: now + Duration::seconds(item.expires_in_seconds as i64),
        })
        .collect::<Vec<_>>();
    info!(
        request_id,
        route = ROUTE,
        room_id,
        host_identity,
        count = items.len(),
        result = "ok",
        "invite list loaded"
    );

    Ok(Json(ListInvitesResp { items }))
}

async fn revoke_invite(
    State(state): State<AppState>,
    Extension(principal): Extension<ControlPrincipal>,
    headers: HeaderMap,
    Json(req): Json<RevokeInviteReq>,
) -> AppResult<Json<RevokeInviteResp>> {
    const ROUTE: &str = "/auth/invite/revoke";

    let request_id = request_meta::request_id(&headers);
    let room_id = validation::room_id(&req.room_id)?;
    let host_identity = validation::user_name(&req.host_identity)?;
    let invite_ticket = req.invite_ticket.trim();
    if invite_ticket.is_empty() {
        return Err(AppError::BadRequest(
            "invite_ticket is required".to_string(),
        ));
    }
    ensure_invite_scope(
        &state,
        &principal,
        &request_id,
        ROUTE,
        &room_id,
        &host_identity,
    )
    .await?;

    let mut redis = state.redis.clone();
    let revoked = state
        .invite_service
        .revoke_ticket(&mut redis, &room_id, invite_ticket)
        .await?;
    info!(
        request_id,
        route = ROUTE,
        room_id,
        host_identity,
        invite_ticket,
        revoked,
        result = "ok",
        "invite revoked"
    );
    Ok(Json(RevokeInviteResp { revoked }))
}

async fn ensure_invite_scope(
    state: &AppState,
    principal: &ControlPrincipal,
    request_id: &str,
    route: &'static str,
    room_id: &str,
    host_identity: &str,
) -> AppResult<()> {
    if let ControlPrincipal::Host(claims) = principal {
        if claims.room_id != room_id || claims.user_name != host_identity {
            warn!(
                request_id,
                route,
                room_id,
                host_identity,
                token_room_id = claims.room_id,
                token_user_name = claims.user_name,
                result = "denied",
                "host token scope mismatch"
            );
            return Err(AppError::Unauthorized(
                "host token scope mismatch".to_string(),
            ));
        }
    }

    let room = state
        .storage_service
        .get_room_active(room_id.to_string())
        .await?
        .ok_or_else(|| AppError::BadRequest("room not active".to_string()))?;
    if room.host_identity != host_identity {
        warn!(
            request_id,
            route,
            room_id,
            host_identity,
            result = "denied",
            "host identity mismatch"
        );
        return Err(AppError::Unauthorized("host identity mismatch".to_string()));
    }
    Ok(())
}

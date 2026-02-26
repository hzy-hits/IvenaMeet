use super::claim_command_idempotency;
use crate::error::AppResult;
use crate::middleware::control_auth::ControlPrincipal;
use crate::request_meta;
use crate::routes::agent::auth::{ensure_invite_scope, verify_control_principal};
use crate::routes::agent::types::{CommandRequest, CommandResponse, IssueInviteParams};
use crate::routes::agent::utils::{
    command_response, decode_command_params, validate_idempotency_key,
};
use crate::state::AppState;
use crate::validation;
use axum::{Json, http::HeaderMap};
use chrono::{Duration, Utc};
use serde_json::json;
use tracing::info;

pub(super) async fn run(
    state: AppState,
    headers: HeaderMap,
    room_id: String,
    req: CommandRequest,
) -> AppResult<Json<CommandResponse>> {
    const ROUTE: &str = "/agent/v1/commands#issue_invite";

    let request_id = request_meta::request_id(&headers);
    let principal = verify_control_principal(&state, &headers).await?;
    let execution_mode = req.execution_mode();
    let is_simulation = req.is_simulation();
    let params: IssueInviteParams = decode_command_params(req.params)?;
    let host_identity = validation::user_name(&params.host_identity)?;

    if is_simulation {
        return Ok(Json(command_response(
            "issue_invite",
            "dry_run",
            false,
            vec!["execute_without_dry_run".to_string()],
            json!({
                "room_id": room_id,
                "host_identity": host_identity,
                "execution_mode": execution_mode.as_str(),
            }),
        )));
    }

    if let Some(key) = req.idempotency_key.as_deref() {
        let normalized = validate_idempotency_key(key)?;
        let actor = match &principal {
            ControlPrincipal::Admin => "admin".to_string(),
            ControlPrincipal::Host(claims) => claims.user_name.clone(),
        };
        let accepted =
            claim_command_idempotency(&state, &room_id, &actor, "issue_invite", &normalized)
                .await?;
        if !accepted {
            return Ok(Json(command_response(
                "issue_invite",
                "duplicate",
                false,
                vec!["skip_duplicate_retry".to_string()],
                json!({ "idempotency_key": normalized }),
            )));
        }
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
        "agent command issued invite"
    );
    Ok(Json(command_response(
        "issue_invite",
        "ok",
        false,
        vec![],
        json!({
            "invite_code": issued.invite_code,
            "invite_ticket": issued.invite_ticket,
            "invite_max_uses": issued.max_uses,
            "invite_url": invite_url,
            "expires_at": expires_at,
        }),
    )))
}

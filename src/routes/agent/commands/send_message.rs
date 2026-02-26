use super::claim_command_idempotency;
use crate::error::{AppError, AppResult};
use crate::request_meta;
use crate::routes::agent::auth::verify_app_session_in_room;
use crate::routes::agent::types::{CommandRequest, CommandResponse, SendMessageParams};
use crate::routes::agent::utils::{
    command_response, decode_command_params, message_snapshot, validate_idempotency_key,
};
use crate::state::AppState;
use crate::validation;
use axum::{Json, extract::ConnectInfo, http::HeaderMap};
use serde_json::json;
use std::net::SocketAddr;
use tracing::info;

pub(super) async fn run(
    state: AppState,
    peer: ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    room_id: String,
    req: CommandRequest,
) -> AppResult<Json<CommandResponse>> {
    const ROUTE: &str = "/agent/v1/commands#send_message";

    let request_id = request_meta::request_id(&headers);
    let (_token, claims, _) =
        verify_app_session_in_room(&state, &headers, &room_id, &request_id, ROUTE).await?;
    let execution_mode = req.execution_mode();
    let is_simulation = req.is_simulation();
    let mut params: SendMessageParams = decode_command_params(req.params)?;
    let text = validation::message_text(&params.text)?;

    if params.client_id.is_none() && req.idempotency_key.is_some() {
        params.client_id = req.idempotency_key.clone();
    }
    let client_id = validation::client_id(params.client_id)?;

    if is_simulation {
        return Ok(Json(command_response(
            "send_message",
            "dry_run",
            false,
            vec!["execute_without_dry_run".to_string()],
            json!({
                "room_id": room_id,
                "user_name": claims.user_name,
                "text": text,
                "client_id": client_id,
                "execution_mode": execution_mode.as_str(),
            }),
        )));
    }

    if let Some(key) = req.idempotency_key.as_deref() {
        let normalized = validate_idempotency_key(key)?;
        let accepted = claim_command_idempotency(
            &state,
            &room_id,
            &claims.user_name,
            "send_message",
            &normalized,
        )
        .await?;
        if !accepted {
            return Ok(Json(command_response(
                "send_message",
                "duplicate",
                false,
                vec!["skip_duplicate_retry".to_string()],
                json!({ "idempotency_key": normalized }),
            )));
        }
    }

    let ip = request_meta::client_ip(&state.config.trusted_proxy_ips, &headers, peer);
    let mut redis = state.redis.clone();
    state
        .rate_limit_service
        .check(
            &mut redis,
            "chat_message",
            &ip,
            state.config.rate_limit_chat_message,
            state.config.rate_limit_window_seconds,
        )
        .await?;

    let _room = state
        .storage_service
        .get_room_active(room_id.clone())
        .await?
        .ok_or_else(|| AppError::BadRequest("room not active or expired".to_string()))?;
    let profile = state
        .storage_service
        .get_user(claims.user_name.clone())
        .await?;
    if profile.is_none() {
        return Err(AppError::BadRequest(
            "user not found; upsert user first".to_string(),
        ));
    }

    let message = state
        .storage_service
        .insert_message(
            room_id.clone(),
            claims.user_name.clone(),
            claims.role.clone(),
            client_id,
            text,
        )
        .await?;
    let _ = state.chat_bus.send(message.clone());
    info!(
        request_id,
        route = ROUTE,
        room_id = message.room_id,
        user_name = message.user_name,
        result = "ok",
        "agent command created message"
    );

    Ok(Json(command_response(
        "send_message",
        "ok",
        false,
        vec![],
        json!({ "message": message_snapshot(message) }),
    )))
}

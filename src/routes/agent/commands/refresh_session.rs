use super::{claim_command_idempotency, enforce_member_media_lease};
use crate::error::{AppError, AppResult};
use crate::request_meta;
use crate::routes::agent::auth::verify_app_session_in_room;
use crate::routes::agent::types::{CommandRequest, CommandResponse};
use crate::routes::agent::utils::{
    command_response, now_ts, session_owner, validate_idempotency_key,
};
use crate::state::AppState;
use axum::{Json, http::HeaderMap};
use serde_json::json;
use tracing::{info, warn};

pub(super) async fn run(
    state: AppState,
    headers: HeaderMap,
    room_id: String,
    req: CommandRequest,
) -> AppResult<Json<CommandResponse>> {
    const ROUTE: &str = "/agent/v1/commands#refresh_session";

    let request_id = request_meta::request_id(&headers);
    let (app_session_token, claims, _) =
        verify_app_session_in_room(&state, &headers, &room_id, &request_id, ROUTE).await?;

    if req.is_simulation() {
        return Ok(Json(command_response(
            "refresh_session",
            "dry_run",
            false,
            vec!["execute_without_dry_run".to_string()],
            json!({
                "room_id": room_id,
                "user_name": claims.user_name,
                "execution_mode": req.execution_mode().as_str(),
            }),
        )));
    }

    if let Some(key) = req.idempotency_key.as_deref() {
        let normalized = validate_idempotency_key(key)?;
        let accepted = claim_command_idempotency(
            &state,
            &room_id,
            &claims.user_name,
            "refresh_session",
            &normalized,
        )
        .await?;
        if !accepted {
            return Ok(Json(command_response(
                "refresh_session",
                "duplicate",
                false,
                vec!["wait_for_previous_result".to_string()],
                json!({ "idempotency_key": normalized }),
            )));
        }
    }

    let mut redis = state.redis.clone();
    let (new_token, next_claims) = state
        .session_service
        .refresh(
            &mut redis,
            &app_session_token,
            state.config.session_ttl_seconds,
        )
        .await?;
    enforce_member_media_lease(
        &state,
        &mut redis,
        &next_claims,
        &request_id,
        "/agent/v1/commands#refresh_session",
    )
    .await?;
    let owner = session_owner(&next_claims);
    let rotated = state
        .presence_service
        .touch_owner(
            &mut redis,
            &next_claims.room_id,
            &next_claims.user_name,
            &owner,
            state.config.session_ttl_seconds,
            now_ts(),
        )
        .await?;
    if !rotated {
        let _ = state.session_service.revoke(&mut redis, &new_token).await;
        warn!(
            request_id,
            route = ROUTE,
            room_id = next_claims.room_id,
            user_name = next_claims.user_name,
            result = "denied",
            "identity lock not owned by current session"
        );
        return Err(AppError::Unauthorized(
            "identity already in use".to_string(),
        ));
    }

    info!(
        request_id,
        route = ROUTE,
        room_id = next_claims.room_id,
        user_name = next_claims.user_name,
        result = "ok",
        "agent command refreshed app session"
    );
    Ok(Json(command_response(
        "refresh_session",
        "ok",
        false,
        vec![],
        json!({
            "app_session_token": new_token,
            "app_session_expires_in_seconds": state.config.session_ttl_seconds,
        }),
    )))
}

use super::AGENT_SCHEMA_VERSION;
use super::types::{CommandCapability, CommandResponse, MessageSnapshot};
use crate::error::{AppError, AppResult};
use crate::services::session::SessionClaims;
use crate::services::storage::ChatMessage;
use serde::de::DeserializeOwned;
use serde_json::Value;

pub(super) fn command_response(
    command: &str,
    status: &str,
    retryable: bool,
    next_actions: Vec<String>,
    result: Value,
) -> CommandResponse {
    CommandResponse {
        schema_version: AGENT_SCHEMA_VERSION,
        command: command.to_string(),
        status: status.to_string(),
        retryable,
        next_actions,
        result,
    }
}

pub(super) fn command_capabilities(role: &str, host_scope_ok: bool) -> Vec<CommandCapability> {
    vec![
        CommandCapability {
            name: "refresh_session".to_string(),
            risk_level: "low".to_string(),
            auth_mode: "app_session".to_string(),
            supports_mode: true,
            supports_dry_run: true,
            requires_idempotency_key: false,
            available: true,
        },
        CommandCapability {
            name: "send_message".to_string(),
            risk_level: "low".to_string(),
            auth_mode: "app_session".to_string(),
            supports_mode: true,
            supports_dry_run: true,
            requires_idempotency_key: false,
            available: true,
        },
        CommandCapability {
            name: "issue_invite".to_string(),
            risk_level: "medium".to_string(),
            auth_mode: "control_token".to_string(),
            supports_mode: true,
            supports_dry_run: true,
            requires_idempotency_key: false,
            available: role == "host" && host_scope_ok,
        },
    ]
}

pub(super) fn message_snapshot(message: ChatMessage) -> MessageSnapshot {
    MessageSnapshot {
        seq: message.id,
        user_name: message.user_name,
        nickname: message.nickname,
        role: message.role,
        text: message.text,
        created_at: message.created_at,
        client_id: message.client_id,
    }
}

pub(super) fn decode_command_params<T>(value: Value) -> AppResult<T>
where
    T: DeserializeOwned,
{
    serde_json::from_value(value).map_err(|e| AppError::BadRequest(format!("invalid params: {e}")))
}

pub(super) fn validate_idempotency_key(raw: &str) -> AppResult<String> {
    let key = raw.trim();
    let len = key.chars().count();
    if !(8..=96).contains(&len) {
        return Err(AppError::BadRequest(
            "idempotency_key must be 8-96 chars".to_string(),
        ));
    }
    if !key
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
    {
        return Err(AppError::BadRequest(
            "idempotency_key only allows [a-zA-Z0-9_.-]".to_string(),
        ));
    }
    Ok(key.to_string())
}

pub(super) fn session_owner(claims: &SessionClaims) -> String {
    claims
        .jti
        .as_deref()
        .filter(|v| !v.is_empty())
        .unwrap_or(&claims.user_name)
        .to_string()
}

pub(super) fn now_ts() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

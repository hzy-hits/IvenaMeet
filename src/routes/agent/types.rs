use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Deserialize)]
pub(super) struct ContextQuery {
    pub(super) room_id: String,
    pub(super) message_limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub(super) struct EventsQuery {
    pub(super) room_id: String,
    pub(super) after_seq: Option<i64>,
    pub(super) limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum AgentCommandName {
    RefreshSession,
    SendMessage,
    IssueInvite,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum CommandExecutionMode {
    Simulate,
    Execute,
}

impl CommandExecutionMode {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::Simulate => "simulate",
            Self::Execute => "execute",
        }
    }
}

#[derive(Debug, Deserialize)]
pub(super) struct CommandRequest {
    pub(super) room_id: String,
    pub(super) command: AgentCommandName,
    pub(super) idempotency_key: Option<String>,
    #[serde(default)]
    pub(super) mode: Option<CommandExecutionMode>,
    #[serde(default)]
    pub(super) dry_run: bool,
    #[serde(default)]
    pub(super) params: Value,
}

impl CommandRequest {
    pub(super) fn execution_mode(&self) -> CommandExecutionMode {
        match self.mode {
            Some(mode) => mode,
            None => {
                if self.dry_run {
                    CommandExecutionMode::Simulate
                } else {
                    CommandExecutionMode::Execute
                }
            }
        }
    }

    pub(super) fn is_simulation(&self) -> bool {
        self.execution_mode() == CommandExecutionMode::Simulate
    }
}

#[derive(Debug, Deserialize)]
pub(super) struct SendMessageParams {
    pub(super) text: String,
    pub(super) client_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct IssueInviteParams {
    pub(super) host_identity: String,
}

#[derive(Debug, Serialize)]
pub(super) struct ContextResponse {
    pub(super) schema_version: &'static str,
    pub(super) generated_at: i64,
    pub(super) room: RoomSnapshot,
    pub(super) session: SessionSnapshot,
    pub(super) chat: ChatSnapshot,
    pub(super) broadcast: BroadcastSnapshot,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) invite: Option<InviteSnapshot>,
    pub(super) commands: Vec<CommandCapability>,
}

#[derive(Debug, Serialize)]
pub(super) struct RoomSnapshot {
    pub(super) room_id: String,
    pub(super) host_identity: String,
    pub(super) expires_at: i64,
}

#[derive(Debug, Serialize)]
pub(super) struct SessionSnapshot {
    pub(super) user_name: String,
    pub(super) role: String,
    pub(super) session_expires_in_seconds: u64,
    pub(super) is_expiring_soon: bool,
}

#[derive(Debug, Serialize)]
pub(super) struct ChatSnapshot {
    pub(super) latest_seq: i64,
    pub(super) next_event_cursor: i64,
    pub(super) recent_messages: Vec<MessageSnapshot>,
}

#[derive(Debug, Serialize)]
pub(super) struct MessageSnapshot {
    pub(super) seq: i64,
    pub(super) user_name: String,
    pub(super) nickname: String,
    pub(super) role: String,
    pub(super) text: String,
    pub(super) created_at: i64,
    pub(super) client_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub(super) struct BroadcastSnapshot {
    pub(super) active: bool,
    pub(super) ingress_id: Option<String>,
    pub(super) participant_identity: Option<String>,
}

#[derive(Debug, Serialize)]
pub(super) struct InviteSnapshot {
    pub(super) active_tickets: u64,
    pub(super) total_remaining_uses: u64,
}

#[derive(Debug, Serialize)]
pub(super) struct CommandCapability {
    pub(super) name: String,
    pub(super) risk_level: String,
    pub(super) auth_mode: String,
    pub(super) supports_mode: bool,
    pub(super) supports_dry_run: bool,
    pub(super) requires_idempotency_key: bool,
    pub(super) available: bool,
}

#[derive(Debug, Serialize)]
pub(super) struct EventsResponse {
    pub(super) schema_version: &'static str,
    pub(super) room_id: String,
    pub(super) after_seq: i64,
    pub(super) next_seq: i64,
    pub(super) items: Vec<EventItem>,
}

#[derive(Debug, Serialize)]
pub(super) struct EventItem {
    pub(super) seq: i64,
    #[serde(rename = "type")]
    pub(super) event_type: String,
    pub(super) at: i64,
    pub(super) payload: Value,
}

#[derive(Debug, Serialize)]
pub(super) struct CommandResponse {
    pub(super) schema_version: &'static str,
    pub(super) command: String,
    pub(super) status: String,
    pub(super) retryable: bool,
    pub(super) next_actions: Vec<String>,
    pub(super) result: Value,
}

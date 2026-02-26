use crate::error::{AppError, AppResult};
use crate::middleware::control_auth::ControlPrincipal;
use crate::request_meta;
use crate::services::livekit::PublishPermission;
use crate::services::session::SessionClaims;
use crate::services::storage::ChatMessage;
use crate::state::AppState;
use crate::validation;
use axum::{
    Json, Router,
    extract::{ConnectInfo, Query, State},
    http::{HeaderMap, header::AUTHORIZATION},
    routing::{get, post},
};
use chrono::{Duration, Utc};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::net::SocketAddr;
use tracing::{info, warn};

const AGENT_SCHEMA_VERSION: &str = "agent.v1";
const IDEMPOTENCY_TTL_SECONDS: u64 = 120;
const SESSION_EXPIRING_HINT_SECONDS: u64 = 120;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/agent/v1/context", get(get_context))
        .route("/agent/v1/events", get(list_events))
        .route("/agent/v1/commands", post(run_command))
}

#[derive(Debug, Deserialize)]
struct ContextQuery {
    room_id: String,
    message_limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct EventsQuery {
    room_id: String,
    after_seq: Option<i64>,
    limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum AgentCommandName {
    RefreshSession,
    SendMessage,
    IssueInvite,
}

#[derive(Debug, Deserialize)]
struct CommandRequest {
    room_id: String,
    command: AgentCommandName,
    idempotency_key: Option<String>,
    #[serde(default)]
    dry_run: bool,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, Deserialize)]
struct SendMessageParams {
    text: String,
    client_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct IssueInviteParams {
    host_identity: String,
}

#[derive(Debug, Serialize)]
struct ContextResponse {
    schema_version: &'static str,
    generated_at: i64,
    room: RoomSnapshot,
    session: SessionSnapshot,
    chat: ChatSnapshot,
    broadcast: BroadcastSnapshot,
    #[serde(skip_serializing_if = "Option::is_none")]
    invite: Option<InviteSnapshot>,
    commands: Vec<CommandCapability>,
}

#[derive(Debug, Serialize)]
struct RoomSnapshot {
    room_id: String,
    host_identity: String,
    expires_at: i64,
}

#[derive(Debug, Serialize)]
struct SessionSnapshot {
    user_name: String,
    role: String,
    session_expires_in_seconds: u64,
    is_expiring_soon: bool,
}

#[derive(Debug, Serialize)]
struct ChatSnapshot {
    latest_seq: i64,
    next_event_cursor: i64,
    recent_messages: Vec<MessageSnapshot>,
}

#[derive(Debug, Serialize)]
struct MessageSnapshot {
    seq: i64,
    user_name: String,
    nickname: String,
    role: String,
    text: String,
    created_at: i64,
    client_id: Option<String>,
}

#[derive(Debug, Serialize)]
struct BroadcastSnapshot {
    active: bool,
    ingress_id: Option<String>,
    participant_identity: Option<String>,
}

#[derive(Debug, Serialize)]
struct InviteSnapshot {
    active_tickets: u64,
    total_remaining_uses: u64,
}

#[derive(Debug, Serialize)]
struct CommandCapability {
    name: String,
    risk_level: String,
    auth_mode: String,
    supports_dry_run: bool,
    requires_idempotency_key: bool,
    available: bool,
}

#[derive(Debug, Serialize)]
struct EventsResponse {
    schema_version: &'static str,
    room_id: String,
    after_seq: i64,
    next_seq: i64,
    items: Vec<EventItem>,
}

#[derive(Debug, Serialize)]
struct EventItem {
    seq: i64,
    #[serde(rename = "type")]
    event_type: String,
    at: i64,
    payload: Value,
}

#[derive(Debug, Serialize)]
struct CommandResponse {
    schema_version: &'static str,
    command: String,
    status: String,
    retryable: bool,
    next_actions: Vec<String>,
    result: Value,
}

async fn get_context(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ContextQuery>,
) -> AppResult<Json<ContextResponse>> {
    const ROUTE: &str = "/agent/v1/context";

    let request_id = request_meta::request_id(&headers);
    let room_id = validation::room_id(&query.room_id)?;
    let (_token, claims, session_ttl) =
        verify_app_session_in_room(&state, &headers, &room_id, &request_id, ROUTE).await?;
    let room = state
        .storage_service
        .get_room_active(room_id.clone())
        .await?
        .ok_or_else(|| AppError::BadRequest("room not active or expired".to_string()))?;

    let message_limit = query.message_limit.unwrap_or(20).clamp(1, 80);
    let recent_messages = state
        .storage_service
        .list_messages(room_id.clone(), message_limit, None)
        .await?;
    let latest_seq = recent_messages.last().map(|m| m.id).unwrap_or(0);
    let broadcast = state
        .storage_service
        .get_room_broadcast(room_id.clone())
        .await?;

    let invite = if claims.role == "host" && room.host_identity == claims.user_name {
        let mut redis = state.redis.clone();
        match state
            .invite_service
            .list_tickets(&mut redis, &room_id)
            .await
        {
            Ok(items) => Some(InviteSnapshot {
                active_tickets: items.len() as u64,
                total_remaining_uses: items.iter().map(|v| v.remaining_uses).sum(),
            }),
            Err(err) => {
                warn!(
                    request_id,
                    route = ROUTE,
                    room_id,
                    user_name = claims.user_name,
                    error = %err,
                    "failed to load invite summary for agent context"
                );
                None
            }
        }
    } else {
        None
    };

    let response = ContextResponse {
        schema_version: AGENT_SCHEMA_VERSION,
        generated_at: now_ts(),
        room: RoomSnapshot {
            room_id: room.room_id,
            host_identity: room.host_identity.clone(),
            expires_at: room.expires_at,
        },
        session: SessionSnapshot {
            user_name: claims.user_name.clone(),
            role: claims.role.clone(),
            session_expires_in_seconds: session_ttl,
            is_expiring_soon: session_ttl <= SESSION_EXPIRING_HINT_SECONDS,
        },
        chat: ChatSnapshot {
            latest_seq,
            next_event_cursor: latest_seq,
            recent_messages: recent_messages.into_iter().map(message_snapshot).collect(),
        },
        broadcast: BroadcastSnapshot {
            active: broadcast.is_some(),
            ingress_id: broadcast.as_ref().map(|v| v.ingress_id.clone()),
            participant_identity: broadcast.as_ref().map(|v| v.participant_identity.clone()),
        },
        invite,
        commands: command_capabilities(
            claims.role.as_str(),
            room.host_identity == claims.user_name,
        ),
    };

    info!(
        request_id,
        route = ROUTE,
        room_id,
        user_name = claims.user_name,
        result = "ok",
        "agent context generated"
    );
    Ok(Json(response))
}

async fn list_events(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<EventsQuery>,
) -> AppResult<Json<EventsResponse>> {
    const ROUTE: &str = "/agent/v1/events";

    let request_id = request_meta::request_id(&headers);
    let room_id = validation::room_id(&query.room_id)?;
    let (_token, claims, _ttl) =
        verify_app_session_in_room(&state, &headers, &room_id, &request_id, ROUTE).await?;

    let _room = state
        .storage_service
        .get_room_active(room_id.clone())
        .await?
        .ok_or_else(|| AppError::BadRequest("room not active or expired".to_string()))?;

    let after_seq = query.after_seq.filter(|v| *v > 0).unwrap_or(0);
    let limit = query.limit.unwrap_or(80).clamp(1, 200);
    let messages = state
        .storage_service
        .list_messages(room_id.clone(), limit, Some(after_seq))
        .await?;

    let items = messages
        .iter()
        .map(|m| EventItem {
            seq: m.id,
            event_type: "chat.message.created".to_string(),
            at: m.created_at,
            payload: json!({
                "seq": m.id,
                "room_id": m.room_id,
                "user_name": m.user_name,
                "nickname": m.nickname,
                "role": m.role,
                "text": m.text,
                "client_id": m.client_id,
                "created_at": m.created_at,
            }),
        })
        .collect::<Vec<_>>();
    let next_seq = items.last().map(|item| item.seq).unwrap_or(after_seq);

    info!(
        request_id,
        route = ROUTE,
        room_id,
        user_name = claims.user_name,
        after_seq,
        next_seq,
        result = "ok",
        "agent events listed"
    );

    Ok(Json(EventsResponse {
        schema_version: AGENT_SCHEMA_VERSION,
        room_id,
        after_seq,
        next_seq,
        items,
    }))
}

async fn run_command(
    State(state): State<AppState>,
    peer: ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(req): Json<CommandRequest>,
) -> AppResult<Json<CommandResponse>> {
    let room_id = validation::room_id(&req.room_id)?;
    match req.command {
        AgentCommandName::RefreshSession => {
            run_refresh_session_command(state, headers, room_id, req).await
        }
        AgentCommandName::SendMessage => {
            run_send_message_command(state, peer, headers, room_id, req).await
        }
        AgentCommandName::IssueInvite => {
            run_issue_invite_command(state, headers, room_id, req).await
        }
    }
}

async fn run_refresh_session_command(
    state: AppState,
    headers: HeaderMap,
    room_id: String,
    req: CommandRequest,
) -> AppResult<Json<CommandResponse>> {
    const ROUTE: &str = "/agent/v1/commands#refresh_session";

    let request_id = request_meta::request_id(&headers);
    let (app_session_token, claims, _) =
        verify_app_session_in_room(&state, &headers, &room_id, &request_id, ROUTE).await?;

    if req.dry_run {
        return Ok(Json(command_response(
            "refresh_session",
            "dry_run",
            false,
            vec!["execute_without_dry_run".to_string()],
            json!({
                "room_id": room_id,
                "user_name": claims.user_name,
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

async fn run_send_message_command(
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
    let mut params: SendMessageParams = decode_command_params(req.params)?;
    let text = validation::message_text(&params.text)?;

    if params.client_id.is_none() && req.idempotency_key.is_some() {
        params.client_id = req.idempotency_key.clone();
    }
    let client_id = validation::client_id(params.client_id)?;

    if req.dry_run {
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

async fn run_issue_invite_command(
    state: AppState,
    headers: HeaderMap,
    room_id: String,
    req: CommandRequest,
) -> AppResult<Json<CommandResponse>> {
    const ROUTE: &str = "/agent/v1/commands#issue_invite";

    let request_id = request_meta::request_id(&headers);
    let principal = verify_control_principal(&state, &headers).await?;
    let params: IssueInviteParams = decode_command_params(req.params)?;
    let host_identity = validation::user_name(&params.host_identity)?;

    if req.dry_run {
        return Ok(Json(command_response(
            "issue_invite",
            "dry_run",
            false,
            vec!["execute_without_dry_run".to_string()],
            json!({
                "room_id": room_id,
                "host_identity": host_identity,
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

fn command_response(
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

fn command_capabilities(role: &str, host_scope_ok: bool) -> Vec<CommandCapability> {
    vec![
        CommandCapability {
            name: "refresh_session".to_string(),
            risk_level: "low".to_string(),
            auth_mode: "app_session".to_string(),
            supports_dry_run: true,
            requires_idempotency_key: false,
            available: true,
        },
        CommandCapability {
            name: "send_message".to_string(),
            risk_level: "low".to_string(),
            auth_mode: "app_session".to_string(),
            supports_dry_run: true,
            requires_idempotency_key: false,
            available: true,
        },
        CommandCapability {
            name: "issue_invite".to_string(),
            risk_level: "medium".to_string(),
            auth_mode: "control_token".to_string(),
            supports_dry_run: true,
            requires_idempotency_key: false,
            available: role == "host" && host_scope_ok,
        },
    ]
}

fn message_snapshot(message: ChatMessage) -> MessageSnapshot {
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

fn decode_command_params<T>(value: Value) -> AppResult<T>
where
    T: DeserializeOwned,
{
    serde_json::from_value(value).map_err(|e| AppError::BadRequest(format!("invalid params: {e}")))
}

fn bearer_from_headers(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
}

async fn verify_app_session_in_room(
    state: &AppState,
    headers: &HeaderMap,
    room_id: &str,
    request_id: &str,
    route: &'static str,
) -> AppResult<(String, SessionClaims, u64)> {
    let token = bearer_from_headers(headers)
        .ok_or_else(|| AppError::Unauthorized("missing app session token".to_string()))?;
    let mut redis = state.redis.clone();
    let claims = state.session_service.verify(&mut redis, token).await?;
    if claims.room_id != room_id {
        warn!(
            request_id,
            route,
            user_name = claims.user_name,
            token_room_id = claims.room_id,
            path_room_id = room_id,
            result = "denied",
            "agent app session room mismatch"
        );
        return Err(AppError::Unauthorized(
            "app session does not match room".to_string(),
        ));
    }
    let ttl = state.session_service.ttl_seconds(&mut redis, token).await?;
    Ok((token.to_string(), claims, ttl))
}

async fn verify_control_principal(
    state: &AppState,
    headers: &HeaderMap,
) -> AppResult<ControlPrincipal> {
    let token = bearer_from_headers(headers)
        .ok_or_else(|| AppError::Unauthorized("missing control token".to_string()))?;

    if token == state.config.admin_token {
        return Ok(ControlPrincipal::Admin);
    }

    let mut redis = state.redis.clone();
    let claims = state
        .host_session_service
        .verify(&mut redis, token)
        .await
        .map_err(|_| AppError::Unauthorized("invalid control token".to_string()))?;
    if claims.role != "host" {
        return Err(AppError::Unauthorized(
            "control token is not host role".to_string(),
        ));
    }
    Ok(ControlPrincipal::Host(claims))
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
                "agent host token scope mismatch"
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
            "agent host identity mismatch"
        );
        return Err(AppError::Unauthorized("host identity mismatch".to_string()));
    }
    Ok(())
}

async fn claim_command_idempotency(
    state: &AppState,
    room_id: &str,
    actor: &str,
    command: &str,
    key: &str,
) -> AppResult<bool> {
    let redis_key = format!("agent:idempotency:{room_id}:{actor}:{command}:{key}");
    let mut redis = state.redis.clone();
    let result: Option<String> = redis::cmd("SET")
        .arg(redis_key)
        .arg("1")
        .arg("NX")
        .arg("EX")
        .arg(IDEMPOTENCY_TTL_SECONDS)
        .query_async(&mut redis)
        .await
        .map_err(|e| AppError::Redis(e.to_string()))?;
    Ok(result.is_some())
}

fn validate_idempotency_key(raw: &str) -> AppResult<String> {
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

fn session_owner(claims: &SessionClaims) -> String {
    claims
        .jti
        .as_deref()
        .filter(|v| !v.is_empty())
        .unwrap_or(&claims.user_name)
        .to_string()
}

async fn enforce_member_media_lease(
    state: &AppState,
    redis: &mut redis::aio::ConnectionManager,
    claims: &SessionClaims,
    request_id: &str,
    route: &'static str,
) -> AppResult<()> {
    if claims.role != "member" {
        return Ok(());
    }

    let effective = state
        .stage_permission_service
        .resolve_member(
            redis,
            &claims.room_id,
            &claims.user_name,
            state.config.room_ttl_seconds,
            now_ts(),
        )
        .await?;

    if !(effective.expired_camera || effective.expired_screen_share) {
        return Ok(());
    }

    state
        .livekit_service
        .update_participant_publish_permission(
            &claims.room_id,
            &claims.user_name,
            PublishPermission {
                camera: effective.camera_allowed,
                screen_share: effective.screen_share_allowed,
            },
        )
        .await?;

    if effective.expired_camera {
        let _ = state
            .livekit_service
            .mute_participant_track_source(
                &claims.room_id,
                &claims.user_name,
                livekit_protocol::TrackSource::Camera,
                true,
            )
            .await?;
    }
    if effective.expired_screen_share {
        let _ = state
            .livekit_service
            .mute_participant_track_source(
                &claims.room_id,
                &claims.user_name,
                livekit_protocol::TrackSource::ScreenShare,
                true,
            )
            .await?;
    }

    warn!(
        request_id,
        route,
        room_id = claims.room_id,
        user_name = claims.user_name,
        expired_camera = effective.expired_camera,
        expired_screen_share = effective.expired_screen_share,
        result = "lease_expired",
        "member media grant lease expired; publish permission revoked"
    );

    Ok(())
}

fn now_ts() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

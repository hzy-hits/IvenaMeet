use crate::error::{AppError, AppResult};
use crate::request_meta;
use crate::services::session::SessionClaims;
use crate::services::storage::ChatMessage;
use crate::state::AppState;
use crate::validation;
use axum::{
    Json, Router,
    extract::{ConnectInfo, Path, Query, State},
    http::{HeaderMap, header::AUTHORIZATION},
    response::sse::{Event, KeepAlive, Sse},
    routing::{get, post},
};
use futures_util::stream::StreamExt;
use serde::{Deserialize, Serialize};
use std::{convert::Infallible, net::SocketAddr, time::Duration};
use tokio::sync::broadcast::error::RecvError;
use tokio::time::MissedTickBehavior;
use tracing::{info, warn};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/rooms/:room_id/messages", get(list_messages))
        .route("/rooms/:room_id/messages", post(create_message))
        .route("/rooms/:room_id/messages/stream", get(stream_messages))
}

#[derive(Debug, Deserialize)]
struct ListQuery {
    limit: Option<i64>,
    after_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct StreamQuery {
    after_id: Option<i64>,
}

struct LiveStreamState {
    state: AppState,
    room_id: String,
    request_id: String,
    route: &'static str,
    after_id: i64,
    app_session_token: String,
    rx: tokio::sync::broadcast::Receiver<ChatMessage>,
    auth_check_interval: tokio::time::Interval,
}

#[derive(Debug, Serialize)]
struct ListMessagesResp {
    items: Vec<MessageItem>,
}

#[derive(Debug, Deserialize)]
struct CreateMessageReq {
    text: String,
    client_id: Option<String>,
}

#[derive(Debug, Serialize)]
struct MessageItem {
    id: i64,
    room_id: String,
    user_name: String,
    nickname: String,
    avatar_url: Option<String>,
    role: String,
    client_id: Option<String>,
    text: String,
    created_at: i64,
}

async fn list_messages(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<ListQuery>,
) -> AppResult<Json<ListMessagesResp>> {
    let request_id = request_meta::request_id(&headers);
    let room_id = validation::room_id(&room_id)?;
    let claims = verify_app_session_in_room(
        &state,
        &headers,
        &room_id,
        &request_id,
        "/rooms/:room_id/messages [GET]",
    )
    .await?;

    let _room = state
        .storage_service
        .get_room_active(room_id.clone())
        .await?
        .ok_or_else(|| AppError::BadRequest("room not active or expired".to_string()))?;

    let limit = query.limit.unwrap_or(50).clamp(1, 200);
    let after_id = query.after_id.filter(|v| *v > 0);
    let messages = state
        .storage_service
        .list_messages(room_id, limit, after_id)
        .await?;
    info!(
        request_id,
        route = "/rooms/:room_id/messages [GET]",
        user_name = claims.user_name,
        limit,
        after_id = after_id.unwrap_or(0),
        result = "ok",
        "messages listed"
    );

    Ok(Json(ListMessagesResp {
        items: messages.into_iter().map(message_item).collect(),
    }))
}

async fn create_message(
    State(state): State<AppState>,
    peer: ConnectInfo<SocketAddr>,
    Path(room_id): Path<String>,
    headers: HeaderMap,
    Json(req): Json<CreateMessageReq>,
) -> AppResult<Json<MessageItem>> {
    let request_id = request_meta::request_id(&headers);
    let room_id = validation::room_id(&room_id)?;
    let text = validation::message_text(&req.text)?;
    let client_id = validation::client_id(req.client_id)?;

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

    let claims = verify_app_session_in_room(
        &state,
        &headers,
        &room_id,
        &request_id,
        "/rooms/:room_id/messages [POST]",
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

    let m = state
        .storage_service
        .insert_message(room_id, claims.user_name, claims.role, client_id, text)
        .await?;
    let _ = state.chat_bus.send(m.clone());
    info!(
        request_id,
        route = "/rooms/:room_id/messages [POST]",
        room_id = m.room_id,
        user_name = m.user_name,
        ip,
        result = "ok",
        "message created"
    );

    Ok(Json(message_item(m)))
}

async fn stream_messages(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<StreamQuery>,
) -> AppResult<Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>>> {
    const STREAM_ROUTE: &str = "/rooms/:room_id/messages/stream [GET]";

    let request_id = request_meta::request_id(&headers);
    let room_id = validation::room_id(&room_id)?;
    let after_id = query.after_id.filter(|v| *v > 0).unwrap_or(0);

    let app_session_token = bearer_from_headers(&headers)
        .ok_or_else(|| AppError::Unauthorized("missing app session token".to_string()))?;
    let app_session_token = app_session_token.to_string();
    let mut redis = state.redis.clone();
    let claims = state
        .session_service
        .verify(&mut redis, &app_session_token)
        .await?;
    if claims.room_id != room_id {
        warn!(
            request_id,
            route = STREAM_ROUTE,
            user_name = claims.user_name,
            token_room_id = claims.room_id,
            path_room_id = room_id,
            result = "denied",
            "room mismatch for session token"
        );
        return Err(AppError::Unauthorized(
            "app session does not match room".to_string(),
        ));
    }

    let _room = state
        .storage_service
        .get_room_active(room_id.clone())
        .await?
        .ok_or_else(|| AppError::BadRequest("room not active or expired".to_string()))?;

    let backlog = state
        .storage_service
        .list_messages(room_id.clone(), 200, Some(after_id))
        .await?;
    let initial = tokio_stream::iter(
        backlog
            .into_iter()
            .map(|m| Ok::<Event, Infallible>(message_event(m))),
    );

    let mut auth_check_interval = tokio::time::interval(Duration::from_secs(10));
    auth_check_interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let live = futures_util::stream::unfold(
        LiveStreamState {
            state: state.clone(),
            room_id: room_id.clone(),
            request_id: request_id.clone(),
            route: STREAM_ROUTE,
            after_id,
            app_session_token,
            rx: state.chat_bus.subscribe(),
            auth_check_interval,
        },
        |mut live_state| async move {
            loop {
                tokio::select! {
                    _ = live_state.auth_check_interval.tick() => {
                        if let Err(err) = ensure_stream_session_active(
                            &live_state.state,
                            &live_state.app_session_token,
                            &live_state.room_id,
                        ).await {
                            warn!(
                                request_id = live_state.request_id.as_str(),
                                route = live_state.route,
                                room_id = live_state.room_id.as_str(),
                                error = %err,
                                result = "closed",
                                "message stream closed due invalid app session"
                            );
                            return None;
                        }
                    }
                    next = live_state.rx.recv() => match next {
                        Ok(m)
                            if m.room_id.as_str() == live_state.room_id.as_str()
                                && m.id > live_state.after_id =>
                        {
                            if let Err(err) = ensure_stream_session_active(
                                &live_state.state,
                                &live_state.app_session_token,
                                &live_state.room_id,
                            )
                            .await
                            {
                                warn!(
                                    request_id = live_state.request_id.as_str(),
                                    route = live_state.route,
                                    room_id = live_state.room_id.as_str(),
                                    error = %err,
                                    result = "closed",
                                    "message stream closed due invalid app session"
                                );
                                return None;
                            }
                            return Some((Ok::<Event, Infallible>(message_event(m)), live_state));
                        }
                        Ok(_) => {}
                        Err(RecvError::Lagged(skipped)) => {
                            if let Err(err) = ensure_stream_session_active(
                                &live_state.state,
                                &live_state.app_session_token,
                                &live_state.room_id,
                            )
                            .await
                            {
                                warn!(
                                    request_id = live_state.request_id.as_str(),
                                    route = live_state.route,
                                    room_id = live_state.room_id.as_str(),
                                    error = %err,
                                    result = "closed",
                                    "message stream closed due invalid app session"
                                );
                                return None;
                            }
                            return Some((
                                Ok::<Event, Infallible>(
                                    Event::default().event("lagged").data(skipped.to_string()),
                                ),
                                live_state,
                            ));
                        }
                        Err(RecvError::Closed) => return None,
                    },
                }
            }
        },
    );

    info!(
        request_id,
        route = STREAM_ROUTE,
        room_id,
        user_name = claims.user_name,
        after_id,
        result = "ok",
        "message stream opened"
    );

    Ok(Sse::new(initial.chain(live)).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keepalive"),
    ))
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
) -> AppResult<SessionClaims> {
    let app_session_token = bearer_from_headers(headers)
        .ok_or_else(|| AppError::Unauthorized("missing app session token".to_string()))?;
    let mut redis = state.redis.clone();
    let claims = state
        .session_service
        .verify(&mut redis, app_session_token)
        .await?;
    if claims.room_id != room_id {
        warn!(
            request_id,
            route,
            user_name = claims.user_name.as_str(),
            token_room_id = claims.room_id.as_str(),
            path_room_id = room_id,
            result = "denied",
            "room mismatch for session token"
        );
        return Err(AppError::Unauthorized(
            "app session does not match room".to_string(),
        ));
    }
    Ok(claims)
}

async fn ensure_stream_session_active(
    state: &AppState,
    app_session_token: &str,
    room_id: &str,
) -> AppResult<()> {
    let mut redis = state.redis.clone();
    let claims = state
        .session_service
        .verify(&mut redis, app_session_token)
        .await?;
    if claims.room_id != room_id {
        return Err(AppError::Unauthorized(
            "app session does not match room".to_string(),
        ));
    }
    Ok(())
}

fn message_item(m: ChatMessage) -> MessageItem {
    MessageItem {
        id: m.id,
        room_id: m.room_id,
        user_name: m.user_name,
        nickname: m.nickname,
        avatar_url: m.avatar_url,
        role: m.role,
        client_id: m.client_id,
        text: m.text,
        created_at: m.created_at,
    }
}

fn message_event(m: ChatMessage) -> Event {
    let item = message_item(m);
    let data = serde_json::to_string(&item)
        .unwrap_or_else(|_| "{\"error\":\"failed to serialize message\"}".to_string());
    Event::default().event("message").data(data)
}

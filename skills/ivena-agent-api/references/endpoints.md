# Endpoints

## Base assumptions

- Backend env `ENABLE_AGENT_API=true`
- All routes available on root and `/api` prefixes
- `schema_version` is currently `agent.v1`

## 1) Context

`GET /agent/v1/context?room_id=<room_id>&message_limit=20`

Auth:

- `Authorization: Bearer <app_session_token>`

Purpose:

- Return room/session/chat/broadcast snapshot
- Return command capability matrix

## 2) Events

`GET /agent/v1/events?room_id=<room_id>&after_seq=0&limit=80`

Auth:

- `Authorization: Bearer <app_session_token>`

Purpose:

- Return ordered incremental events
- Use `next_seq` as next polling cursor

Current event type:

- `chat.message.created`

## 3) Commands

`POST /agent/v1/commands`

Body:

```json
{
  "room_id": "test",
  "command": "send_message",
  "mode": "execute",
  "idempotency_key": "agent-msg-00000001",
  "params": {
    "text": "hello"
  }
}
```

Compatibility:

- Preferred: `mode: "simulate" | "execute"`
- Legacy fallback: `dry_run: true | false` (still accepted)

Supported commands:

- `refresh_session` (app session bearer)
- `send_message` (app session bearer)
- `issue_invite` (control bearer: host session or admin)

Command response status:

- `ok`: command executed
- `dry_run`: simulation only
- `duplicate`: idempotency dedupe hit

## Command auth matrix

| Command | Bearer token |
|---|---|
| `refresh_session` | app session token |
| `send_message` | app session token |
| `issue_invite` | host session token or admin token |

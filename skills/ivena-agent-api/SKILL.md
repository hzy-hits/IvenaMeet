---
name: ivena-agent-api
description: Operate Ivena Meet AI-native backend routes (`/agent/v1/context`, `/agent/v1/events`, `/agent/v1/commands`) for external agents such as Claude/Claw. Use when building or running agent workflows for room monitoring, session recovery, message delivery, or invite automation without changing existing room/auth/chat endpoints.
---

# Ivena Agent API

## Overview

Use this skill to run agent workflows against the control plane's `agent/v1` integration surface.
Keep existing product logic untouched and drive automation through additive routes only.

## Workflow

1. Read `references/endpoints.md` to confirm auth mode and request/response contract.
2. Call `GET /agent/v1/context` first and cache `next_event_cursor`.
3. Call `GET /agent/v1/events` with `after_seq` to get incremental updates.
4. Build decision from context+events before issuing any command.
5. Call `POST /agent/v1/commands` with `mode=simulate` first for risky branches (`dry_run` remains fallback compatibility).
6. For retries or network uncertainty, include `idempotency_key`.
7. Write operational logs with `room_id`, `command`, `status`, and `idempotency_key`.

## Guardrails

- Do not call legacy routes directly when equivalent command exists in `/agent/v1/commands`.
- Use app-session bearer token for `refresh_session` and `send_message`.
- Use control bearer token (host session/admin) for `issue_invite`.
- Reject plans that require elevated commands not exposed by `agent/v1`.
- Treat `status=duplicate` as successful dedupe, not failure.

## Output Contract

When reporting execution, include:

1. `observed_state`: key context fields used for decision.
2. `actions_taken`: commands executed and whether `simulate` or `execute`.
3. `result`: command status and returned payload summary.
4. `next_step`: polling cursor or human escalation suggestion.

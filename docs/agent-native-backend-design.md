# Agent-Native Backend Design (Non-Breaking)

## 1. Design Goal
- Human-facing frontend remains unchanged.
- Agent-facing backend provides stable machine-readable state and action contracts.
- Existing business logic is reused via adapters; no silent behavior fork.

## 2. Contract Layers

### Read Layer
- `GET /agent/v1/context`: normalized room/session/chat/broadcast snapshot.
- `GET /agent/v1/events`: cursor-based incremental events.
- Requirement: responses are deterministic, typed, and monotonic by sequence.

### Action Layer
- `POST /agent/v1/commands`: command envelope for low/medium-risk operations.
- Current commands: `refresh_session`, `send_message`, `issue_invite`.
- `idempotency_key` prevents duplicate side effects on retries.

### Policy Layer
- Low risk: execute directly with auth + rate-limit + idempotency.
- Medium risk: host/admin scope checks + optional approval gate.
- High risk (future): always requires explicit approval token.

## 3. Evolving Dry Run
- Keep backward compatibility with `dry_run`.
- Prefer `mode: "simulate" | "execute"` as clearer semantics.
- `simulate` should return:
  - policy decision (`allowed` / `denied`)
  - preconditions (missing auth/scope/params)
  - expected side effects summary
- `execute` should reuse the same validation path to avoid drift.

## 4. Agent Interaction Model (Not Human UI)
- Agent does not need visual UI; it needs predictable actionability metadata.
- Recommended additions to `context`:
  - `state_version` (for optimistic execution)
  - `capabilities` with risk/auth/availability
  - `recommended_next_actions` with machine-readable reasons
- Recommended additions to command response:
  - `execution_mode`
  - `decision_trace_id`
  - `retry_after_ms` (when rate-limited)

## 5. Rollout Plan
1. MVP (already aligned): read snapshots/events + low-risk writes.
2. Low-risk writable hardening: `mode`, richer simulation output, stronger idempotency defaults.
3. Medium-risk orchestration: approval gate + policy audit logs.
4. Multi-agent coordination: task ownership and conflict handling by `state_version`.

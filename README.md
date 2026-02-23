# LiveKit Rust Control Plane (Axum + Redis + SQLite)

## Repo layout

```txt
.
├── src/                     # Rust control-plane
├── apps/
│   └── frontend/            # React + Vite frontend
├── vendor/livekit-api/      # temporary patched dependency
└── .github/workflows/ci.yml
```

## Capabilities

- `POST /rooms/join`
  - `role=host|member`
  - `host` join supports `Authorization: Bearer <host_session_token>` (or `ADMIN_TOKEN` for bootstrap)
  - room lifetime enforced (`ROOM_TTL_SECONDS`, default 4h)
  - returns short-lived `app_session_token` for app-level write APIs
- `POST /host/login/totp`
  - host login by `room_id + host_identity + totp_code`
  - returns short-lived `host_session_token`
- `POST /host/sessions/refresh`
  - rotate/refresh `host_session_token` before expiry
- `POST /sessions/refresh`
  - rotate/refresh `app_session_token` before expiry
- `POST /auth/invite` (control)
  - issue one-time invite link ticket + invite code
- `POST /invites/redeem`
  - redeem `ticket + invite_code` to short-lived `redeem_token`
- `POST /broadcast/issue` (control)
  - issue one-time short-lived broadcast start token
- `POST /broadcast/start` (control)
  - requires `start_token` and host binding check
- `POST /broadcast/stop` (control)
- `POST /users/upsert`
- `GET /rooms/:room_id/messages`
- `POST /rooms/:room_id/messages`
  - requires `Authorization: Bearer <app_session_token>`
- `GET /healthz`

## Security model

- Control routes require `Authorization: Bearer <host_session_token>`:
  - `/auth/invite`
  - `/broadcast/*`
  - `/moderation/*`
- Admin token is reserved for management/bootstrap APIs (e.g. `/host/mfa/enroll`).
- `broadcast/start` is protected by:
  - control auth
  - room active check
  - host identity binding
  - one-time `start_token`
  - rate limit
- Member join can require invite flow (`REQUIRE_INVITE=true`):
  - redeem link ticket + invite code first
  - pass returned `redeem_token` to `/rooms/join`
- Chat write identity is bound to backend-issued `app_session_token` (client body cannot forge `user_name`).
- Rate limits (Redis):
  - `room_join`
  - `invite_redeem`
  - `broadcast_start`
- Client IP is taken from direct peer address by default; `x-forwarded-for` is only trusted when peer IP is in `TRUSTED_PROXY_IPS`.
- Input validation (centralized):
  - `room_id`: `[a-zA-Z0-9_-]`, 3-64 chars
  - `user_name`: `[a-zA-Z0-9_-]`, 2-32 chars
  - `nickname`: 2-32 chars
  - `message.text`: 1-500 chars
  - `avatar_url`: optional `https://`, max 512 chars
- Request tracing:
  - `x-request-id` is auto-generated if missing and echoed back in response headers
  - key routes emit structured logs with `request_id/route/room_id/user_name/ip/result`

## Run

```bash
cd /opt/livekit/control-plane
cp .env.example .env
cargo run
```

## Systemd (auto start backend + frontend)

Service templates are under `deploy/systemd/`:
- `ivena-meet-control-plane.service`
- `ivena-meet-frontend.service`

Install and enable:

```bash
cd /opt/livekit/control-plane
sudo ./deploy/systemd/install.sh
```

Then complete runtime files and build:

```bash
cp /opt/livekit/control-plane/deploy/env/frontend.env.example /opt/livekit/control-plane/deploy/env/frontend.env
# edit /opt/livekit/control-plane/.env
```

One-command deploy (build + restart services):

```bash
/opt/livekit/control-plane/deploy/systemd/deploy.sh
```

Check status/logs:

```bash
systemctl status ivena-meet-control-plane.service --no-pager
systemctl status ivena-meet-frontend.service --no-pager
journalctl -u ivena-meet-control-plane.service -f
journalctl -u ivena-meet-frontend.service -f
```

## Bootstrap a host (one command)

Add a new host and bind it to a room in one step:

```bash
cd /opt/livekit/control-plane
ADMIN_TOKEN='replace-with-strong-random-token' ROOM_ID='test' HOST_IDENTITY='alice_host' make bootstrap-host
```

This command does two admin operations:
- enroll host MFA (`/host/mfa/enroll`)
- create/refresh host room binding (`/rooms/join role=host`)

The output includes `otpauth_url` for Google Authenticator scanning.

Run frontend:

```bash
cd /opt/livekit/control-plane/apps/frontend
npm install
npm run dev -- --host 0.0.0.0 --port 8090
```

## Bearer admin token usage (bootstrap/management only)

`Bearer ADMIN_TOKEN` is passed in the HTTP header:

```bash
-H "authorization: Bearer $ADMIN_TOKEN"
```

## Required env

- `APP_BIND` default `0.0.0.0:3000`
- `REDIS_URL` default `redis://127.0.0.1:6379/`
- `SQLITE_PATH` default `/opt/livekit/control-plane/data/app.db`
- `MEET_BASE_URL` default `https://meet.ivena.top`
- `LIVEKIT_HOST`
- `LIVEKIT_PUBLIC_WS_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `ADMIN_TOKEN`

## Config map (single places to edit)

- Backend env + defaults:
  - `.env` / `.env.example`
  - `src/config.rs`
- Frontend env + defaults:
  - `apps/frontend/.env` / `apps/frontend/.env.example`
  - `apps/frontend/src/lib/env.ts`
- Host bootstrap helper:
  - `scripts/bootstrap-host.sh`
  - `Makefile` (`make bootstrap-host`)
- Full dictionary:
  - `docs/config-dictionary.md`

## Optional env

- `TOKEN_TTL_SECONDS` default `14400`
- `INVITE_TTL_SECONDS` default `86400`
- `REDEEM_TTL_SECONDS` default `300`
- `ROOM_TTL_SECONDS` default `14400`
- `BROADCAST_ISSUE_TTL_SECONDS` default `120`
- `INVITE_PREFIX` default `invite`
- `SESSION_PREFIX` default `appsession`
- `SESSION_TTL_SECONDS` default `1800`
- `REQUIRE_INVITE` default `false`
- `REQUIRE_ADMIN_FOR_JOIN` default `false`
- `RATE_LIMIT_WINDOW_SECONDS` default `60`
- `RATE_LIMIT_ROOM_JOIN` default `20`
- `RATE_LIMIT_INVITE_REDEEM` default `12`
- `RATE_LIMIT_BROADCAST_START` default `3`
- `TRUSTED_PROXY_IPS` default empty (example: `127.0.0.1,192.168.1.20`)

## End-to-end flow (invite + secure start)

1. Bootstrap host once (`make bootstrap-host`) to enroll MFA and bind room.
2. Host logs in with TOTP (`/host/login/totp`) and gets `host_session_token`.
3. Host joins room (`/rooms/join role=host`, bearer `host_session_token`).
4. Host issues invite (`/auth/invite`) -> `invite_ticket + invite_code + invite_url`.
5. Member redeems invite (`/invites/redeem`) -> `redeem_token`.
6. Member joins (`/rooms/join` with `redeem_token`).
7. Host issues broadcast token (`/broadcast/issue`).
8. Host starts broadcast (`/broadcast/start` with `start_token`).

## Reverse proxy (recommended)

- `meet.ivena.top` -> `192.168.1.108:8090` (frontend)
- `meet.ivena.top/api` -> `192.168.1.108:3000` (control-plane)
- `livekit.ivena.top` -> LiveKit server (WSS)

Nginx Proxy Manager mapping:
- Proxy host A (`meet.ivena.top`):
  - forward to `http://192.168.1.108:8090`
  - add advanced location `/api` -> `http://192.168.1.108:3000`
- Proxy host B (`livekit.ivena.top`):
  - forward to `http://192.168.1.108:7880`
  - enable SSL + WebSocket
- Add NPM internal IP to backend `TRUSTED_PROXY_IPS`.

## Minimal curl

```bash
# 1) bootstrap once (admin)
ADMIN_TOKEN='replace-with-strong-random-token' ROOM_ID='test' HOST_IDENTITY='host-1' make bootstrap-host

# 2) host login with TOTP
curl -sS -X POST http://127.0.0.1:3000/host/login/totp \
  -H 'content-type: application/json' \
  -d '{"room_id":"test","host_identity":"host-1","totp_code":"123456"}'

# 3) host join with host_session_token
curl -sS -X POST http://127.0.0.1:3000/rooms/join \
  -H "authorization: Bearer <host_session_token>" \
  -H 'content-type: application/json' \
  -d '{"room_id":"test","user_name":"host-1","role":"host"}'

# 4) issue invite
curl -sS -X POST http://127.0.0.1:3000/auth/invite \
  -H "authorization: Bearer <host_session_token>" \
  -H 'content-type: application/json' \
  -d '{"room_id":"test","host_identity":"host-1"}'

# 5) redeem invite
curl -sS -X POST http://127.0.0.1:3000/invites/redeem \
  -H 'content-type: application/json' \
  -d '{"room_id":"test","user_name":"alice","invite_ticket":"<ticket>","invite_code":"<code>"}'

# 6) member join with redeem_token
curl -sS -X POST http://127.0.0.1:3000/rooms/join \
  -H 'content-type: application/json' \
  -d '{"room_id":"test","user_name":"alice","role":"member","redeem_token":"<redeem_token>"}'

# 4.1) write message with app_session_token from join response
curl -sS -X POST http://127.0.0.1:3000/rooms/test/messages \
  -H "authorization: Bearer <app_session_token>" \
  -H 'content-type: application/json' \
  -d '{"text":"hello"}'

# 4.2) refresh app_session_token before expiry
curl -sS -X POST http://127.0.0.1:3000/sessions/refresh \
  -H "authorization: Bearer <app_session_token>" \
  -H 'content-type: application/json' \
  -d '{}'

# 7) issue short broadcast start token
curl -sS -X POST http://127.0.0.1:3000/broadcast/issue \
  -H "authorization: Bearer <host_session_token>" \
  -H 'content-type: application/json' \
  -d '{"room_id":"test","host_identity":"host-1"}'

# 8) start broadcast with one-time token
curl -sS -X POST http://127.0.0.1:3000/broadcast/start \
  -H "authorization: Bearer <host_session_token>" \
  -H 'content-type: application/json' \
  -d '{"room_id":"test","participant_identity":"host-1","start_token":"<start_token>"}'
```

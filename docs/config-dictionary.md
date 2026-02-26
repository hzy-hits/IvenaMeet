# Configuration Dictionary

This file is the single reference for runtime config in this repo.

## Backend (`.env`, `src/config.rs`)

| Key | Default | Purpose | Recommended |
|---|---|---|---|
| `APP_BIND` | `0.0.0.0:3000` | Control-plane bind address | Keep default unless port conflict |
| `REDIS_URL` | `redis://127.0.0.1:6379/` | Redis for sessions/rate limits/invites | Use local/private Redis with auth in production |
| `SQLITE_PATH` | `/opt/livekit/control-plane/data/app.db` | SQLite file path | Place on persistent disk |
| `MEET_BASE_URL` | `https://meet.ivena.top` | Base URL for generated invite links | Set to your public meet domain |
| `LIVEKIT_HOST` | required | LiveKit HTTP API endpoint | Use internal/private address if possible |
| `LIVEKIT_PUBLIC_WS_URL` | `wss://livekit.ivena.top` | WS URL returned to clients | Set to public WSS domain |
| `LIVEKIT_API_KEY` | required | LiveKit API key | Use non-default key |
| `LIVEKIT_API_SECRET` | required | LiveKit API secret | Strong random secret |
| `TOKEN_TTL_SECONDS` | `14400` | LiveKit room token TTL | `14400` (4h) |
| `INVITE_TTL_SECONDS` | `86400` | Invite ticket TTL | `86400` (24h) |
| `INVITE_MAX_USES` | `10` | Max successful redeem count per invite ticket | `5-20` (e.g. `10`) |
| `REDEEM_TTL_SECONDS` | `300` | Redeem token TTL | `300` (5m) |
| `ROOM_TTL_SECONDS` | `14400` | Room active lifetime | `14400` (4h) |
| `BROADCAST_ISSUE_TTL_SECONDS` | `120` | Broadcast start token TTL | `60-180` |
| `INVITE_PREFIX` | `invite` | Redis key prefix (invite flow) | Keep default unless key namespace conflict |
| `SESSION_PREFIX` | `appsession` | Redis key prefix (app session) | Keep default |
| `SESSION_TTL_SECONDS` | `1800` | App session TTL (chat writes) | `1800` |
| `HOST_SESSION_PREFIX` | `hostsession` | Redis key prefix (host session) | Keep default |
| `HOST_SESSION_TTL_SECONDS` | `900` | Host session TTL | `900-1200` |
| `HOST_AUTH_PREFIX` | `hostauth` | Redis key prefix (host MFA data) | Keep default |
| `HOST_MFA_ISSUER` | `Ivena Meet` | TOTP issuer text in authenticator | Your product/team name |
| `REQUIRE_INVITE` | `false` | Require invite-redeem for member join | `true` on public deployments |
| `ENABLE_AGENT_API` | `false` | Enable `/agent/v1/*` integration routes for external AI agents (context/events/commands) | Keep `false` by default; enable in controlled envs |
| `ADMIN_TOKEN` | required | Admin bearer token | Long random value, rotate periodically |
| `REQUIRE_ADMIN_FOR_JOIN` | `false` | Require admin middleware for `/rooms/join` | Keep `false` for normal host/member flow |
| `RATE_LIMIT_WINDOW_SECONDS` | `60` | Rate limit window | `60` |
| `RATE_LIMIT_ROOM_JOIN` | `20` | Max room joins per window per IP | `10-20` |
| `RATE_LIMIT_INVITE_REDEEM` | `12` | Max invite redeem/login attempts per window per IP | `8-12` |
| `RATE_LIMIT_HOST_LOGIN_TOTP` | `12` | Max host TOTP login attempts per window per IP | `6-12` |
| `RATE_LIMIT_BROADCAST_START` | `3` | Max broadcast starts per window per IP | `3` |
| `RATE_LIMIT_CHAT_MESSAGE` | `30` | Max chat messages created per window per IP | `20-40` |
| `TRUSTED_PROXY_IPS` | `127.0.0.1,192.168.1.20` (example) | Only these peer IPs may provide trusted forwarded IP headers | List only your reverse proxies |
| `RUST_LOG` | `info` | Log level/filter | `info` or `warn` for production |

## Frontend (`apps/frontend/.env`, `apps/frontend/src/lib/env.ts`)

| Key | Default | Purpose | Recommended |
|---|---|---|---|
| `VITE_API_BASE_URL` | `/api` | Frontend API base path | Keep `/api` behind reverse proxy |
| `VITE_REQUIRE_INVITE` | `true` | Invite gate behavior in UI | `true` on public deployments |
| `VITE_DEFAULT_ROOM_ID` | `test` | Initial room value in join modal | Set to your common room or leave `test` |
| `VITE_DEFAULT_USER_NAME` | `guest_01` | Initial user name placeholder value | `guest_01` |
| `VITE_DEFAULT_ROLE` | `member` | Initial role in UI | `member` |
| `VITE_DEV_AUTH_BYPASS` | `false` | Dev-only bypass switch. When `true`, query `?debug=mobile` creates local mock join state and skips invite/join gating | Keep `false` outside local debugging |
| `VITE_DEV_DISABLE_LIVEKIT` | `false` | Dev-only flag to disable LiveKit connection while in `?debug=mobile` mode | Set `true` for pure UI debugging without backend |
| `VITE_LOG_MAX_LINES` | `250` | Max in-memory log lines in sidebar | `200-500` |
| `VITE_CHAT_HISTORY_LIMIT` | `80` | Message history fetch count | `50-100` |
| `VITE_CHAT_SYNC_POLL_MS` | `3000` | Chat incremental sync polling interval | `2000-5000` |
| `VITE_SESSION_REFRESH_POLL_MS` | `30000` | Session refresh polling interval | `30000` |
| `VITE_SESSION_REFRESH_BEFORE_SECONDS` | `120` | How early to refresh before expiry | `60-120` |
| `VITE_INVITE_COPY_HINT_MS` | `1800` | "copied" success hint duration | `1200-2000` |
| `VITE_AVATAR_MAX_BYTES` | `2097152` | Avatar upload client-side size limit | `1048576-3145728` |

## Bootstrap Script Vars (`scripts/bootstrap-host.sh`)

| Key | Default | Purpose | Recommended |
|---|---|---|---|
| `API_BASE_URL` | `http://127.0.0.1:3000` | Control-plane URL used by bootstrap script | Internal API address |
| `ADMIN_TOKEN` | required | Admin token for bootstrap API calls | Export in shell only (do not commit) |
| `ROOM_ID` | required | Room to bind to host | Short stable ID |
| `HOST_IDENTITY` | required | Host identity (account-like identifier) | One unique identity per host |

## Security Baseline

- Public environment: set `REQUIRE_INVITE=true`.
- Do not expose `ADMIN_TOKEN` in frontend/runtime logs.
- Restrict admin/bootstrap endpoints to internal network.
- Rotate `ADMIN_TOKEN` and LiveKit secret periodically.
- Keep `HOST_SESSION_TTL_SECONDS` short and rely on refresh flow.

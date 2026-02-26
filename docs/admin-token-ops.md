# Admin Token Operations (Bootstrap / Runtime)

This project supports split admin tokens with dual-token rollover:

- `BOOTSTRAP_ADMIN_TOKEN` (+ optional `BOOTSTRAP_ADMIN_TOKEN_PREVIOUS`)
- `RUNTIME_ADMIN_TOKEN` (+ optional `RUNTIME_ADMIN_TOKEN_PREVIOUS`)

Legacy fallback (`ADMIN_TOKEN`) is still accepted for compatibility, but should be phased out.

## One-command Rotation (recommended)

```bash
cd /opt/livekit/control-plane
NEW_TOKEN='<new-random-token>' make rotate-admin-token
```

Optional:

```bash
# only preview changes
NEW_TOKEN='<new-random-token>' ./scripts/rotate-admin-token.sh --dry-run

# update env but restart manually
NEW_TOKEN='<new-random-token>' RESTART_AFTER=0 make rotate-admin-token

# auto-generate a random token
make rotate-admin-token-auto
```

Script behavior:

- Sets `BOOTSTRAP_ADMIN_TOKEN` and `RUNTIME_ADMIN_TOKEN` to `NEW_TOKEN`
- Moves old active values into `*_PREVIOUS`
- Keeps legacy `ADMIN_TOKEN` synced for backward compatibility
- Creates env backup file before writing

## Cron Auto-Rotation

Template:

- `deploy/cron/rotate-admin-token.cron`

Install:

```bash
mkdir -p /opt/livekit/control-plane/logs
(crontab -l 2>/dev/null; cat /opt/livekit/control-plane/deploy/cron/rotate-admin-token.cron) | crontab -
```

Important:

- Auto-rotation is safe only if token consumers sync from `.env`/secret manager.
- Because previous token is kept, old token has one grace window; after next rotation it becomes invalid.

## 30-day Rotation Playbook

1. Generate new random token.
2. Run `NEW_TOKEN=... make rotate-admin-token`.
3. Update all callers/scripts/automation to use the new token.
4. After grace window (for example 24-72h), clear previous tokens:
   - `BOOTSTRAP_ADMIN_TOKEN_PREVIOUS=`
   - `RUNTIME_ADMIN_TOKEN_PREVIOUS=`
5. Restart service again to finish rotation.

## Emergency Revoke

If a token may be leaked:

1. Immediately issue a replacement token.
2. Set compromised token to previous slot only if operationally required for short grace.
3. Keep grace window minimal; otherwise clear previous slot directly.
4. Review control-plane audit logs around exposure time.

## Hardening Checklist

- Set `APP_ENV=production`.
- Keep `REQUIRE_INVITE=true`.
- Set `CONTROL_ADMIN_ALLOWLIST_IPS` to internal bastion/proxy IPs.
- Never run `bootstrap-host.sh --show-secrets` in CI.
- Store tokens in secrets manager, not in shell history or committed files.

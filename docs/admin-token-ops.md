# Admin Token Operations (Bootstrap / Runtime)

This project supports split admin tokens with dual-token rollover:

- `BOOTSTRAP_ADMIN_TOKEN` (+ optional `BOOTSTRAP_ADMIN_TOKEN_PREVIOUS`)
- `RUNTIME_ADMIN_TOKEN` (+ optional `RUNTIME_ADMIN_TOKEN_PREVIOUS`)

Legacy fallback (`ADMIN_TOKEN`) is still accepted for compatibility, but should be phased out.

## 30-day Rotation Playbook

1. Generate new random tokens for both bootstrap/runtime channels.
2. Update `.env`:
   - `BOOTSTRAP_ADMIN_TOKEN=<new_bootstrap>`
   - `BOOTSTRAP_ADMIN_TOKEN_PREVIOUS=<old_bootstrap>`
   - `RUNTIME_ADMIN_TOKEN=<new_runtime>`
   - `RUNTIME_ADMIN_TOKEN_PREVIOUS=<old_runtime>`
3. Deploy service.
4. Update all callers/scripts/automation to use new tokens.
5. After grace window (for example 24-72h), clear previous tokens:
   - `BOOTSTRAP_ADMIN_TOKEN_PREVIOUS=`
   - `RUNTIME_ADMIN_TOKEN_PREVIOUS=`
6. Deploy again to finish rotation.

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

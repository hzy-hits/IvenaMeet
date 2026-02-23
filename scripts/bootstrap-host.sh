#!/usr/bin/env bash
set -euo pipefail

if ! command -v curl >/dev/null 2>&1; then
  echo "error: curl is required" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required" >&2
  exit 1
fi

API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:3000}"
ADMIN_TOKEN="${ADMIN_TOKEN:-}"
ROOM_ID="${ROOM_ID:-}"
HOST_IDENTITY="${HOST_IDENTITY:-}"

if [[ -z "$ADMIN_TOKEN" || -z "$ROOM_ID" || -z "$HOST_IDENTITY" ]]; then
  cat >&2 <<'EOF'
usage:
  ADMIN_TOKEN=... ROOM_ID=test HOST_IDENTITY=alice_host ./scripts/bootstrap-host.sh

optional:
  API_BASE_URL=http://127.0.0.1:3000
EOF
  exit 2
fi

echo "==> enrolling MFA for host_identity=$HOST_IDENTITY"
ENROLL_JSON="$(curl -fsS -X POST "$API_BASE_URL/host/mfa/enroll" \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d "{\"host_identity\":\"$HOST_IDENTITY\"}")"

OTPAUTH_URL="$(printf '%s' "$ENROLL_JSON" | jq -r '.otpauth_url')"
SECRET="$(printf '%s' "$ENROLL_JSON" | jq -r '.secret')"

echo "==> binding host to room_id=$ROOM_ID"
JOIN_JSON="$(curl -fsS -X POST "$API_BASE_URL/rooms/join" \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d "{\"room_id\":\"$ROOM_ID\",\"user_name\":\"$HOST_IDENTITY\",\"role\":\"host\"}")"

HOST_SESSION_TTL="$(printf '%s' "$JOIN_JSON" | jq -r '.host_session_expires_in_seconds // 0')"

cat <<EOF

bootstrap complete:
  room_id:       $ROOM_ID
  host_identity: $HOST_IDENTITY
  otpauth_url:   $OTPAUTH_URL
  secret:        $SECRET
  host_ttl_sec:  $HOST_SESSION_TTL

next:
  1) ask host to scan otpauth_url with Google Authenticator
  2) host logs in via frontend with room_id + host_identity + TOTP
EOF

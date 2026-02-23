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

DEFAULT_API_BASE_URL="http://127.0.0.1:3000"
if [[ -f "/opt/livekit/control-plane/.env" ]]; then
  APP_BIND_RAW="$(grep -E '^APP_BIND=' /opt/livekit/control-plane/.env | tail -n1 | cut -d'=' -f2- || true)"
  if [[ -n "${APP_BIND_RAW:-}" ]]; then
    APP_BIND_HOST="${APP_BIND_RAW%%:*}"
    APP_BIND_PORT="${APP_BIND_RAW##*:}"
    if [[ "$APP_BIND_HOST" == "0.0.0.0" || "$APP_BIND_HOST" == "::" || -z "$APP_BIND_HOST" ]]; then
      APP_BIND_HOST="127.0.0.1"
    fi
    if [[ "$APP_BIND_PORT" =~ ^[0-9]+$ ]]; then
      DEFAULT_API_BASE_URL="http://${APP_BIND_HOST}:${APP_BIND_PORT}"
    fi
  fi
fi

API_BASE_URL="${API_BASE_URL:-$DEFAULT_API_BASE_URL}"
ADMIN_TOKEN="${ADMIN_TOKEN:-}"
ROOM_ID="${ROOM_ID:-}"
HOST_IDENTITY="${HOST_IDENTITY:-}"
RESET_MFA="${RESET_MFA:-0}"

if [[ -z "$ADMIN_TOKEN" || -z "$ROOM_ID" || -z "$HOST_IDENTITY" ]]; then
  cat >&2 <<'EOF'
usage:
  ADMIN_TOKEN=... ROOM_ID=test HOST_IDENTITY=alice_host ./scripts/bootstrap-host.sh

optional:
  API_BASE_URL=http://127.0.0.1:3000
  # default is auto-derived from /opt/livekit/control-plane/.env APP_BIND
  RESET_MFA=1   # force rotate TOTP secret; default keeps existing secret
EOF
  exit 2
fi

RESET_MFA_JSON=false
if [[ "$RESET_MFA" == "1" || "${RESET_MFA,,}" == "true" ]]; then
  RESET_MFA_JSON=true
fi

echo "==> enrolling MFA for host_identity=$HOST_IDENTITY"
ENROLL_JSON="$(curl -fsS -X POST "$API_BASE_URL/host/mfa/enroll" \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d "{\"host_identity\":\"$HOST_IDENTITY\",\"reset_mfa\":$RESET_MFA_JSON}")"

OTPAUTH_URL="$(printf '%s' "$ENROLL_JSON" | jq -r '.otpauth_url')"
SECRET="$(printf '%s' "$ENROLL_JSON" | jq -r '.secret')"
QR_SVG="$(printf '%s' "$ENROLL_JSON" | jq -r '.qr_svg // empty')"
if [[ -z "$OTPAUTH_URL" || "$OTPAUTH_URL" == "null" || -z "$SECRET" || "$SECRET" == "null" ]]; then
  echo "unexpected /host/mfa/enroll response:" >&2
  echo "$ENROLL_JSON" >&2
  exit 4
fi
QR_FILE=""
if [[ -n "$QR_SVG" ]]; then
  QR_FILE="/tmp/ivena-host-${HOST_IDENTITY}-${ROOM_ID}-totp.svg"
  printf '%s' "$QR_SVG" > "$QR_FILE"
fi

echo "==> binding host to room_id=$ROOM_ID"
JOIN_JSON="$(curl -fsS -X POST "$API_BASE_URL/rooms/join" \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d "{\"room_id\":\"$ROOM_ID\",\"user_name\":\"$HOST_IDENTITY\",\"role\":\"host\"}")"

HOST_SESSION_TTL="$(printf '%s' "$JOIN_JSON" | jq -r '.host_session_expires_in_seconds // 0')"
if [[ -z "$HOST_SESSION_TTL" || "$HOST_SESSION_TTL" == "null" ]]; then
  echo "unexpected /rooms/join response:" >&2
  echo "$JOIN_JSON" >&2
  exit 5
fi

cat <<EOF

bootstrap complete:
  room_id:       $ROOM_ID
  host_identity: $HOST_IDENTITY
  otpauth_url:   $OTPAUTH_URL
  secret:        $SECRET
  qr_svg_file:   ${QR_FILE:-"(not returned)"}
  host_ttl_sec:  $HOST_SESSION_TTL

next:
  1) ask host to scan otpauth_url with Google Authenticator
  2) host logs in via frontend with room_id + host_identity + TOTP
  3) use RESET_MFA=1 only when you want to rotate secret
EOF

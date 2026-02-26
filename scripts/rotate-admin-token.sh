#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
usage:
  NEW_TOKEN=... ./scripts/rotate-admin-token.sh [--env-file <path>] [--no-restart] [--dry-run]
  ./scripts/rotate-admin-token.sh --new-token <token> [--env-file <path>] [--no-restart] [--dry-run]

options:
  --new-token <token>   New token value. If omitted, NEW_TOKEN env is used.
  --env-file <path>     Env file to edit. Default: ./.env if exists, else /opt/livekit/control-plane/.env
  --service <name>      Systemd service name (default: ivena-meet-control-plane.service)
  --no-restart          Do not restart service after env update
  --dry-run             Print planned changes only, do not edit file
  -h, --help            Show this help

behavior:
  - Sets BOOTSTRAP_ADMIN_TOKEN and RUNTIME_ADMIN_TOKEN to NEW token
  - Moves previous current values into *_PREVIOUS
  - Keeps legacy ADMIN_TOKEN synced to NEW token for backward compatibility
EOF
}

NEW_TOKEN="${NEW_TOKEN:-}"
ENV_FILE="${ENV_FILE:-}"
SERVICE_NAME="${SERVICE_NAME:-ivena-meet-control-plane.service}"
RESTART_AFTER="${RESTART_AFTER:-1}"
DRY_RUN="${DRY_RUN:-0}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --new-token)
      shift
      NEW_TOKEN="${1:-}"
      ;;
    --env-file)
      shift
      ENV_FILE="${1:-}"
      ;;
    --service)
      shift
      SERVICE_NAME="${1:-}"
      ;;
    --no-restart)
      RESTART_AFTER=0
      ;;
    --dry-run)
      DRY_RUN=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if [[ -z "$ENV_FILE" ]]; then
  if [[ -f ".env" ]]; then
    ENV_FILE=".env"
  else
    ENV_FILE="/opt/livekit/control-plane/.env"
  fi
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: env file not found: $ENV_FILE" >&2
  exit 2
fi

if [[ -z "$NEW_TOKEN" ]]; then
  echo "error: NEW_TOKEN is required" >&2
  usage >&2
  exit 2
fi

if [[ "$NEW_TOKEN" =~ [[:space:]] ]]; then
  echo "error: NEW_TOKEN must not contain whitespace" >&2
  exit 2
fi

if [[ "${#NEW_TOKEN}" -lt 24 ]]; then
  echo "error: NEW_TOKEN is too short (require >= 24 chars)" >&2
  exit 2
fi

tmp_get_val() {
  local key="$1"
  local file="$2"
  local line
  line="$(grep -E "^${key}=" "$file" | tail -n1 || true)"
  if [[ -z "$line" ]]; then
    return 1
  fi
  printf '%s' "${line#*=}"
}

set_env_key() {
  local key="$1"
  local value="$2"
  local file="$3"
  local tmp
  tmp="$(mktemp "${file}.tmp.XXXXXX")"
  awk -v key="$key" -v value="$value" '
    BEGIN { replaced = 0 }
    $0 ~ ("^" key "=") {
      if (replaced == 0) {
        print key "=" value
        replaced = 1
      }
      next
    }
    { print }
    END {
      if (replaced == 0) {
        print key "=" value
      }
    }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
}

current_bootstrap="$(tmp_get_val "BOOTSTRAP_ADMIN_TOKEN" "$ENV_FILE" || true)"
current_runtime="$(tmp_get_val "RUNTIME_ADMIN_TOKEN" "$ENV_FILE" || true)"
legacy_admin="$(tmp_get_val "ADMIN_TOKEN" "$ENV_FILE" || true)"

if [[ -z "$current_bootstrap" && -n "$legacy_admin" ]]; then
  current_bootstrap="$legacy_admin"
fi
if [[ -z "$current_runtime" && -n "$legacy_admin" ]]; then
  current_runtime="$legacy_admin"
fi

if [[ -z "$current_bootstrap" || -z "$current_runtime" ]]; then
  echo "error: missing current admin token values in $ENV_FILE" >&2
  echo "require BOOTSTRAP_ADMIN_TOKEN/RUNTIME_ADMIN_TOKEN or legacy ADMIN_TOKEN" >&2
  exit 3
fi

next_bootstrap_prev="$current_bootstrap"
next_runtime_prev="$current_runtime"
if [[ "$next_bootstrap_prev" == "$NEW_TOKEN" ]]; then
  next_bootstrap_prev=""
fi
if [[ "$next_runtime_prev" == "$NEW_TOKEN" ]]; then
  next_runtime_prev=""
fi

echo "rotation plan:"
echo "  env_file: $ENV_FILE"
echo "  service:  $SERVICE_NAME"
echo "  set BOOTSTRAP_ADMIN_TOKEN=<new>"
echo "  set BOOTSTRAP_ADMIN_TOKEN_PREVIOUS=<old_or_empty>"
echo "  set RUNTIME_ADMIN_TOKEN=<new>"
echo "  set RUNTIME_ADMIN_TOKEN_PREVIOUS=<old_or_empty>"
echo "  set ADMIN_TOKEN=<new> (legacy compatibility)"

if [[ "$DRY_RUN" == "1" ]]; then
  echo "dry-run enabled: no file changes applied"
  exit 0
fi

backup_file="${ENV_FILE}.bak.$(date +%Y%m%d%H%M%S)"
cp "$ENV_FILE" "$backup_file"

set_env_key "BOOTSTRAP_ADMIN_TOKEN" "$NEW_TOKEN" "$ENV_FILE"
set_env_key "BOOTSTRAP_ADMIN_TOKEN_PREVIOUS" "$next_bootstrap_prev" "$ENV_FILE"
set_env_key "RUNTIME_ADMIN_TOKEN" "$NEW_TOKEN" "$ENV_FILE"
set_env_key "RUNTIME_ADMIN_TOKEN_PREVIOUS" "$next_runtime_prev" "$ENV_FILE"
set_env_key "ADMIN_TOKEN" "$NEW_TOKEN" "$ENV_FILE"

echo "env updated."
echo "  backup: $backup_file"

if [[ "$RESTART_AFTER" == "1" ]]; then
  if command -v systemctl >/dev/null 2>&1; then
    echo "restarting service: $SERVICE_NAME"
    if [[ $EUID -eq 0 ]]; then
      systemctl restart "$SERVICE_NAME"
    else
      sudo systemctl restart "$SERVICE_NAME"
    fi
    echo "service restarted."
  else
    echo "warning: systemctl not found, skip restart" >&2
  fi
else
  echo "restart skipped (--no-restart)"
fi

#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/opt/livekit/control-plane"
FRONTEND_DIR="$ROOT_DIR/apps/frontend"
BACKEND_ENV="$ROOT_DIR/.env"
FRONTEND_ENV="$ROOT_DIR/deploy/env/frontend.env"

if [[ $EUID -eq 0 ]]; then
  echo "please run as normal user (script will use sudo where needed)" >&2
  exit 1
fi

if [[ ! -f "$BACKEND_ENV" ]]; then
  echo "missing backend env: $BACKEND_ENV" >&2
  exit 2
fi
if [[ ! -f "$FRONTEND_ENV" ]]; then
  echo "missing frontend env: $FRONTEND_ENV" >&2
  echo "hint: cp $ROOT_DIR/deploy/env/frontend.env.example $FRONTEND_ENV" >&2
  exit 2
fi

required_backend_keys=(
  "LIVEKIT_HOST"
  "LIVEKIT_API_KEY"
  "LIVEKIT_API_SECRET"
  "ADMIN_TOKEN"
)

for key in "${required_backend_keys[@]}"; do
  if ! grep -qE "^${key}=.+" "$BACKEND_ENV"; then
    echo "missing required key in .env: $key" >&2
    exit 3
  fi
done

if ! grep -qE "^FRONTEND_PORT=.+" "$FRONTEND_ENV"; then
  echo "missing FRONTEND_PORT in $FRONTEND_ENV" >&2
  exit 3
fi

echo "==> build backend (release)"
cd "$ROOT_DIR"
cargo build --release

echo "==> build frontend"
cd "$FRONTEND_DIR"
npm ci
npm run build

echo "==> reload and restart systemd services"
sudo systemctl daemon-reload
sudo systemctl restart ivena-meet-control-plane.service
sudo systemctl restart ivena-meet-frontend.service

echo "==> service status"
systemctl --no-pager --full status ivena-meet-control-plane.service | sed -n '1,20p'
systemctl --no-pager --full status ivena-meet-frontend.service | sed -n '1,20p'

echo
echo "deploy done."

#!/usr/bin/env bash
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "please run as root (sudo)" >&2
  exit 1
fi

cp /opt/livekit/control-plane/deploy/systemd/ivena-meet-control-plane.service /etc/systemd/system/
cp /opt/livekit/control-plane/deploy/systemd/ivena-meet-frontend.service /etc/systemd/system/

systemctl daemon-reload
systemctl enable ivena-meet-control-plane.service
systemctl enable ivena-meet-frontend.service

echo "installed and enabled:"
echo "  - ivena-meet-control-plane.service"
echo "  - ivena-meet-frontend.service"
echo
echo "next:"
echo "  1) cp /opt/livekit/control-plane/deploy/env/frontend.env.example /opt/livekit/control-plane/deploy/env/frontend.env"
echo "  2) edit /opt/livekit/control-plane/.env"
echo "  3) one-command deploy:"
echo "     /opt/livekit/control-plane/deploy/systemd/deploy.sh"

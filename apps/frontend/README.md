# Meet Frontend (React)

React + Vite frontend for the private LiveKit stage.

## Features

- Role selector: `host` / `member`
- `host` can screen share, `member` cannot
- Member list + active speaker highlight
- Room chat (real-time over LiveKit DataChannel)
- Message history persistence via control-plane API

## Run

```bash
cd /opt/livekit/control-plane/apps/frontend
npm install
npm run dev -- --host 0.0.0.0 --port 8090
```

## Required backend routes

- `POST /rooms/join`
- `POST /auth/invite`
- `POST /invites/redeem`
- `POST /broadcast/issue`
- `POST /broadcast/start`
- `POST /broadcast/stop`
- `GET /rooms/:room_id/messages`
- `POST /rooms/:room_id/messages`

## NPM proxy suggestion

- `meet.ivena.top` -> `192.168.1.108:8090`
- `meet.ivena.top/api` -> `192.168.1.108:3000`

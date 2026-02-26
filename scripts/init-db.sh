#!/usr/bin/env bash
set -euo pipefail

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "error: sqlite3 is required" >&2
  exit 1
fi

SQLITE_PATH="${SQLITE_PATH:-/opt/livekit/control-plane/data/app.db}"
mkdir -p "$(dirname "$SQLITE_PATH")"

sqlite3 "$SQLITE_PATH" <<'SQL'
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS users (
  user_name TEXT PRIMARY KEY,
  nickname TEXT NOT NULL,
  avatar_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  role TEXT NOT NULL,
  client_id TEXT,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(user_name) REFERENCES users(user_name)
);

CREATE INDEX IF NOT EXISTS idx_messages_room_created_at
ON messages(room_id, created_at);

CREATE TABLE IF NOT EXISTS rooms (
  room_id TEXT PRIMARY KEY,
  host_identity TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS room_broadcasts (
  room_id TEXT PRIMARY KEY,
  host_identity TEXT NOT NULL,
  participant_identity TEXT NOT NULL,
  participant_name TEXT NOT NULL,
  ingress_identity TEXT NOT NULL,
  ingress_id TEXT NOT NULL UNIQUE,
  whip_url TEXT NOT NULL,
  stream_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_room_broadcasts_ingress_id
ON room_broadcasts(ingress_id);
SQL

has_client_id="$(sqlite3 "$SQLITE_PATH" "SELECT 1 FROM pragma_table_info('messages') WHERE name='client_id' LIMIT 1;")"
if [[ -z "$has_client_id" ]]; then
  sqlite3 "$SQLITE_PATH" "ALTER TABLE messages ADD COLUMN client_id TEXT;"
fi

echo "db initialized at: $SQLITE_PATH"

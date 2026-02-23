#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_PATH="${SQLITE_PATH:-$ROOT_DIR/data/app.db}"
AVATAR_DIR="${AVATAR_DIR:-$ROOT_DIR/data/avatars}"
DRY_RUN="${DRY_RUN:-0}"

mkdir -p "$AVATAR_DIR"

python3 - "$DB_PATH" "$AVATAR_DIR" "$DRY_RUN" <<'PY'
import os
import sqlite3
import sys

db_path = sys.argv[1]
avatar_dir = sys.argv[2]
dry_run = sys.argv[3] == "1"

conn = sqlite3.connect(db_path)
rows = conn.execute("select avatar_url from users where avatar_url is not null and avatar_url <> ''").fetchall()
conn.close()

keep = set()
for (url,) in rows:
    marker = "/api/avatars/"
    idx = url.find(marker)
    if idx >= 0:
        name = url[idx + len(marker):]
        if name and "/" not in name and ".." not in name:
            keep.add(name)

removed = 0
bytes_freed = 0
for name in os.listdir(avatar_dir):
    path = os.path.join(avatar_dir, name)
    if not os.path.isfile(path):
        continue
    if name in keep:
        continue
    size = os.path.getsize(path)
    if dry_run:
        print(f"[dry-run] remove {name} ({size} bytes)")
    else:
        os.remove(path)
        print(f"remove {name} ({size} bytes)")
    removed += 1
    bytes_freed += size

print(f"done: removed={removed}, bytes_freed={bytes_freed}")
PY

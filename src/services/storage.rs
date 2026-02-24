use crate::error::{AppError, AppResult};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct StorageService {
    conn: Arc<Mutex<Connection>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserProfile {
    pub user_name: String,
    pub nickname: String,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: i64,
    pub room_id: String,
    pub user_name: String,
    pub nickname: String,
    pub avatar_url: Option<String>,
    pub role: String,
    pub client_id: Option<String>,
    pub text: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoomInfo {
    pub room_id: String,
    pub host_identity: String,
    pub created_at: i64,
    pub expires_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoomBroadcastInfo {
    pub room_id: String,
    pub host_identity: String,
    pub participant_identity: String,
    pub participant_name: String,
    pub ingress_identity: String,
    pub ingress_id: String,
    pub whip_url: String,
    pub stream_key: String,
    pub created_at: i64,
    pub updated_at: i64,
}

impl StorageService {
    pub fn new(sqlite_path: &str) -> AppResult<Self> {
        if let Some(parent) = Path::new(sqlite_path).parent() {
            std::fs::create_dir_all(parent).map_err(AppError::Io)?;
        }

        let conn = Connection::open(sqlite_path).map_err(|e| AppError::Db(e.to_string()))?;
        conn.execute_batch(
            r#"
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
            "#,
        )
        .map_err(|e| AppError::Db(e.to_string()))?;
        ensure_messages_client_id_column(&conn)?;

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    pub async fn upsert_user(
        &self,
        user_name: String,
        nickname: String,
        avatar_url: Option<String>,
    ) -> AppResult<UserProfile> {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || {
            let now = now_ts();
            let db = conn
                .lock()
                .map_err(|_| AppError::Db("db lock poisoned".to_string()))?;
            let user_key = user_name.clone();
            db.execute(
                r#"
                INSERT INTO users (user_name, nickname, avatar_url, created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?4)
                ON CONFLICT(user_name)
                DO UPDATE SET
                  nickname = excluded.nickname,
                  avatar_url = excluded.avatar_url,
                  updated_at = excluded.updated_at
                "#,
                params![&user_name, &nickname, &avatar_url, now],
            )
            .map_err(|e| AppError::Db(e.to_string()))?;

            let mut stmt = db
                .prepare("SELECT user_name, nickname, avatar_url FROM users WHERE user_name = ?1")
                .map_err(|e| AppError::Db(e.to_string()))?;
            stmt.query_row(params![user_key], |row| {
                Ok(UserProfile {
                    user_name: row.get(0)?,
                    nickname: row.get(1)?,
                    avatar_url: row.get(2)?,
                })
            })
            .map_err(|e| AppError::Db(e.to_string()))
        })
        .await
        .map_err(|e| AppError::Db(e.to_string()))?
    }

    pub async fn get_user(&self, user_name: String) -> AppResult<Option<UserProfile>> {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || {
            let db = conn
                .lock()
                .map_err(|_| AppError::Db("db lock poisoned".to_string()))?;
            let mut stmt = db
                .prepare("SELECT user_name, nickname, avatar_url FROM users WHERE user_name = ?1")
                .map_err(|e| AppError::Db(e.to_string()))?;
            stmt.query_row(params![user_name], |row| {
                Ok(UserProfile {
                    user_name: row.get(0)?,
                    nickname: row.get(1)?,
                    avatar_url: row.get(2)?,
                })
            })
            .optional()
            .map_err(|e| AppError::Db(e.to_string()))
        })
        .await
        .map_err(|e| AppError::Db(e.to_string()))?
    }

    pub async fn insert_message(
        &self,
        room_id: String,
        user_name: String,
        role: String,
        client_id: Option<String>,
        text: String,
    ) -> AppResult<ChatMessage> {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || {
            let now = now_ts();
            let db = conn.lock().map_err(|_| AppError::Db("db lock poisoned".to_string()))?;
            db.execute(
                "INSERT INTO messages (room_id, user_name, role, client_id, text, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![room_id, user_name, role, client_id, text, now],
            )
            .map_err(|e| AppError::Db(e.to_string()))?;
            let id = db.last_insert_rowid();

            let mut stmt = db
                .prepare(
                    r#"
                    SELECT m.id, m.room_id, m.user_name, u.nickname, u.avatar_url, m.role, m.client_id, m.text, m.created_at
                    FROM messages m
                    JOIN users u ON u.user_name = m.user_name
                    WHERE m.id = ?1
                    "#,
                )
                .map_err(|e| AppError::Db(e.to_string()))?;

            stmt.query_row(params![id], |row| {
                Ok(ChatMessage {
                    id: row.get(0)?,
                    room_id: row.get(1)?,
                    user_name: row.get(2)?,
                    nickname: row.get(3)?,
                    avatar_url: row.get(4)?,
                    role: row.get(5)?,
                    client_id: row.get(6)?,
                    text: row.get(7)?,
                    created_at: row.get(8)?,
                })
            })
            .map_err(|e| AppError::Db(e.to_string()))
        })
        .await
        .map_err(|e| AppError::Db(e.to_string()))?
    }

    pub async fn list_messages(
        &self,
        room_id: String,
        limit: i64,
        after_id: Option<i64>,
    ) -> AppResult<Vec<ChatMessage>> {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || {
            let db = conn.lock().map_err(|_| AppError::Db("db lock poisoned".to_string()))?;
            let mut out = Vec::new();
            if let Some(after_id) = after_id {
                let mut stmt = db
                    .prepare(
                        r#"
                        SELECT m.id, m.room_id, m.user_name, u.nickname, u.avatar_url, m.role, m.client_id, m.text, m.created_at
                        FROM messages m
                        JOIN users u ON u.user_name = m.user_name
                        WHERE m.room_id = ?1 AND m.id > ?2
                        ORDER BY m.id ASC
                        LIMIT ?3
                        "#,
                    )
                    .map_err(|e| AppError::Db(e.to_string()))?;

                let rows = stmt
                    .query_map(params![room_id, after_id, limit], |row| {
                        Ok(ChatMessage {
                            id: row.get(0)?,
                            room_id: row.get(1)?,
                            user_name: row.get(2)?,
                            nickname: row.get(3)?,
                            avatar_url: row.get(4)?,
                            role: row.get(5)?,
                            client_id: row.get(6)?,
                            text: row.get(7)?,
                            created_at: row.get(8)?,
                        })
                    })
                    .map_err(|e| AppError::Db(e.to_string()))?;

                for row in rows {
                    out.push(row.map_err(|e| AppError::Db(e.to_string()))?);
                }
                Ok(out)
            } else {
                let mut stmt = db
                    .prepare(
                        r#"
                        SELECT m.id, m.room_id, m.user_name, u.nickname, u.avatar_url, m.role, m.client_id, m.text, m.created_at
                        FROM messages m
                        JOIN users u ON u.user_name = m.user_name
                        WHERE m.room_id = ?1
                        ORDER BY m.created_at DESC, m.id DESC
                        LIMIT ?2
                        "#,
                    )
                    .map_err(|e| AppError::Db(e.to_string()))?;

                let rows = stmt
                    .query_map(params![room_id, limit], |row| {
                        Ok(ChatMessage {
                            id: row.get(0)?,
                            room_id: row.get(1)?,
                            user_name: row.get(2)?,
                            nickname: row.get(3)?,
                            avatar_url: row.get(4)?,
                            role: row.get(5)?,
                            client_id: row.get(6)?,
                            text: row.get(7)?,
                            created_at: row.get(8)?,
                        })
                    })
                    .map_err(|e| AppError::Db(e.to_string()))?;

                for row in rows {
                    out.push(row.map_err(|e| AppError::Db(e.to_string()))?);
                }
                out.reverse();
                Ok(out)
            }
        })
        .await
        .map_err(|e| AppError::Db(e.to_string()))?
    }

    pub async fn ensure_room_for_host(
        &self,
        room_id: String,
        host_identity: String,
        ttl_seconds: u64,
    ) -> AppResult<RoomInfo> {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || {
            let now = now_ts();
            let expires_at = now + ttl_seconds as i64;
            let db = conn
                .lock()
                .map_err(|_| AppError::Db("db lock poisoned".to_string()))?;

            let existing: Option<(String, i64)> = db
                .query_row(
                    "SELECT host_identity, expires_at FROM rooms WHERE room_id = ?1",
                    params![&room_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()
                .map_err(|e| AppError::Db(e.to_string()))?;

            if let Some((host, old_expiry)) = existing {
                if host != host_identity && old_expiry > now {
                    return Err(AppError::Unauthorized("room host mismatch".to_string()));
                }
                db.execute(
                    "UPDATE rooms SET host_identity = ?2, expires_at = ?3 WHERE room_id = ?1",
                    params![&room_id, &host_identity, expires_at],
                )
                .map_err(|e| AppError::Db(e.to_string()))?;
            } else {
                db.execute(
                    "INSERT INTO rooms (room_id, host_identity, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)",
                    params![&room_id, &host_identity, now, expires_at],
                )
                .map_err(|e| AppError::Db(e.to_string()))?;
            }

            let mut stmt = db
                .prepare(
                    "SELECT room_id, host_identity, created_at, expires_at FROM rooms WHERE room_id = ?1",
                )
                .map_err(|e| AppError::Db(e.to_string()))?;
            stmt.query_row(params![&room_id], |row| {
                Ok(RoomInfo {
                    room_id: row.get(0)?,
                    host_identity: row.get(1)?,
                    created_at: row.get(2)?,
                    expires_at: row.get(3)?,
                })
            })
            .map_err(|e| AppError::Db(e.to_string()))
        })
        .await
        .map_err(|e| AppError::Db(e.to_string()))?
    }

    pub async fn get_room_active(&self, room_id: String) -> AppResult<Option<RoomInfo>> {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || {
            let now = now_ts();
            let db = conn
                .lock()
                .map_err(|_| AppError::Db("db lock poisoned".to_string()))?;
            let mut stmt = db
                .prepare(
                    "SELECT room_id, host_identity, created_at, expires_at FROM rooms WHERE room_id = ?1 AND expires_at > ?2",
                )
                .map_err(|e| AppError::Db(e.to_string()))?;
            stmt.query_row(params![room_id, now], |row| {
                Ok(RoomInfo {
                    room_id: row.get(0)?,
                    host_identity: row.get(1)?,
                    created_at: row.get(2)?,
                    expires_at: row.get(3)?,
                })
            })
            .optional()
            .map_err(|e| AppError::Db(e.to_string()))
        })
        .await
        .map_err(|e| AppError::Db(e.to_string()))?
    }

    pub async fn upsert_room_broadcast(
        &self,
        room_id: String,
        host_identity: String,
        participant_identity: String,
        participant_name: String,
        ingress_identity: String,
        ingress_id: String,
        whip_url: String,
        stream_key: String,
    ) -> AppResult<RoomBroadcastInfo> {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || {
            let now = now_ts();
            let db = conn
                .lock()
                .map_err(|_| AppError::Db("db lock poisoned".to_string()))?;
            db.execute(
                r#"
                INSERT INTO room_broadcasts (
                  room_id, host_identity, participant_identity, participant_name,
                  ingress_identity, ingress_id, whip_url, stream_key, created_at, updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
                ON CONFLICT(room_id)
                DO UPDATE SET
                  host_identity = excluded.host_identity,
                  participant_identity = excluded.participant_identity,
                  participant_name = excluded.participant_name,
                  ingress_identity = excluded.ingress_identity,
                  ingress_id = excluded.ingress_id,
                  whip_url = excluded.whip_url,
                  stream_key = excluded.stream_key,
                  updated_at = excluded.updated_at
                "#,
                params![
                    &room_id,
                    &host_identity,
                    &participant_identity,
                    &participant_name,
                    &ingress_identity,
                    &ingress_id,
                    &whip_url,
                    &stream_key,
                    now
                ],
            )
            .map_err(|e| AppError::Db(e.to_string()))?;

            let mut stmt = db
                .prepare(
                    r#"
                    SELECT
                      room_id, host_identity, participant_identity, participant_name,
                      ingress_identity, ingress_id, whip_url, stream_key, created_at, updated_at
                    FROM room_broadcasts
                    WHERE room_id = ?1
                    "#,
                )
                .map_err(|e| AppError::Db(e.to_string()))?;

            stmt.query_row(params![&room_id], |row| {
                Ok(RoomBroadcastInfo {
                    room_id: row.get(0)?,
                    host_identity: row.get(1)?,
                    participant_identity: row.get(2)?,
                    participant_name: row.get(3)?,
                    ingress_identity: row.get(4)?,
                    ingress_id: row.get(5)?,
                    whip_url: row.get(6)?,
                    stream_key: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            })
            .map_err(|e| AppError::Db(e.to_string()))
        })
        .await
        .map_err(|e| AppError::Db(e.to_string()))?
    }

    pub async fn get_room_broadcast(
        &self,
        room_id: String,
    ) -> AppResult<Option<RoomBroadcastInfo>> {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || {
            let db = conn
                .lock()
                .map_err(|_| AppError::Db("db lock poisoned".to_string()))?;
            let mut stmt = db
                .prepare(
                    r#"
                    SELECT
                      room_id, host_identity, participant_identity, participant_name,
                      ingress_identity, ingress_id, whip_url, stream_key, created_at, updated_at
                    FROM room_broadcasts
                    WHERE room_id = ?1
                    "#,
                )
                .map_err(|e| AppError::Db(e.to_string()))?;

            stmt.query_row(params![room_id], |row| {
                Ok(RoomBroadcastInfo {
                    room_id: row.get(0)?,
                    host_identity: row.get(1)?,
                    participant_identity: row.get(2)?,
                    participant_name: row.get(3)?,
                    ingress_identity: row.get(4)?,
                    ingress_id: row.get(5)?,
                    whip_url: row.get(6)?,
                    stream_key: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            })
            .optional()
            .map_err(|e| AppError::Db(e.to_string()))
        })
        .await
        .map_err(|e| AppError::Db(e.to_string()))?
    }

    pub async fn get_room_broadcast_by_ingress_id(
        &self,
        ingress_id: String,
    ) -> AppResult<Option<RoomBroadcastInfo>> {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || {
            let db = conn
                .lock()
                .map_err(|_| AppError::Db("db lock poisoned".to_string()))?;
            let mut stmt = db
                .prepare(
                    r#"
                    SELECT
                      room_id, host_identity, participant_identity, participant_name,
                      ingress_identity, ingress_id, whip_url, stream_key, created_at, updated_at
                    FROM room_broadcasts
                    WHERE ingress_id = ?1
                    "#,
                )
                .map_err(|e| AppError::Db(e.to_string()))?;

            stmt.query_row(params![ingress_id], |row| {
                Ok(RoomBroadcastInfo {
                    room_id: row.get(0)?,
                    host_identity: row.get(1)?,
                    participant_identity: row.get(2)?,
                    participant_name: row.get(3)?,
                    ingress_identity: row.get(4)?,
                    ingress_id: row.get(5)?,
                    whip_url: row.get(6)?,
                    stream_key: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            })
            .optional()
            .map_err(|e| AppError::Db(e.to_string()))
        })
        .await
        .map_err(|e| AppError::Db(e.to_string()))?
    }

    pub async fn delete_room_broadcast(&self, room_id: String) -> AppResult<()> {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || {
            let db = conn
                .lock()
                .map_err(|_| AppError::Db("db lock poisoned".to_string()))?;
            db.execute(
                "DELETE FROM room_broadcasts WHERE room_id = ?1",
                params![room_id],
            )
            .map_err(|e| AppError::Db(e.to_string()))?;
            Ok(())
        })
        .await
        .map_err(|e| AppError::Db(e.to_string()))?
    }

    pub async fn delete_room_broadcast_by_ingress_id(&self, ingress_id: String) -> AppResult<()> {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || {
            let db = conn
                .lock()
                .map_err(|_| AppError::Db("db lock poisoned".to_string()))?;
            db.execute(
                "DELETE FROM room_broadcasts WHERE ingress_id = ?1",
                params![ingress_id],
            )
            .map_err(|e| AppError::Db(e.to_string()))?;
            Ok(())
        })
        .await
        .map_err(|e| AppError::Db(e.to_string()))?
    }

    pub async fn list_room_broadcasts_for_expired_rooms(
        &self,
        limit: i64,
    ) -> AppResult<Vec<RoomBroadcastInfo>> {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || {
            let now = now_ts();
            let db = conn
                .lock()
                .map_err(|_| AppError::Db("db lock poisoned".to_string()))?;
            let mut stmt = db
                .prepare(
                    r#"
                    SELECT
                      rb.room_id, rb.host_identity, rb.participant_identity, rb.participant_name,
                      rb.ingress_identity, rb.ingress_id, rb.whip_url, rb.stream_key,
                      rb.created_at, rb.updated_at
                    FROM room_broadcasts rb
                    LEFT JOIN rooms r ON r.room_id = rb.room_id
                    WHERE r.room_id IS NULL OR r.expires_at <= ?1
                    ORDER BY rb.updated_at ASC
                    LIMIT ?2
                    "#,
                )
                .map_err(|e| AppError::Db(e.to_string()))?;
            let rows = stmt
                .query_map(params![now, limit], |row| {
                    Ok(RoomBroadcastInfo {
                        room_id: row.get(0)?,
                        host_identity: row.get(1)?,
                        participant_identity: row.get(2)?,
                        participant_name: row.get(3)?,
                        ingress_identity: row.get(4)?,
                        ingress_id: row.get(5)?,
                        whip_url: row.get(6)?,
                        stream_key: row.get(7)?,
                        created_at: row.get(8)?,
                        updated_at: row.get(9)?,
                    })
                })
                .map_err(|e| AppError::Db(e.to_string()))?;
            let mut out = Vec::new();
            for row in rows {
                out.push(row.map_err(|e| AppError::Db(e.to_string()))?);
            }
            Ok(out)
        })
        .await
        .map_err(|e| AppError::Db(e.to_string()))?
    }
}

fn ensure_messages_client_id_column(conn: &Connection) -> AppResult<()> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(messages)")
        .map_err(|e| AppError::Db(e.to_string()))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| AppError::Db(e.to_string()))?;

    for row in rows {
        let name = row.map_err(|e| AppError::Db(e.to_string()))?;
        if name == "client_id" {
            return Ok(());
        }
    }

    conn.execute("ALTER TABLE messages ADD COLUMN client_id TEXT", [])
        .map_err(|e| AppError::Db(e.to_string()))?;
    Ok(())
}

fn now_ts() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

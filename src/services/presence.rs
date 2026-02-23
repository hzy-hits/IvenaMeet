use crate::error::{AppError, AppResult};
use redis::{AsyncCommands, Script, aio::ConnectionLike};

#[derive(Clone)]
pub struct PresenceService {
    prefix: String,
}

impl PresenceService {
    pub fn new(prefix: String) -> Self {
        Self { prefix }
    }

    pub async fn acquire_identity<C>(
        &self,
        conn: &mut C,
        room_id: &str,
        user_name: &str,
        owner: &str,
        ttl_seconds: u64,
    ) -> AppResult<bool>
    where
        C: AsyncCommands + ConnectionLike + Send,
    {
        let script = Script::new(
            r#"
local key = KEYS[1]
local owner = ARGV[1]
local ttl = tonumber(ARGV[2])
if redis.call("SET", key, owner, "NX", "EX", ttl) then
  return 1
end
if redis.call("GET", key) == owner then
  redis.call("EXPIRE", key, ttl)
  return 1
end
return 0
"#,
        );
        let ok: i64 = script
            .key(self.key(room_id, user_name))
            .arg(owner)
            .arg(ttl_seconds)
            .invoke_async(conn)
            .await
            .map_err(|e| AppError::Redis(e.to_string()))?;
        Ok(ok == 1)
    }

    pub async fn promote_owner<C>(
        &self,
        conn: &mut C,
        room_id: &str,
        user_name: &str,
        expected_owner: &str,
        new_owner: &str,
        ttl_seconds: u64,
    ) -> AppResult<bool>
    where
        C: AsyncCommands + ConnectionLike + Send,
    {
        let script = Script::new(
            r#"
local key = KEYS[1]
local expected = ARGV[1]
local new_owner = ARGV[2]
local ttl = tonumber(ARGV[3])
local current = redis.call("GET", key)
if not current then
  return 0
end
if current ~= expected and current ~= new_owner then
  return 0
end
redis.call("SET", key, new_owner, "EX", ttl)
return 1
"#,
        );
        let ok: i64 = script
            .key(self.key(room_id, user_name))
            .arg(expected_owner)
            .arg(new_owner)
            .arg(ttl_seconds)
            .invoke_async(conn)
            .await
            .map_err(|e| AppError::Redis(e.to_string()))?;
        Ok(ok == 1)
    }

    pub async fn rotate_owner<C>(
        &self,
        conn: &mut C,
        room_id: &str,
        user_name: &str,
        old_owner: &str,
        new_owner: &str,
        ttl_seconds: u64,
    ) -> AppResult<bool>
    where
        C: AsyncCommands + ConnectionLike + Send,
    {
        self.promote_owner(conn, room_id, user_name, old_owner, new_owner, ttl_seconds)
            .await
    }

    pub async fn touch_owner<C>(
        &self,
        conn: &mut C,
        room_id: &str,
        user_name: &str,
        owner: &str,
        ttl_seconds: u64,
    ) -> AppResult<bool>
    where
        C: AsyncCommands + ConnectionLike + Send,
    {
        let script = Script::new(
            r#"
local key = KEYS[1]
local owner = ARGV[1]
local ttl = tonumber(ARGV[2])
if redis.call("GET", key) ~= owner then
  return 0
end
redis.call("EXPIRE", key, ttl)
return 1
"#,
        );
        let ok: i64 = script
            .key(self.key(room_id, user_name))
            .arg(owner)
            .arg(ttl_seconds)
            .invoke_async(conn)
            .await
            .map_err(|e| AppError::Redis(e.to_string()))?;
        Ok(ok == 1)
    }

    pub async fn release_if_owner<C>(
        &self,
        conn: &mut C,
        room_id: &str,
        user_name: &str,
        owner: &str,
    ) -> AppResult<bool>
    where
        C: AsyncCommands + ConnectionLike + Send,
    {
        let script = Script::new(
            r#"
local key = KEYS[1]
local owner = ARGV[1]
if redis.call("GET", key) ~= owner then
  return 0
end
redis.call("DEL", key)
return 1
"#,
        );
        let ok: i64 = script
            .key(self.key(room_id, user_name))
            .arg(owner)
            .invoke_async(conn)
            .await
            .map_err(|e| AppError::Redis(e.to_string()))?;
        Ok(ok == 1)
    }

    fn key(&self, room_id: &str, user_name: &str) -> String {
        format!("{}:{}:{}", self.prefix, room_id, user_name)
    }
}

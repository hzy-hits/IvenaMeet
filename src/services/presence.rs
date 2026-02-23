use crate::error::{AppError, AppResult};
use redis::{AsyncCommands, Script, aio::ConnectionLike};

#[derive(Clone)]
pub struct PresenceService {
    prefix: String,
}

#[derive(Debug, Clone)]
pub struct PresenceState {
    pub owner: String,
    pub heartbeat_ts: i64,
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
        heartbeat_ts: i64,
    ) -> AppResult<bool>
    where
        C: AsyncCommands + ConnectionLike + Send,
    {
        let script = Script::new(
            r#"
local function owner_of(v)
  local p = string.find(v, "|", 1, true)
  if p then return string.sub(v, 1, p - 1) end
  return v
end
local key = KEYS[1]
local owner = ARGV[1]
local ttl = tonumber(ARGV[2])
local hb = ARGV[3]
local value = owner .. "|" .. hb
if redis.call("SET", key, value, "NX", "EX", ttl) then
  return 1
end
local current = redis.call("GET", key)
if current and owner_of(current) == owner then
  redis.call("SET", key, value, "EX", ttl)
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
            .arg(heartbeat_ts)
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
        heartbeat_ts: i64,
    ) -> AppResult<bool>
    where
        C: AsyncCommands + ConnectionLike + Send,
    {
        let script = Script::new(
            r#"
local function owner_of(v)
  local p = string.find(v, "|", 1, true)
  if p then return string.sub(v, 1, p - 1) end
  return v
end
local key = KEYS[1]
local expected = ARGV[1]
local new_owner = ARGV[2]
local ttl = tonumber(ARGV[3])
local hb = ARGV[4]
local current = redis.call("GET", key)
if not current then
  return 0
end
local current_owner = owner_of(current)
if current_owner ~= expected and current_owner ~= new_owner then
  return 0
end
redis.call("SET", key, new_owner .. "|" .. hb, "EX", ttl)
return 1
"#,
        );
        let ok: i64 = script
            .key(self.key(room_id, user_name))
            .arg(expected_owner)
            .arg(new_owner)
            .arg(ttl_seconds)
            .arg(heartbeat_ts)
            .invoke_async(conn)
            .await
            .map_err(|e| AppError::Redis(e.to_string()))?;
        Ok(ok == 1)
    }

    pub async fn touch_owner<C>(
        &self,
        conn: &mut C,
        room_id: &str,
        user_name: &str,
        owner: &str,
        ttl_seconds: u64,
        heartbeat_ts: i64,
    ) -> AppResult<bool>
    where
        C: AsyncCommands + ConnectionLike + Send,
    {
        let script = Script::new(
            r#"
local function owner_of(v)
  local p = string.find(v, "|", 1, true)
  if p then return string.sub(v, 1, p - 1) end
  return v
end
local key = KEYS[1]
local owner = ARGV[1]
local ttl = tonumber(ARGV[2])
local hb = ARGV[3]
local current = redis.call("GET", key)
if not current or owner_of(current) ~= owner then
  return 0
end
redis.call("SET", key, owner .. "|" .. hb, "EX", ttl)
redis.call("EXPIRE", key, ttl)
return 1
"#,
        );
        let ok: i64 = script
            .key(self.key(room_id, user_name))
            .arg(owner)
            .arg(ttl_seconds)
            .arg(heartbeat_ts)
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
local function owner_of(v)
  local p = string.find(v, "|", 1, true)
  if p then return string.sub(v, 1, p - 1) end
  return v
end
local key = KEYS[1]
local owner = ARGV[1]
local current = redis.call("GET", key)
if not current or owner_of(current) ~= owner then
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

    pub async fn get_state<C>(
        &self,
        conn: &mut C,
        room_id: &str,
        user_name: &str,
    ) -> AppResult<Option<PresenceState>>
    where
        C: AsyncCommands + ConnectionLike + Send,
    {
        let raw: Option<String> = conn
            .get(self.key(room_id, user_name))
            .await
            .map_err(|e| AppError::Redis(e.to_string()))?;
        let Some(raw) = raw else {
            return Ok(None);
        };
        let mut parts = raw.splitn(2, '|');
        let owner = parts.next().unwrap_or("").to_string();
        let heartbeat_ts = parts
            .next()
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(0);
        if owner.is_empty() {
            return Ok(None);
        }
        Ok(Some(PresenceState {
            owner,
            heartbeat_ts,
        }))
    }

    pub async fn force_delete<C>(
        &self,
        conn: &mut C,
        room_id: &str,
        user_name: &str,
    ) -> AppResult<()>
    where
        C: AsyncCommands + ConnectionLike + Send,
    {
        let _: i64 = conn
            .del(self.key(room_id, user_name))
            .await
            .map_err(|e| AppError::Redis(e.to_string()))?;
        Ok(())
    }

    fn key(&self, room_id: &str, user_name: &str) -> String {
        format!("{}:{}:{}", self.prefix, room_id, user_name)
    }
}

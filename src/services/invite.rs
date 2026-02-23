use crate::error::{AppError, AppResult};
use redis::{AsyncCommands, Script, aio::ConnectionLike};
use serde::{Deserialize, Serialize};

#[derive(Clone)]
pub struct InviteService {
    prefix: String,
    ttl_seconds: u64,
    max_uses: u64,
}

impl InviteService {
    pub fn new(prefix: String, ttl_seconds: u64, max_uses: u64) -> Self {
        Self {
            prefix,
            ttl_seconds,
            max_uses: max_uses.max(1),
        }
    }

    pub async fn create_ticket<C>(
        &self,
        conn: &mut C,
        room_id: &str,
        host_identity: &str,
    ) -> AppResult<IssuedInvite>
    where
        C: AsyncCommands + ConnectionLike + Send,
    {
        let full = uuid::Uuid::new_v4().simple().to_string();
        let code = full[..8].to_string();
        let ticket = uuid::Uuid::new_v4().simple().to_string();
        let key = self.ticket_key(&ticket);
        let _: () = redis::cmd("HSET")
            .arg(&key)
            .arg("room_id")
            .arg(room_id)
            .arg("host_identity")
            .arg(host_identity)
            .arg("invite_code")
            .arg(&code)
            .arg("remaining_uses")
            .arg(self.max_uses)
            .query_async(conn)
            .await
            .map_err(|e| AppError::Redis(e.to_string()))?;
        let _: () = redis::cmd("EXPIRE")
            .arg(&key)
            .arg(self.ttl_seconds)
            .query_async(conn)
            .await
            .map_err(|e| AppError::Redis(e.to_string()))?;

        Ok(IssuedInvite {
            invite_ticket: ticket,
            invite_code: code,
            expires_in_seconds: self.ttl_seconds,
            max_uses: self.max_uses,
        })
    }

    pub async fn redeem_ticket<C>(
        &self,
        conn: &mut C,
        room_id: &str,
        user_name: &str,
        ticket: &str,
        code: &str,
        redeem_ttl_seconds: u64,
    ) -> AppResult<RedeemTicketResult>
    where
        C: AsyncCommands + ConnectionLike + Send,
    {
        let key = self.ticket_key(ticket);
        let script = Script::new(
            r#"
local key = KEYS[1]
local want_room = ARGV[1]
local want_code = ARGV[2]
if redis.call("EXISTS", key) == 0 then
  return {0, 0}
end
local key_type = redis.call("TYPE", key)
local key_type_name = key_type
if type(key_type) == "table" then
  key_type_name = key_type["ok"]
end
if key_type_name ~= "hash" then
  redis.call("DEL", key)
  return {0, 0}
end
local room = redis.call("HGET", key, "room_id")
local code = redis.call("HGET", key, "invite_code")
local remaining = tonumber(redis.call("HGET", key, "remaining_uses") or "0")
if room ~= want_room then
  return {2, remaining}
end
if code ~= want_code then
  return {3, remaining}
end
if remaining <= 0 then
  redis.call("DEL", key)
  return {0, 0}
end
remaining = remaining - 1
if remaining <= 0 then
  redis.call("DEL", key)
else
  redis.call("HSET", key, "remaining_uses", tostring(remaining))
end
return {1, remaining}
"#,
        );
        let (status, remaining_after): (i64, i64) = script
            .key(&key)
            .arg(room_id)
            .arg(code)
            .invoke_async(conn)
            .await
            .map_err(|e| AppError::Redis(e.to_string()))?;

        match status {
            1 => {}
            0 => return Err(AppError::BadRequest("invalid or used ticket".to_string())),
            2 => return Err(AppError::BadRequest("ticket room mismatch".to_string())),
            3 => return Err(AppError::BadRequest("invite code mismatch".to_string())),
            _ => return Err(AppError::Config("unexpected redeem status".to_string())),
        }

        let redeem_token = uuid::Uuid::new_v4().simple().to_string();
        let redeem_payload = RedeemPayload {
            room_id: room_id.to_string(),
            user_name: user_name.to_string(),
        };
        let serialized =
            serde_json::to_string(&redeem_payload).map_err(|e| AppError::Config(e.to_string()))?;
        conn.set_ex::<_, _, ()>(
            self.redeem_key(&redeem_token),
            serialized,
            redeem_ttl_seconds,
        )
        .await
        .map_err(|e| AppError::Redis(e.to_string()))?;
        Ok(RedeemTicketResult {
            redeem_token,
            remaining_uses: remaining_after.max(0) as u64,
        })
    }

    pub async fn consume_redeem<C>(
        &self,
        conn: &mut C,
        redeem_token: &str,
        room_id: &str,
        user_name: &str,
    ) -> AppResult<()>
    where
        C: AsyncCommands + ConnectionLike + Send,
    {
        let raw: Option<String> = redis::cmd("GETDEL")
            .arg(self.redeem_key(redeem_token))
            .query_async(conn)
            .await
            .map_err(|e| AppError::Redis(e.to_string()))?;
        let raw =
            raw.ok_or_else(|| AppError::BadRequest("invalid or expired redeem token".to_string()))?;
        let payload: RedeemPayload =
            serde_json::from_str(&raw).map_err(|e| AppError::Config(e.to_string()))?;
        if payload.room_id != room_id || payload.user_name != user_name {
            return Err(AppError::BadRequest("redeem token mismatch".to_string()));
        }
        Ok(())
    }

    pub async fn issue_broadcast_start<C>(
        &self,
        conn: &mut C,
        room_id: &str,
        host_identity: &str,
        ttl_seconds: u64,
    ) -> AppResult<String>
    where
        C: AsyncCommands + ConnectionLike + Send,
    {
        let token = uuid::Uuid::new_v4().simple().to_string();
        let payload = BroadcastStartPayload {
            room_id: room_id.to_string(),
            host_identity: host_identity.to_string(),
        };
        let serialized =
            serde_json::to_string(&payload).map_err(|e| AppError::Config(e.to_string()))?;
        conn.set_ex::<_, _, ()>(self.broadcast_key(&token), serialized, ttl_seconds)
            .await
            .map_err(|e| AppError::Redis(e.to_string()))?;
        Ok(token)
    }

    pub async fn consume_broadcast_start<C>(
        &self,
        conn: &mut C,
        token: &str,
        room_id: &str,
        host_identity: &str,
    ) -> AppResult<()>
    where
        C: AsyncCommands + ConnectionLike + Send,
    {
        let raw: Option<String> = redis::cmd("GETDEL")
            .arg(self.broadcast_key(token))
            .query_async(conn)
            .await
            .map_err(|e| AppError::Redis(e.to_string()))?;
        let raw = raw.ok_or_else(|| {
            AppError::BadRequest("invalid or expired broadcast issue token".to_string())
        })?;
        let payload: BroadcastStartPayload =
            serde_json::from_str(&raw).map_err(|e| AppError::Config(e.to_string()))?;
        if payload.room_id != room_id || payload.host_identity != host_identity {
            return Err(AppError::BadRequest("broadcast token mismatch".to_string()));
        }
        Ok(())
    }

    fn ticket_key(&self, ticket: &str) -> String {
        format!("{}:ticket:{}", self.prefix, ticket)
    }

    fn redeem_key(&self, redeem_token: &str) -> String {
        format!("{}:redeem:{}", self.prefix, redeem_token)
    }

    fn broadcast_key(&self, token: &str) -> String {
        format!("{}:broadcast:{}", self.prefix, token)
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct RedeemPayload {
    room_id: String,
    user_name: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct BroadcastStartPayload {
    room_id: String,
    host_identity: String,
}

#[derive(Debug, Serialize)]
pub struct IssuedInvite {
    pub invite_ticket: String,
    pub invite_code: String,
    pub expires_in_seconds: u64,
    pub max_uses: u64,
}

#[derive(Debug, Serialize)]
pub struct RedeemTicketResult {
    pub redeem_token: String,
    pub remaining_uses: u64,
}

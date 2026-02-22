use crate::error::{AppError, AppResult};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};

#[derive(Clone)]
pub struct InviteService {
    prefix: String,
    ttl_seconds: u64,
}

impl InviteService {
    pub fn new(prefix: String, ttl_seconds: u64) -> Self {
        Self {
            prefix,
            ttl_seconds,
        }
    }

    pub async fn create_ticket<C>(
        &self,
        conn: &mut C,
        room_id: &str,
        host_identity: &str,
    ) -> AppResult<IssuedInvite>
    where
        C: AsyncCommands + Send,
    {
        let full = uuid::Uuid::new_v4().simple().to_string();
        let code = full[..8].to_string();
        let ticket = uuid::Uuid::new_v4().simple().to_string();
        let payload = InviteTicketPayload {
            room_id: room_id.to_string(),
            host_identity: host_identity.to_string(),
            invite_code: code.clone(),
        };
        let serialized =
            serde_json::to_string(&payload).map_err(|e| AppError::Config(e.to_string()))?;
        let key = self.ticket_key(&ticket);
        conn.set_ex::<_, _, ()>(key, serialized, self.ttl_seconds)
            .await
            .map_err(|e| AppError::Redis(e.to_string()))?;

        Ok(IssuedInvite {
            invite_ticket: ticket,
            invite_code: code,
            expires_in_seconds: self.ttl_seconds,
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
    ) -> AppResult<String>
    where
        C: AsyncCommands + Send,
    {
        let raw: Option<String> = redis::cmd("GETDEL")
            .arg(self.ticket_key(ticket))
            .query_async(conn)
            .await
            .map_err(|e| AppError::Redis(e.to_string()))?;

        let raw = raw.ok_or_else(|| AppError::BadRequest("invalid or used ticket".to_string()))?;
        let payload: InviteTicketPayload =
            serde_json::from_str(&raw).map_err(|e| AppError::Config(e.to_string()))?;

        if payload.room_id != room_id {
            return Err(AppError::BadRequest("ticket room mismatch".to_string()));
        }
        if payload.invite_code != code {
            return Err(AppError::BadRequest("invite code mismatch".to_string()));
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
        Ok(redeem_token)
    }

    pub async fn consume_redeem<C>(
        &self,
        conn: &mut C,
        redeem_token: &str,
        room_id: &str,
        user_name: &str,
    ) -> AppResult<()>
    where
        C: AsyncCommands + Send,
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
        C: AsyncCommands + Send,
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
        C: AsyncCommands + Send,
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
struct InviteTicketPayload {
    room_id: String,
    host_identity: String,
    invite_code: String,
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
}

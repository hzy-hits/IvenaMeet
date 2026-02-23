use crate::error::{AppError, AppResult};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};

#[derive(Clone)]
pub struct SessionService {
    prefix: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionClaims {
    pub user_name: String,
    pub room_id: String,
    pub role: String,
}

impl SessionService {
    pub fn new(prefix: String) -> Self {
        Self { prefix }
    }

    pub async fn issue<C>(
        &self,
        conn: &mut C,
        claims: SessionClaims,
        ttl_seconds: u64,
    ) -> AppResult<String>
    where
        C: AsyncCommands + Send,
    {
        let token = uuid::Uuid::new_v4().simple().to_string();
        let raw = serde_json::to_string(&claims).map_err(|e| AppError::Config(e.to_string()))?;
        conn.set_ex::<_, _, ()>(self.key(&token), raw, ttl_seconds)
            .await
            .map_err(|e| AppError::Redis(e.to_string()))?;
        Ok(token)
    }

    pub async fn verify<C>(&self, conn: &mut C, token: &str) -> AppResult<SessionClaims>
    where
        C: AsyncCommands + Send,
    {
        let raw: Option<String> = conn
            .get(self.key(token))
            .await
            .map_err(|e| AppError::Redis(e.to_string()))?;
        let raw = raw
            .ok_or_else(|| AppError::Unauthorized("invalid or expired app session".to_string()))?;
        serde_json::from_str(&raw).map_err(|e| AppError::Config(e.to_string()))
    }

    pub async fn refresh<C>(
        &self,
        conn: &mut C,
        token: &str,
        ttl_seconds: u64,
    ) -> AppResult<(String, SessionClaims)>
    where
        C: AsyncCommands + Send,
    {
        let raw: Option<String> = redis::cmd("GETDEL")
            .arg(self.key(token))
            .query_async(conn)
            .await
            .map_err(|e| AppError::Redis(e.to_string()))?;
        let raw = raw
            .ok_or_else(|| AppError::Unauthorized("invalid or expired app session".to_string()))?;
        let claims: SessionClaims =
            serde_json::from_str(&raw).map_err(|e| AppError::Config(e.to_string()))?;

        let new_token = uuid::Uuid::new_v4().simple().to_string();
        conn.set_ex::<_, _, ()>(self.key(&new_token), raw, ttl_seconds)
            .await
            .map_err(|e| AppError::Redis(e.to_string()))?;

        Ok((new_token, claims))
    }

    pub async fn revoke<C>(&self, conn: &mut C, token: &str) -> AppResult<()>
    where
        C: AsyncCommands + Send,
    {
        let _: i64 = conn
            .del(self.key(token))
            .await
            .map_err(|e| AppError::Redis(e.to_string()))?;
        Ok(())
    }

    fn key(&self, token: &str) -> String {
        format!("{}:{}", self.prefix, token)
    }
}

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
    #[serde(default)]
    pub jti: Option<String>,
}

impl SessionService {
    pub fn new(prefix: String) -> Self {
        Self { prefix }
    }

    pub async fn issue<C>(
        &self,
        conn: &mut C,
        mut claims: SessionClaims,
        ttl_seconds: u64,
    ) -> AppResult<String>
    where
        C: AsyncCommands + Send,
    {
        if claims.jti.as_deref().map(|v| v.is_empty()).unwrap_or(true) {
            claims.jti = Some(uuid::Uuid::new_v4().simple().to_string());
        }
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
        let mut claims: SessionClaims =
            serde_json::from_str(&raw).map_err(|e| AppError::Config(e.to_string()))?;
        if claims.jti.as_deref().map(|v| v.is_empty()).unwrap_or(true) {
            claims.jti = Some(token.to_string());
        }
        Ok(claims)
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
        let mut claims: SessionClaims =
            serde_json::from_str(&raw).map_err(|e| AppError::Config(e.to_string()))?;
        if claims.jti.as_deref().map(|v| v.is_empty()).unwrap_or(true) {
            claims.jti = Some(token.to_string());
        }

        let new_token = uuid::Uuid::new_v4().simple().to_string();
        let new_raw =
            serde_json::to_string(&claims).map_err(|e| AppError::Config(e.to_string()))?;
        conn.set_ex::<_, _, ()>(self.key(&new_token), new_raw, ttl_seconds)
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

    pub async fn ttl_seconds<C>(&self, conn: &mut C, token: &str) -> AppResult<u64>
    where
        C: AsyncCommands + Send,
    {
        let ttl: i64 = redis::cmd("TTL")
            .arg(self.key(token))
            .query_async(conn)
            .await
            .map_err(|e| AppError::Redis(e.to_string()))?;
        if ttl < 0 {
            return Err(AppError::Unauthorized(
                "invalid or expired app session".to_string(),
            ));
        }
        Ok(ttl as u64)
    }

    fn key(&self, token: &str) -> String {
        format!("{}:{}", self.prefix, token)
    }
}

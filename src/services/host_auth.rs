use crate::error::{AppError, AppResult};
use redis::AsyncCommands;

#[derive(Clone)]
pub struct HostAuthService {
    prefix: String,
}

impl HostAuthService {
    pub fn new(prefix: String) -> Self {
        Self { prefix }
    }

    pub async fn set_totp_secret<C>(
        &self,
        conn: &mut C,
        host_identity: &str,
        secret: &str,
    ) -> AppResult<()>
    where
        C: AsyncCommands + Send,
    {
        conn.set::<_, _, ()>(self.mfa_key(host_identity), secret)
            .await
            .map_err(|e| AppError::Redis(e.to_string()))
    }

    pub async fn get_totp_secret<C>(
        &self,
        conn: &mut C,
        host_identity: &str,
    ) -> AppResult<Option<String>>
    where
        C: AsyncCommands + Send,
    {
        conn.get(self.mfa_key(host_identity))
            .await
            .map_err(|e| AppError::Redis(e.to_string()))
    }

    fn mfa_key(&self, host_identity: &str) -> String {
        format!("{}:mfa:{}", self.prefix, host_identity)
    }

}

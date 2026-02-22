use crate::error::{AppError, AppResult};
use redis::AsyncCommands;

#[derive(Clone)]
pub struct RateLimitService;

impl RateLimitService {
    pub fn new() -> Self {
        Self
    }

    pub async fn check<C>(
        &self,
        conn: &mut C,
        bucket: &str,
        key: &str,
        limit: u64,
        window_seconds: u64,
    ) -> AppResult<()>
    where
        C: AsyncCommands + Send,
    {
        let redis_key = format!("rl:{}:{}", bucket, key);
        let current: u64 = conn
            .incr(&redis_key, 1_u64)
            .await
            .map_err(|e| AppError::Redis(e.to_string()))?;
        if current == 1 {
            let _: () = conn
                .expire(&redis_key, window_seconds as i64)
                .await
                .map_err(|e| AppError::Redis(e.to_string()))?;
        }
        if current > limit {
            return Err(AppError::TooManyRequests(format!(
                "rate limited: {} > {}",
                current, limit
            )));
        }
        Ok(())
    }
}

use crate::error::{AppError, AppResult};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct MemberMediaPermission {
    pub camera: bool,
    pub screen_share: bool,
}

impl MemberMediaPermission {
    pub const fn host_default() -> Self {
        Self {
            camera: true,
            screen_share: true,
        }
    }

    pub const fn member_default() -> Self {
        Self {
            camera: false,
            screen_share: false,
        }
    }
}

#[derive(Clone)]
pub struct StagePermissionService {
    prefix: String,
}

impl StagePermissionService {
    pub fn new(prefix: String) -> Self {
        Self { prefix }
    }

    pub async fn get_member<C>(
        &self,
        conn: &mut C,
        room_id: &str,
        user_name: &str,
    ) -> AppResult<Option<MemberMediaPermission>>
    where
        C: AsyncCommands + Send,
    {
        let raw: Option<String> = conn
            .get(self.key(room_id, user_name))
            .await
            .map_err(|e| AppError::Redis(e.to_string()))?;
        let Some(raw) = raw else {
            return Ok(None);
        };
        let parsed = serde_json::from_str::<MemberMediaPermission>(&raw)
            .map_err(|e| AppError::Config(e.to_string()))?;
        Ok(Some(parsed))
    }

    pub async fn set_member<C>(
        &self,
        conn: &mut C,
        room_id: &str,
        user_name: &str,
        permission: MemberMediaPermission,
        ttl_seconds: u64,
    ) -> AppResult<()>
    where
        C: AsyncCommands + Send,
    {
        let raw = serde_json::to_string(&permission).map_err(|e| AppError::Config(e.to_string()))?;
        conn.set_ex::<_, _, ()>(self.key(room_id, user_name), raw, ttl_seconds)
            .await
            .map_err(|e| AppError::Redis(e.to_string()))?;
        Ok(())
    }

    pub async fn get_or_default_member<C>(
        &self,
        conn: &mut C,
        room_id: &str,
        user_name: &str,
        ttl_seconds: u64,
    ) -> AppResult<MemberMediaPermission>
    where
        C: AsyncCommands + Send,
    {
        if let Some(permission) = self.get_member(conn, room_id, user_name).await? {
            return Ok(permission);
        }
        let default_permission = MemberMediaPermission::member_default();
        self.set_member(conn, room_id, user_name, default_permission, ttl_seconds)
            .await?;
        Ok(default_permission)
    }

    fn key(&self, room_id: &str, user_name: &str) -> String {
        format!("{}:{}:{}", self.prefix, room_id, user_name)
    }
}

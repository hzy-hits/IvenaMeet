use crate::error::{AppError, AppResult};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct MemberMediaPermission {
    #[serde(default)]
    pub camera_granted_until: i64,
    #[serde(default)]
    pub screen_share_granted_until: i64,
}

#[derive(Debug, Clone, Copy)]
pub struct EffectiveMemberMediaPermission {
    pub camera_allowed: bool,
    pub screen_share_allowed: bool,
    pub camera_expires_at: Option<i64>,
    pub screen_share_expires_at: Option<i64>,
    pub expired_camera: bool,
    pub expired_screen_share: bool,
}

impl MemberMediaPermission {
    pub const fn member_default() -> Self {
        Self {
            camera_granted_until: 0,
            screen_share_granted_until: 0,
        }
    }

    pub fn set_camera_granted(&mut self, enabled: bool, now_ts: i64, lease_seconds: u64) {
        self.camera_granted_until = if enabled {
            now_ts.saturating_add(lease_seconds as i64)
        } else {
            0
        };
    }

    pub fn set_screen_share_granted(&mut self, enabled: bool, now_ts: i64, lease_seconds: u64) {
        self.screen_share_granted_until = if enabled {
            now_ts.saturating_add(lease_seconds as i64)
        } else {
            0
        };
    }

    pub fn resolve_at(&mut self, now_ts: i64) -> EffectiveMemberMediaPermission {
        let mut expired_camera = false;
        let mut expired_screen_share = false;

        if self.camera_granted_until > 0 && self.camera_granted_until <= now_ts {
            self.camera_granted_until = 0;
            expired_camera = true;
        }
        if self.screen_share_granted_until > 0 && self.screen_share_granted_until <= now_ts {
            self.screen_share_granted_until = 0;
            expired_screen_share = true;
        }

        let camera_allowed = self.camera_granted_until > now_ts;
        let screen_share_allowed = self.screen_share_granted_until > now_ts;

        EffectiveMemberMediaPermission {
            camera_allowed,
            screen_share_allowed,
            camera_expires_at: if camera_allowed {
                Some(self.camera_granted_until)
            } else {
                None
            },
            screen_share_expires_at: if screen_share_allowed {
                Some(self.screen_share_granted_until)
            } else {
                None
            },
            expired_camera,
            expired_screen_share,
        }
    }
}

impl EffectiveMemberMediaPermission {
    pub const fn host_default() -> Self {
        Self {
            camera_allowed: true,
            screen_share_allowed: true,
            camera_expires_at: None,
            screen_share_expires_at: None,
            expired_camera: false,
            expired_screen_share: false,
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

    pub async fn resolve_member<C>(
        &self,
        conn: &mut C,
        room_id: &str,
        user_name: &str,
        ttl_seconds: u64,
        now_ts: i64,
    ) -> AppResult<EffectiveMemberMediaPermission>
    where
        C: AsyncCommands + Send,
    {
        let mut permission = self
            .get_or_default_member(conn, room_id, user_name, ttl_seconds)
            .await?;
        let effective = permission.resolve_at(now_ts);
        if effective.expired_camera || effective.expired_screen_share {
            self.set_member(conn, room_id, user_name, permission, ttl_seconds)
                .await?;
        }
        Ok(effective)
    }

    fn key(&self, room_id: &str, user_name: &str) -> String {
        format!("{}:{}:{}", self.prefix, room_id, user_name)
    }
}

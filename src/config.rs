use crate::error::AppError;

#[derive(Clone, Debug)]
pub struct Config {
    pub app_bind: String,
    pub redis_url: String,
    pub sqlite_path: String,
    pub meet_base_url: String,
    pub livekit_host: String,
    pub livekit_public_ws_url: String,
    pub livekit_api_key: String,
    pub livekit_api_secret: String,
    pub token_ttl_seconds: u64,
    pub invite_ttl_seconds: u64,
    pub redeem_ttl_seconds: u64,
    pub room_ttl_seconds: u64,
    pub broadcast_issue_ttl_seconds: u64,
    pub invite_prefix: String,
    pub require_invite: bool,
    pub admin_token: String,
    pub require_admin_for_join: bool,
    pub rate_limit_window_seconds: u64,
    pub rate_limit_room_join: u64,
    pub rate_limit_invite_redeem: u64,
    pub rate_limit_broadcast_start: u64,
}

impl Config {
    pub fn from_env() -> Result<Self, AppError> {
        Ok(Self {
            app_bind: env_or("APP_BIND", "0.0.0.0:3000"),
            redis_url: env_or("REDIS_URL", "redis://127.0.0.1:6379/"),
            sqlite_path: env_or("SQLITE_PATH", "/opt/livekit/control-plane/data/app.db"),
            meet_base_url: env_or("MEET_BASE_URL", "https://meet.ivena.top"),
            livekit_host: env_required("LIVEKIT_HOST")?,
            livekit_public_ws_url: env_or("LIVEKIT_PUBLIC_WS_URL", "wss://livekit.ivena.top"),
            livekit_api_key: env_required("LIVEKIT_API_KEY")?,
            livekit_api_secret: env_required("LIVEKIT_API_SECRET")?,
            token_ttl_seconds: parse_env_u64("TOKEN_TTL_SECONDS", 4 * 3600)?,
            invite_ttl_seconds: parse_env_u64("INVITE_TTL_SECONDS", 24 * 3600)?,
            redeem_ttl_seconds: parse_env_u64("REDEEM_TTL_SECONDS", 300)?,
            room_ttl_seconds: parse_env_u64("ROOM_TTL_SECONDS", 4 * 3600)?,
            broadcast_issue_ttl_seconds: parse_env_u64("BROADCAST_ISSUE_TTL_SECONDS", 120)?,
            invite_prefix: env_or("INVITE_PREFIX", "invite"),
            require_invite: parse_env_bool("REQUIRE_INVITE", false),
            admin_token: env_required("ADMIN_TOKEN")?,
            require_admin_for_join: parse_env_bool("REQUIRE_ADMIN_FOR_JOIN", false),
            rate_limit_window_seconds: parse_env_u64("RATE_LIMIT_WINDOW_SECONDS", 60)?,
            rate_limit_room_join: parse_env_u64("RATE_LIMIT_ROOM_JOIN", 20)?,
            rate_limit_invite_redeem: parse_env_u64("RATE_LIMIT_INVITE_REDEEM", 12)?,
            rate_limit_broadcast_start: parse_env_u64("RATE_LIMIT_BROADCAST_START", 3)?,
        })
    }
}

fn env_required(key: &str) -> Result<String, AppError> {
    std::env::var(key).map_err(|_| AppError::Config(format!("missing env: {key}")))
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn parse_env_u64(key: &str, default: u64) -> Result<u64, AppError> {
    match std::env::var(key) {
        Ok(v) => v
            .parse::<u64>()
            .map_err(|_| AppError::Config(format!("invalid integer env: {key}"))),
        Err(_) => Ok(default),
    }
}

fn parse_env_bool(key: &str, default: bool) -> bool {
    match std::env::var(key) {
        Ok(v) => matches!(v.to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"),
        Err(_) => default,
    }
}

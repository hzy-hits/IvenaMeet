use crate::error::AppError;
use std::net::IpAddr;

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
    pub invite_max_uses: u64,
    pub redeem_ttl_seconds: u64,
    pub room_ttl_seconds: u64,
    pub broadcast_issue_ttl_seconds: u64,
    pub invite_prefix: String,
    pub session_prefix: String,
    pub session_ttl_seconds: u64,
    pub host_session_prefix: String,
    pub host_session_ttl_seconds: u64,
    pub host_auth_prefix: String,
    pub host_mfa_issuer: String,
    pub require_invite: bool,
    pub enable_agent_api: bool,
    pub bootstrap_admin_token: String,
    pub bootstrap_admin_token_previous: Option<String>,
    pub runtime_admin_token: String,
    pub runtime_admin_token_previous: Option<String>,
    pub control_admin_allowlist_ips: Vec<IpAddr>,
    pub require_admin_for_join: bool,
    pub rate_limit_window_seconds: u64,
    pub rate_limit_room_join: u64,
    pub rate_limit_invite_redeem: u64,
    pub rate_limit_host_login_totp: u64,
    pub rate_limit_broadcast_start: u64,
    pub rate_limit_chat_message: u64,
    pub avatar_upload_limit_per_minute: u64,
    pub avatar_upload_limit_per_day: u64,
    pub avatar_storage_quota_bytes: u64,
    pub member_media_grant_ttl_seconds: u64,
    pub trusted_proxy_ips: Vec<IpAddr>,
}

impl Config {
    pub fn from_env() -> Result<Self, AppError> {
        let app_env = env_or("APP_ENV", "development");
        let allow_open_join_in_prod = parse_env_bool("ALLOW_OPEN_JOIN_IN_PROD", false);
        let require_invite = parse_env_bool("REQUIRE_INVITE", true);
        let legacy_admin_token = env_optional("ADMIN_TOKEN");
        let bootstrap_admin_token = env_optional("BOOTSTRAP_ADMIN_TOKEN")
            .or_else(|| legacy_admin_token.clone())
            .ok_or_else(|| {
                AppError::Config(
                    "missing env: BOOTSTRAP_ADMIN_TOKEN (or legacy ADMIN_TOKEN)".to_string(),
                )
            })?;
        let runtime_admin_token = env_optional("RUNTIME_ADMIN_TOKEN")
            .or_else(|| legacy_admin_token)
            .ok_or_else(|| {
                AppError::Config(
                    "missing env: RUNTIME_ADMIN_TOKEN (or legacy ADMIN_TOKEN)".to_string(),
                )
            })?;

        if app_env.eq_ignore_ascii_case("production") && !require_invite && !allow_open_join_in_prod
        {
            return Err(AppError::Config(
                "unsafe config: REQUIRE_INVITE must be true when APP_ENV=production (or set ALLOW_OPEN_JOIN_IN_PROD=true to override)".to_string(),
            ));
        }

        Ok(Self {
            app_bind: env_or("APP_BIND", "0.0.0.0:3000"),
            redis_url: env_or("REDIS_URL", "redis://127.0.0.1:6379/"),
            sqlite_path: env_or("SQLITE_PATH", "/opt/livekit/control-plane/data/app.db"),
            meet_base_url: env_or("MEET_BASE_URL", "https://meet.example.com"),
            livekit_host: env_required("LIVEKIT_HOST")?,
            livekit_public_ws_url: env_or("LIVEKIT_PUBLIC_WS_URL", "wss://livekit.example.com"),
            livekit_api_key: env_required("LIVEKIT_API_KEY")?,
            livekit_api_secret: env_required("LIVEKIT_API_SECRET")?,
            token_ttl_seconds: parse_env_u64("TOKEN_TTL_SECONDS", 4 * 3600)?,
            invite_ttl_seconds: parse_env_u64("INVITE_TTL_SECONDS", 24 * 3600)?,
            invite_max_uses: parse_env_u64("INVITE_MAX_USES", 10)?,
            redeem_ttl_seconds: parse_env_u64("REDEEM_TTL_SECONDS", 300)?,
            room_ttl_seconds: parse_env_u64("ROOM_TTL_SECONDS", 4 * 3600)?,
            broadcast_issue_ttl_seconds: parse_env_u64("BROADCAST_ISSUE_TTL_SECONDS", 120)?,
            invite_prefix: env_or("INVITE_PREFIX", "invite"),
            session_prefix: env_or("SESSION_PREFIX", "appsession"),
            session_ttl_seconds: parse_env_u64("SESSION_TTL_SECONDS", 30 * 60)?,
            host_session_prefix: env_or("HOST_SESSION_PREFIX", "hostsession"),
            host_session_ttl_seconds: parse_env_u64("HOST_SESSION_TTL_SECONDS", 15 * 60)?,
            host_auth_prefix: env_or("HOST_AUTH_PREFIX", "hostauth"),
            host_mfa_issuer: env_or("HOST_MFA_ISSUER", "Ivena Meet"),
            require_invite,
            enable_agent_api: parse_env_bool("ENABLE_AGENT_API", false),
            bootstrap_admin_token,
            bootstrap_admin_token_previous: env_optional("BOOTSTRAP_ADMIN_TOKEN_PREVIOUS"),
            runtime_admin_token,
            runtime_admin_token_previous: env_optional("RUNTIME_ADMIN_TOKEN_PREVIOUS"),
            control_admin_allowlist_ips: parse_env_ip_list("CONTROL_ADMIN_ALLOWLIST_IPS")?,
            require_admin_for_join: parse_env_bool("REQUIRE_ADMIN_FOR_JOIN", false),
            rate_limit_window_seconds: parse_env_u64("RATE_LIMIT_WINDOW_SECONDS", 60)?,
            rate_limit_room_join: parse_env_u64("RATE_LIMIT_ROOM_JOIN", 20)?,
            rate_limit_invite_redeem: parse_env_u64("RATE_LIMIT_INVITE_REDEEM", 12)?,
            rate_limit_host_login_totp: parse_env_u64("RATE_LIMIT_HOST_LOGIN_TOTP", 12)?,
            rate_limit_broadcast_start: parse_env_u64("RATE_LIMIT_BROADCAST_START", 3)?,
            rate_limit_chat_message: parse_env_u64("RATE_LIMIT_CHAT_MESSAGE", 30)?,
            avatar_upload_limit_per_minute: parse_env_u64(
                "RATE_LIMIT_AVATAR_UPLOAD_PER_MINUTE",
                2,
            )?,
            avatar_upload_limit_per_day: parse_env_u64("RATE_LIMIT_AVATAR_UPLOAD_PER_DAY", 100)?,
            avatar_storage_quota_bytes: parse_env_u64(
                "AVATAR_STORAGE_QUOTA_BYTES",
                500 * 1024 * 1024,
            )?,
            member_media_grant_ttl_seconds: parse_env_u64(
                "MEMBER_MEDIA_GRANT_TTL_SECONDS",
                30 * 60,
            )?,
            trusted_proxy_ips: parse_env_ip_list("TRUSTED_PROXY_IPS")?,
        })
    }

    pub fn is_bootstrap_admin_token(&self, token: &str) -> bool {
        token == self.bootstrap_admin_token
            || self
                .bootstrap_admin_token_previous
                .as_deref()
                .is_some_and(|v| v == token)
    }

    pub fn is_runtime_admin_token(&self, token: &str) -> bool {
        token == self.runtime_admin_token
            || self
                .runtime_admin_token_previous
                .as_deref()
                .is_some_and(|v| v == token)
    }

    pub fn is_control_peer_allowed(&self, peer_ip: IpAddr) -> bool {
        self.control_admin_allowlist_ips.is_empty()
            || self.control_admin_allowlist_ips.contains(&peer_ip)
    }
}

fn env_required(key: &str) -> Result<String, AppError> {
    std::env::var(key).map_err(|_| AppError::Config(format!("missing env: {key}")))
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn env_optional(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
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

fn parse_env_ip_list(key: &str) -> Result<Vec<IpAddr>, AppError> {
    let raw = std::env::var(key).unwrap_or_default();
    if raw.trim().is_empty() {
        return Ok(Vec::new());
    }
    raw.split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| {
            s.parse::<IpAddr>()
                .map_err(|_| AppError::Config(format!("invalid ip env {key}: {s}")))
        })
        .collect()
}

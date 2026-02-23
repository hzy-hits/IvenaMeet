use crate::config::Config;
use crate::error::{AppError, AppResult};
use crate::services::{
    HostAuthService, InviteService, LiveKitService, RateLimitService, SessionService,
    StorageService,
};
use redis::aio::ConnectionManager;

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub redis: ConnectionManager,
    pub invite_service: InviteService,
    pub session_service: SessionService,
    pub host_session_service: SessionService,
    pub host_auth_service: HostAuthService,
    pub rate_limit_service: RateLimitService,
    pub livekit_service: LiveKitService,
    pub storage_service: StorageService,
}

impl AppState {
    pub async fn build(config: Config) -> AppResult<Self> {
        let redis_client = redis::Client::open(config.redis_url.clone())
            .map_err(|e| AppError::Config(format!("invalid redis url: {e}")))?;
        let redis = redis_client
            .get_connection_manager()
            .await
            .map_err(|e| AppError::Redis(e.to_string()))?;

        let invite_service =
            InviteService::new(config.invite_prefix.clone(), config.invite_ttl_seconds);
        let session_service = SessionService::new(config.session_prefix.clone());
        let host_session_service = SessionService::new(config.host_session_prefix.clone());
        let host_auth_service = HostAuthService::new(config.host_auth_prefix.clone());
        let rate_limit_service = RateLimitService::new();
        let livekit_service = LiveKitService::new(
            config.livekit_host.clone(),
            config.livekit_public_ws_url.clone(),
            config.livekit_api_key.clone(),
            config.livekit_api_secret.clone(),
            config.token_ttl_seconds,
        );
        let storage_service = StorageService::new(&config.sqlite_path)?;

        Ok(Self {
            config,
            redis,
            invite_service,
            session_service,
            host_session_service,
            host_auth_service,
            rate_limit_service,
            livekit_service,
            storage_service,
        })
    }
}

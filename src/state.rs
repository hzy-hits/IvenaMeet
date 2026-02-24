use crate::config::Config;
use crate::error::{AppError, AppResult};
use crate::services::{
    HostAuthService, InviteService, LiveKitService, PresenceService, RateLimitService,
    SessionService, StagePermissionService, StorageService, storage::ChatMessage,
};
use redis::aio::ConnectionManager;
use tokio::sync::broadcast;

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub redis: ConnectionManager,
    pub invite_service: InviteService,
    pub session_service: SessionService,
    pub host_session_service: SessionService,
    pub host_auth_service: HostAuthService,
    pub presence_service: PresenceService,
    pub rate_limit_service: RateLimitService,
    pub livekit_service: LiveKitService,
    pub stage_permission_service: StagePermissionService,
    pub storage_service: StorageService,
    pub chat_bus: broadcast::Sender<ChatMessage>,
}

impl AppState {
    pub async fn build(config: Config) -> AppResult<Self> {
        let redis_client = redis::Client::open(config.redis_url.clone())
            .map_err(|e| AppError::Config(format!("invalid redis url: {e}")))?;
        let redis = redis_client
            .get_connection_manager()
            .await
            .map_err(|e| AppError::Redis(e.to_string()))?;

        let invite_service = InviteService::new(
            config.invite_prefix.clone(),
            config.invite_ttl_seconds,
            config.invite_max_uses,
        );
        let session_service = SessionService::new(config.session_prefix.clone());
        let host_session_service = SessionService::new(config.host_session_prefix.clone());
        let host_auth_service = HostAuthService::new(config.host_auth_prefix.clone());
        let presence_service = PresenceService::new("presence".to_string());
        let rate_limit_service = RateLimitService::new();
        let (chat_bus, _) = broadcast::channel(1024);
        let livekit_service = LiveKitService::new(
            config.livekit_host.clone(),
            config.livekit_public_ws_url.clone(),
            config.livekit_api_key.clone(),
            config.livekit_api_secret.clone(),
            config.token_ttl_seconds,
        );
        let stage_permission_service = StagePermissionService::new("stageperm".to_string());
        let storage_service = StorageService::new(&config.sqlite_path)?;

        Ok(Self {
            config,
            redis,
            invite_service,
            session_service,
            host_session_service,
            host_auth_service,
            presence_service,
            rate_limit_service,
            livekit_service,
            stage_permission_service,
            storage_service,
            chat_bus,
        })
    }
}

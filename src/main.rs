mod app;
mod config;
mod error;
mod middleware;
mod request_meta;
mod routes;
mod services;
mod state;
mod validation;

use crate::error::AppError;
use tokio::time::{Duration, MissedTickBehavior, interval};
use tracing::{info, warn};

#[tokio::main]
async fn main() -> Result<(), AppError> {
    dotenvy::dotenv().ok();
    init_tracing();

    let config = config::Config::from_env()?;
    let bind = config.app_bind.clone();

    let state = state::AppState::build(config).await?;
    spawn_background_jobs(state.clone());
    let app = app::build_router(state);

    let listener = tokio::net::TcpListener::bind(&bind)
        .await
        .map_err(AppError::Io)?;
    info!(%bind, "control plane listening");

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .await
    .map_err(AppError::Io)
}

fn spawn_background_jobs(state: state::AppState) {
    tokio::spawn(async move {
        let mut ticker = interval(Duration::from_secs(60));
        ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
        loop {
            ticker.tick().await;
            match routes::broadcast::cleanup_expired_room_broadcasts(&state).await {
                Ok(0) => {}
                Ok(cleaned) => info!(cleaned, "expired room broadcasts cleaned"),
                Err(err) => warn!(error = %err, "failed to clean expired room broadcasts"),
            }
        }
    });
}

fn init_tracing() {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .json()
        .init();
}

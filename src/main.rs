mod app;
mod config;
mod error;
mod middleware;
mod routes;
mod services;
mod state;

use crate::error::AppError;
use tracing::info;

#[tokio::main]
async fn main() -> Result<(), AppError> {
    dotenvy::dotenv().ok();
    init_tracing();

    let config = config::Config::from_env()?;
    let bind = config.app_bind.clone();

    let state = state::AppState::build(config).await?;
    let app = app::build_router(state);

    let listener = tokio::net::TcpListener::bind(&bind)
        .await
        .map_err(AppError::Io)?;
    info!(%bind, "control plane listening");

    axum::serve(listener, app).await.map_err(AppError::Io)
}

fn init_tracing() {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .compact()
        .init();
}

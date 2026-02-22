use crate::middleware::{admin_auth, http_trace, request_id};
use crate::routes;
use crate::state::AppState;
use axum::{Router, middleware};

pub fn build_router(state: AppState) -> Router {
    let admin_routes = Router::new()
        .merge(routes::auth::router())
        .merge(routes::broadcast::router())
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            admin_auth::require_admin,
        ));

    let room_routes = if state.config.require_admin_for_join {
        routes::room::router().route_layer(middleware::from_fn_with_state(
            state.clone(),
            admin_auth::require_admin,
        ))
    } else {
        routes::room::router()
    };

    Router::new()
        .merge(routes::health::router())
        .merge(routes::invite::router())
        .merge(routes::session::router())
        .merge(room_routes)
        .merge(routes::chat::router())
        .merge(routes::user::router())
        .merge(admin_routes)
        .layer(middleware::from_fn(http_trace::log))
        .layer(middleware::from_fn(request_id::inject))
        .with_state(state)
}

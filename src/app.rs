use crate::middleware::{admin_auth, control_auth, http_trace, request_id};
use crate::routes;
use crate::state::AppState;
use axum::{Router, middleware};

pub fn build_router(state: AppState) -> Router {
    let control_routes = Router::new()
        .merge(routes::auth::router())
        .merge(routes::broadcast::router())
        .merge(routes::moderation::router())
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            control_auth::require_control,
        ));

    let admin_only_routes = routes::host_login::admin_router().route_layer(
        middleware::from_fn_with_state(state.clone(), admin_auth::require_admin),
    );

    let host_public_routes = routes::host_login::public_router();

    let room_routes = if state.config.require_admin_for_join {
        routes::room::router().route_layer(middleware::from_fn_with_state(
            state.clone(),
            admin_auth::require_admin,
        ))
    } else {
        routes::room::router()
    };

    let api_routes = Router::new()
        .merge(routes::health::router())
        .merge(routes::invite::router())
        .merge(host_public_routes)
        .merge(routes::session::router())
        .merge(room_routes)
        .merge(routes::chat::router())
        .merge(routes::user::router())
        .merge(control_routes)
        .merge(admin_only_routes);

    Router::new()
        .merge(api_routes.clone())
        .nest("/api", api_routes)
        .layer(middleware::from_fn(http_trace::log))
        .layer(middleware::from_fn(request_id::inject))
        .with_state(state)
}

use axum::{body::Body, http::Request, middleware::Next, response::Response};
use std::time::Instant;
use tracing::info;

pub async fn log(req: Request<Body>, next: Next) -> Response {
    let started = Instant::now();
    let method = req.method().clone();
    let uri = req.uri().to_string();
    let mut request_id = req
        .headers()
        .get("x-request-id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("-")
        .to_string();

    let res = next.run(req).await;
    let status = res.status().as_u16();
    let elapsed_ms = started.elapsed().as_millis() as u64;
    if request_id == "-" {
        request_id = res
            .headers()
            .get("x-request-id")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("-")
            .to_string();
    }

    info!(
        request_id,
        method = %method,
        uri,
        status,
        elapsed_ms,
        route = "http",
        "request completed"
    );
    res
}

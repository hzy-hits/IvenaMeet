use axum::{
    body::Body,
    http::{HeaderName, HeaderValue, Request},
    middleware::Next,
    response::Response,
};

const X_REQUEST_ID: HeaderName = HeaderName::from_static("x-request-id");

pub async fn inject(mut req: Request<Body>, next: Next) -> Response {
    let request_id = req
        .headers()
        .get(&X_REQUEST_ID)
        .and_then(|v| v.to_str().ok())
        .filter(|v| !v.trim().is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    if let Ok(value) = HeaderValue::from_str(&request_id) {
        req.headers_mut().insert(X_REQUEST_ID, value);
    }

    let mut res = next.run(req).await;
    if let Ok(value) = HeaderValue::from_str(&request_id) {
        res.headers_mut().insert(X_REQUEST_ID, value);
    }
    res
}

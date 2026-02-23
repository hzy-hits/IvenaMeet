use crate::error::{AppError, AppResult};
use crate::request_meta;
use crate::state::AppState;
use crate::validation;
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, State},
    http::{HeaderMap, HeaderValue, header::AUTHORIZATION},
    response::IntoResponse,
    routing::{get, post},
};
use base64::Engine;
use image::{GenericImageView, ImageFormat};
use serde::{Deserialize, Serialize};
use std::path::{Path as StdPath, PathBuf};
use tokio::fs;
use tracing::info;

const AVATAR_BODY_MAX_BYTES: usize = 2 * 1024 * 1024;
const AVATAR_IMAGE_MAX_BYTES: usize = 2 * 1024 * 1024;
const AVATAR_TARGET_SIZE: u32 = 256;
const AVATAR_MAX_PIXELS: u64 = 16_000_000;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/users/upsert", post(upsert_user))
        .merge(
            Router::new()
                .route("/users/avatar/upload", post(upload_avatar))
                .layer(DefaultBodyLimit::max(AVATAR_BODY_MAX_BYTES)),
        )
        .route("/avatars/:file_name", get(get_avatar))
}

#[derive(Debug, Deserialize)]
pub struct UpsertUserReq {
    pub user_name: String,
    pub nickname: String,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct UpsertUserResp {
    pub user_name: String,
    pub nickname: String,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UploadAvatarReq {
    pub data_url: String,
}

#[derive(Debug, Serialize)]
pub struct UploadAvatarResp {
    pub avatar_url: String,
}

async fn upsert_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<UpsertUserReq>,
) -> AppResult<Json<UpsertUserResp>> {
    let request_id = request_meta::request_id(&headers);
    let user_name = validation::user_name(&req.user_name)?;
    let nickname = validation::nickname(&req.nickname)?;
    let avatar_url = validation::avatar_url(req.avatar_url)?;

    let profile = state
        .storage_service
        .upsert_user(user_name, nickname, avatar_url)
        .await?;
    info!(
        request_id,
        route = "/users/upsert",
        user_name = profile.user_name,
        result = "ok",
        "user upserted"
    );

    Ok(Json(UpsertUserResp {
        user_name: profile.user_name,
        nickname: profile.nickname,
        avatar_url: profile.avatar_url,
    }))
}

async fn upload_avatar(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<UploadAvatarReq>,
) -> AppResult<Json<UploadAvatarResp>> {
    let request_id = request_meta::request_id(&headers);
    let token = bearer_from_headers(&headers)
        .ok_or_else(|| AppError::Unauthorized("missing app session token".to_string()))?;
    let mut redis = state.redis.clone();
    let claims = state.session_service.verify(&mut redis, token).await?;
    state
        .rate_limit_service
        .check(
            &mut redis,
            "avatar_upload_minute",
            &claims.user_name,
            state.config.avatar_upload_limit_per_minute,
            60,
        )
        .await?;
    state
        .rate_limit_service
        .check(
            &mut redis,
            "avatar_upload_day",
            &claims.user_name,
            state.config.avatar_upload_limit_per_day,
            24 * 3600,
        )
        .await?;

    let (ext, bytes) = decode_avatar_data_url(&req.data_url)?;
    if bytes.len() > AVATAR_IMAGE_MAX_BYTES {
        return Err(AppError::BadRequest(
            "avatar image must be <= 2MB".to_string(),
        ));
    }
    if !matches_magic(ext, &bytes) {
        return Err(AppError::BadRequest(
            "avatar image content mismatch".to_string(),
        ));
    }
    let ext_owned = ext.to_string();
    let webp_bytes =
        tokio::task::spawn_blocking(move || transcode_to_webp_square(&ext_owned, &bytes))
            .await
            .map_err(|e| AppError::Config(format!("avatar transcode task failed: {e}")))??;

    let dir = avatar_dir(&state.config.sqlite_path);
    fs::create_dir_all(&dir)
        .await
        .map_err(|e| AppError::Io(std::io::Error::new(e.kind(), e.to_string())))?;
    let old_avatar_url = state
        .storage_service
        .get_user(claims.user_name.clone())
        .await?
        .and_then(|u| u.avatar_url);
    let old_avatar_file = old_avatar_url
        .as_deref()
        .and_then(avatar_file_name_from_url)
        .map(ToOwned::to_owned);
    let old_avatar_size = if let Some(old_name) = &old_avatar_file {
        fs::metadata(dir.join(old_name))
            .await
            .map(|m| m.len())
            .unwrap_or(0)
    } else {
        0
    };
    let current_total = avatar_dir_total_bytes(&dir).await?;
    let projected_total = current_total
        .saturating_sub(old_avatar_size)
        .saturating_add(webp_bytes.len() as u64);
    if projected_total > state.config.avatar_storage_quota_bytes {
        return Err(AppError::TooManyRequests(
            "avatar storage quota exceeded".to_string(),
        ));
    }

    let file_name = format!(
        "{}_{}.webp",
        claims.user_name,
        uuid::Uuid::new_v4().simple()
    );
    let file_path = dir.join(&file_name);
    fs::write(&file_path, webp_bytes)
        .await
        .map_err(|e| AppError::Io(std::io::Error::new(e.kind(), e.to_string())))?;

    let avatar_url = format!("/api/avatars/{file_name}");
    let nickname = state
        .storage_service
        .get_user(claims.user_name.clone())
        .await?
        .map(|u| u.nickname)
        .unwrap_or_else(|| claims.user_name.clone());
    state
        .storage_service
        .upsert_user(
            claims.user_name.clone(),
            validation::nickname(&nickname)?,
            Some(avatar_url.clone()),
        )
        .await?;
    if let Some(old_name) = old_avatar_file {
        if old_name != file_name {
            let old_path = dir.join(old_name);
            if let Err(e) = fs::remove_file(old_path).await {
                if e.kind() != std::io::ErrorKind::NotFound {
                    return Err(AppError::Io(std::io::Error::new(e.kind(), e.to_string())));
                }
            }
        }
    }

    info!(
        request_id,
        route = "/users/avatar/upload",
        user_name = claims.user_name,
        room_id = claims.room_id,
        result = "ok",
        "avatar uploaded"
    );

    Ok(Json(UploadAvatarResp { avatar_url }))
}

async fn get_avatar(
    State(state): State<AppState>,
    Path(file_name): Path<String>,
) -> AppResult<impl IntoResponse> {
    if !is_safe_file_name(&file_name) {
        return Err(AppError::BadRequest("invalid avatar filename".to_string()));
    }
    let mime = content_type_from_ext(&file_name)
        .ok_or_else(|| AppError::BadRequest("unsupported avatar extension".to_string()))?;

    let path = avatar_dir(&state.config.sqlite_path).join(&file_name);
    let bytes = fs::read(path)
        .await
        .map_err(|_| AppError::BadRequest("avatar not found".to_string()))?;

    Ok((
        [(
            axum::http::header::CONTENT_TYPE,
            HeaderValue::from_static(mime),
        )],
        bytes,
    ))
}

fn decode_avatar_data_url(input: &str) -> AppResult<(&'static str, Vec<u8>)> {
    let trimmed = input.trim();
    let (meta, encoded) = trimmed
        .split_once(";base64,")
        .ok_or_else(|| AppError::BadRequest("invalid avatar data url".to_string()))?;
    let ext = match meta {
        "data:image/png" => "png",
        "data:image/jpeg" => "jpg",
        "data:image/jpg" => "jpg",
        "data:image/webp" => "webp",
        _ => {
            return Err(AppError::BadRequest(
                "avatar image type must be png/jpeg/webp".to_string(),
            ));
        }
    };
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| AppError::BadRequest("invalid avatar base64".to_string()))?;
    if bytes.is_empty() {
        return Err(AppError::BadRequest("avatar image is empty".to_string()));
    }
    Ok((ext, bytes))
}

fn matches_magic(ext: &str, bytes: &[u8]) -> bool {
    match ext {
        "png" => bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]),
        "jpg" => bytes.len() >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF,
        "webp" => bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
        _ => false,
    }
}

fn transcode_to_webp_square(ext: &str, bytes: &[u8]) -> AppResult<Vec<u8>> {
    let format = match ext {
        "png" => ImageFormat::Png,
        "jpg" => ImageFormat::Jpeg,
        "webp" => ImageFormat::WebP,
        _ => {
            return Err(AppError::BadRequest(
                "unsupported avatar image format".to_string(),
            ));
        }
    };
    let decoded = image::load_from_memory_with_format(bytes, format)
        .map_err(|_| AppError::BadRequest("failed to decode avatar image".to_string()))?;
    let (w, h) = decoded.dimensions();
    if (w as u64).saturating_mul(h as u64) > AVATAR_MAX_PIXELS {
        return Err(AppError::BadRequest(
            "avatar resolution is too large".to_string(),
        ));
    }

    let resized = decoded
        .resize_to_fill(
            AVATAR_TARGET_SIZE,
            AVATAR_TARGET_SIZE,
            image::imageops::FilterType::Lanczos3,
        )
        .to_rgba8();
    let (rw, rh) = resized.dimensions();
    let mut out = Vec::new();
    image::codecs::webp::WebPEncoder::new_lossless(&mut out)
        .encode(resized.as_raw(), rw, rh, image::ExtendedColorType::Rgba8)
        .map_err(|_| AppError::BadRequest("failed to encode avatar image".to_string()))?;
    Ok(out)
}

fn avatar_dir(sqlite_path: &str) -> PathBuf {
    let base = StdPath::new(sqlite_path)
        .parent()
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| PathBuf::from("/opt/livekit/control-plane/data"));
    base.join("avatars")
}

async fn avatar_dir_total_bytes(dir: &StdPath) -> AppResult<u64> {
    let mut total = 0_u64;
    let mut rd = fs::read_dir(dir)
        .await
        .map_err(|e| AppError::Io(std::io::Error::new(e.kind(), e.to_string())))?;
    while let Some(entry) = rd
        .next_entry()
        .await
        .map_err(|e| AppError::Io(std::io::Error::new(e.kind(), e.to_string())))?
    {
        let meta = entry
            .metadata()
            .await
            .map_err(|e| AppError::Io(std::io::Error::new(e.kind(), e.to_string())))?;
        if meta.is_file() {
            total = total.saturating_add(meta.len());
        }
    }
    Ok(total)
}

fn avatar_file_name_from_url(url: &str) -> Option<&str> {
    for marker in ["/api/avatars/", "/avatars/"] {
        if let Some(idx) = url.find(marker) {
            let name = &url[idx + marker.len()..];
            if is_safe_file_name(name) {
                return Some(name);
            }
        }
    }
    None
}

fn is_safe_file_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
        && !name.contains("..")
}

fn content_type_from_ext(file_name: &str) -> Option<&'static str> {
    let ext = file_name.rsplit('.').next()?.to_ascii_lowercase();
    match ext.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

fn bearer_from_headers(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
}

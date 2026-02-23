use crate::error::{AppError, AppResult};

const ROOM_ID_MIN: usize = 3;
const ROOM_ID_MAX: usize = 64;
const USER_NAME_MIN: usize = 2;
const USER_NAME_MAX: usize = 32;
const NICKNAME_MIN: usize = 2;
const NICKNAME_MAX: usize = 32;
const MESSAGE_MAX: usize = 500;
const AVATAR_URL_MAX: usize = 512;

pub fn room_id(input: &str) -> AppResult<String> {
    let v = input.trim();
    let len = v.chars().count();
    if !(ROOM_ID_MIN..=ROOM_ID_MAX).contains(&len) {
        return Err(AppError::BadRequest(
            "room_id must be 3-64 chars".to_string(),
        ));
    }
    if !v
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(AppError::BadRequest(
            "room_id only allows [a-zA-Z0-9_-]".to_string(),
        ));
    }
    Ok(v.to_string())
}

pub fn user_name(input: &str) -> AppResult<String> {
    let v = input.trim();
    let len = v.chars().count();
    if !(USER_NAME_MIN..=USER_NAME_MAX).contains(&len) {
        return Err(AppError::BadRequest(
            "user_name must be 2-32 chars".to_string(),
        ));
    }
    if !v
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(AppError::BadRequest(
            "user_name only allows [a-zA-Z0-9_-]".to_string(),
        ));
    }
    Ok(v.to_string())
}

pub fn nickname(input: &str) -> AppResult<String> {
    let v = input.trim();
    let len = v.chars().count();
    if !(NICKNAME_MIN..=NICKNAME_MAX).contains(&len) {
        return Err(AppError::BadRequest(
            "nickname must be 2-32 chars".to_string(),
        ));
    }
    Ok(v.to_string())
}

pub fn message_text(input: &str) -> AppResult<String> {
    let v = input.trim();
    let len = v.chars().count();
    if len == 0 {
        return Err(AppError::BadRequest("text is required".to_string()));
    }
    if len > MESSAGE_MAX {
        return Err(AppError::BadRequest("text max length is 500".to_string()));
    }
    Ok(v.to_string())
}

pub fn avatar_url(input: Option<String>) -> AppResult<Option<String>> {
    let Some(raw) = input else {
        return Ok(None);
    };
    let v = raw.trim();
    if v.is_empty() {
        return Ok(None);
    }
    if v.len() > AVATAR_URL_MAX {
        return Err(AppError::BadRequest(
            "avatar_url max length is 512".to_string(),
        ));
    }
    if !v.starts_with("https://") && !v.starts_with("/api/avatars/") && !v.starts_with("/avatars/")
    {
        return Err(AppError::BadRequest(
            "avatar_url must use https://, /api/avatars/, or /avatars/".to_string(),
        ));
    }
    Ok(Some(v.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn room_id_rules() {
        assert!(room_id("abc_123").is_ok());
        assert!(room_id("ab").is_err());
        assert!(room_id("bad room").is_err());
    }

    #[test]
    fn nickname_and_text_rules() {
        assert!(nickname("Alice").is_ok());
        assert!(nickname("a").is_err());
        assert!(message_text("hello").is_ok());
        assert!(message_text("").is_err());
        assert!(message_text(&"a".repeat(501)).is_err());
    }

    #[test]
    fn avatar_rules() {
        assert_eq!(avatar_url(None).unwrap(), None);
        assert!(avatar_url(Some("https://x.y/a.png".to_string())).is_ok());
        assert!(avatar_url(Some("/api/avatars/a.webp".to_string())).is_ok());
        assert!(avatar_url(Some("/avatars/a.webp".to_string())).is_ok());
        assert!(avatar_url(Some("http://x.y".to_string())).is_err());
    }
}

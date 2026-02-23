export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";
export const REQUIRE_INVITE = String(import.meta.env.VITE_REQUIRE_INVITE ?? "false") === "true";
export const DEFAULT_ROOM_ID = import.meta.env.VITE_DEFAULT_ROOM_ID ?? "test";
export const DEFAULT_USER_NAME = import.meta.env.VITE_DEFAULT_USER_NAME ?? "guest_01";
export const DEFAULT_ROLE = (import.meta.env.VITE_DEFAULT_ROLE ?? "member") as "host" | "member";
export const LOG_MAX_LINES = Number(import.meta.env.VITE_LOG_MAX_LINES ?? "250");
export const CHAT_HISTORY_LIMIT = Number(import.meta.env.VITE_CHAT_HISTORY_LIMIT ?? "80");
export const SESSION_REFRESH_POLL_MS = Number(import.meta.env.VITE_SESSION_REFRESH_POLL_MS ?? "30000");
export const SESSION_REFRESH_BEFORE_SECONDS = Number(
  import.meta.env.VITE_SESSION_REFRESH_BEFORE_SECONDS ?? "120",
);
export const INVITE_COPY_HINT_MS = Number(import.meta.env.VITE_INVITE_COPY_HINT_MS ?? "1800");
export const AVATAR_MAX_BYTES = Number(import.meta.env.VITE_AVATAR_MAX_BYTES ?? `${2 * 1024 * 1024}`);

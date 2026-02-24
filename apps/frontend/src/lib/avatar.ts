import { API_BASE_URL } from "./env";

export const AVATAR_CACHE_PREFIX = "ivena.meet.avatar.";

export function avatarCacheKey(userName: string): string {
  return `${AVATAR_CACHE_PREFIX}${userName.trim().toLowerCase()}`;
}

export function loadCachedAvatar(userName: string): string {
  const key = avatarCacheKey(userName);
  if (!key || key === AVATAR_CACHE_PREFIX) return "";
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function saveCachedAvatar(userName: string, avatarUrl: string): void {
  const name = userName.trim();
  const url = avatarUrl.trim();
  if (!name || !url) return;
  try {
    localStorage.setItem(avatarCacheKey(name), url);
  } catch {
    // Ignore storage quota/privacy mode failures.
  }
}

export function clearCachedAvatar(userName: string): void {
  const name = userName.trim();
  if (!name) return;
  try {
    localStorage.removeItem(avatarCacheKey(name));
  } catch {
    // Ignore storage quota/privacy mode failures.
  }
}

export function resolveMessageAvatar(
  avatarUrl: string | null | undefined,
  userName: string,
): string {
  const direct = avatarUrl?.trim() ?? "";
  if (direct) return direct;
  return loadCachedAvatar(userName);
}

export function resolveAvatarSrc(raw: string | null | undefined): string {
  if (!raw) return "";
  const normalized = raw.startsWith("/avatars/") ? `/api${raw}` : raw;
  if (
    normalized.startsWith("http://") ||
    normalized.startsWith("https://") ||
    normalized.startsWith("data:")
  ) {
    return normalized;
  }
  const base = API_BASE_URL.replace(/\/+$/, "");
  if (normalized.startsWith("/api/")) {
    if (base.startsWith("http://") || base.startsWith("https://")) {
      if (base.endsWith("/api")) return `${base}${normalized.slice(4)}`;
      return `${base}${normalized}`;
    }
    return normalized;
  }
  if (normalized.startsWith("/")) {
    if (base.startsWith("http://") || base.startsWith("https://")) {
      return `${base}${normalized}`;
    }
    return normalized;
  }
  if (base.startsWith("http://") || base.startsWith("https://")) {
    return `${base}/${normalized.replace(/^\/+/, "")}`;
  }
  return normalized;
}

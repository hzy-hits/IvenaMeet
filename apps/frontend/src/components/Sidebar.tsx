import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleStop,
  Copy,
  Image,
  ImagePlus,
  LogOut,
  MessageCircle,
  Mic,
  MicOff,
  ShieldCheck,
  SlidersHorizontal,
  Radio,
  Send,
  Terminal,
  Ticket,
  Users,
  UserPlus,
} from "lucide-react";
import {
  API_BASE_URL,
  AVATAR_MAX_BYTES,
  CHAT_HISTORY_LIMIT,
  INVITE_COPY_HINT_MS,
  SESSION_HEARTBEAT_MS,
  SESSION_REFRESH_BEFORE_SECONDS,
  SESSION_REFRESH_POLL_MS,
} from "../lib/env";
import type { JoinResp, MemberItem, MessageItem, RealtimeChatPayload, Role } from "../lib/types";

type ApiClient = ReturnType<typeof import("../lib/api").createApi>;

type Props = {
  requireInvite: boolean;
  api: ApiClient;
  roomId: string;
  setRoomId: (v: string) => void;
  userName: string;
  setUserName: (v: string) => void;
  role: Role;
  setRole: (v: Role) => void;
  joined: JoinResp | null;
  appSessionToken: string;
  setJoined: (v: JoinResp | null) => void;
  setAppSessionToken: (v: string) => void;
  setHostSessionToken: (v: string) => void;
  members: MemberItem[];
  messages: MessageItem[];
  setMessages: Dispatch<SetStateAction<MessageItem[]>>;
  lastRealtimeChat: RealtimeChatPayload | null;
  realtimeChatSender: ((payload: RealtimeChatPayload) => Promise<void>) | null;
  logs: string[];
  pushLog: (s: string) => void;
  chatPriorityMode?: boolean;
  hideDesktopChat?: boolean;
};

const LS_KEYS = {
  joined: "ivena.meet.joined",
  appSessionToken: "ivena.meet.app_session_token",
  hostSessionToken: "ivena.meet.host_session_token",
} as const;
const AVATAR_CACHE_PREFIX = "ivena.meet.avatar.";

function avatarCacheKey(userName: string): string {
  return `${AVATAR_CACHE_PREFIX}${userName.trim().toLowerCase()}`;
}

function loadCachedAvatar(userName: string): string {
  const key = avatarCacheKey(userName);
  if (!key || key === AVATAR_CACHE_PREFIX) return "";
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function saveCachedAvatar(userName: string, avatarUrl: string): void {
  const name = userName.trim();
  const url = avatarUrl.trim();
  if (!name || !url) return;
  try {
    localStorage.setItem(avatarCacheKey(name), url);
  } catch {
    // Ignore storage quota/privacy mode failures.
  }
}

function parseInviteFromQuery() {
  const q = new URLSearchParams(window.location.search);
  return {
    room: q.get("room") ?? "",
    ticket: q.get("ticket") ?? "",
  };
}

function resolveAvatarSrc(raw: string | null | undefined): string {
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("data:")) {
    return raw;
  }
  const base = API_BASE_URL.replace(/\/+$/, "");
  if (raw.startsWith("/api/")) {
    if (base.startsWith("http://") || base.startsWith("https://")) {
      // If base already includes /api, avoid duplicating it; otherwise keep raw path intact.
      if (base.endsWith("/api")) return `${base}${raw.slice(4)}`;
      return `${base}${raw}`;
    }
    return raw;
  }
  if (raw.startsWith("/")) {
    if (base.startsWith("http://") || base.startsWith("https://")) {
      return `${base}${raw}`;
    }
    return raw;
  }
  if (base.startsWith("http://") || base.startsWith("https://")) {
    return `${base}/${raw.replace(/^\/+/, "")}`;
  }
  return raw;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("file read error"));
    reader.readAsDataURL(file);
  });
}

function deriveWhipUrl(whipUrl: string, lkUrl?: string): string {
  const direct = whipUrl.trim();
  if (direct) return direct;
  const base = (lkUrl ?? "").trim().replace(/\/+$/, "");
  if (base.startsWith("wss://")) return `https://${base.slice(6)}/w/`;
  if (base.startsWith("ws://")) return `http://${base.slice(5)}/w/`;
  return "";
}

function deriveObsWhipEndpoint(whipUrl: string, streamKey: string): string {
  const base = whipUrl.trim().replace(/\/+$/, "");
  const key = streamKey.trim();
  if (!base || !key) return "";
  return `${base}/${key}`;
}

function createClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

function isIdentityInUseError(message: string): boolean {
  return message.toLowerCase().includes("identity already in use");
}

function normalizeMessage(message: MessageItem): MessageItem {
  return {
    ...message,
    pending: message.pending ?? false,
    failed: message.failed ?? false,
  };
}

function mergeMessages(base: MessageItem[], incoming: MessageItem[]): MessageItem[] {
  if (!incoming.length) return base;
  const next = [...base];
  const byId = new Map<number, number>();
  const byClientId = new Map<string, number>();
  for (let i = 0; i < next.length; i += 1) {
    byId.set(next[i].id, i);
    const existingClientId = next[i].client_id ?? "";
    if (existingClientId) byClientId.set(existingClientId, i);
  }

  let changed = false;
  for (const item of incoming) {
    const normalized = normalizeMessage(item);
    const incomingClientId = normalized.client_id ?? "";
    const idxByClient = incomingClientId ? byClientId.get(incomingClientId) : undefined;
    const idxById = byId.get(normalized.id);
    const targetIdx = idxByClient ?? idxById;
    if (targetIdx === undefined) {
      next.push(normalized);
      const newIdx = next.length - 1;
      byId.set(normalized.id, newIdx);
      if (incomingClientId) byClientId.set(incomingClientId, newIdx);
      changed = true;
      continue;
    }

    const prev = next[targetIdx];
    const merged: MessageItem = {
      ...prev,
      ...normalized,
      pending: normalized.pending ?? false,
      failed: normalized.failed ?? false,
    };
    if (JSON.stringify(prev) !== JSON.stringify(merged)) {
      next[targetIdx] = merged;
      byId.set(merged.id, targetIdx);
      const mergedClientId = merged.client_id ?? "";
      if (mergedClientId) byClientId.set(mergedClientId, targetIdx);
      changed = true;
    }
  }
  if (!changed) return base;
  return next.sort((a, b) => {
    if (a.created_at !== b.created_at) return a.created_at - b.created_at;
    if (a.id === b.id) return 0;
    if (a.id < 0 && b.id > 0) return -1;
    if (a.id > 0 && b.id < 0) return 1;
    return a.id - b.id;
  });
}

function markMessageFailed(base: MessageItem[], clientId: string): MessageItem[] {
  let changed = false;
  const out = base.map((m) => {
    if (m.client_id !== clientId) return m;
    changed = true;
    return { ...m, pending: false, failed: true };
  });
  return changed ? out : base;
}

function toRealtimeMessage(payload: RealtimeChatPayload): MessageItem {
  const syntheticId = -Math.floor(Date.now() * 1000 + Math.random() * 1000);
  return {
    id: syntheticId,
    room_id: payload.room_id,
    user_name: payload.user_name,
    nickname: payload.nickname,
    avatar_url: payload.avatar_url ?? null,
    role: payload.role,
    client_id: payload.client_id,
    text: payload.text,
    created_at: payload.created_at,
    pending: true,
    failed: false,
  };
}

function formatChatTime(epochSeconds: number): string {
  if (!epochSeconds) return "";
  return new Date(epochSeconds * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function messageTailKey(items: MessageItem[]): string {
  if (!items.length) return "empty";
  const m = items[items.length - 1];
  return `${m.id}:${m.client_id ?? ""}:${m.created_at}:${m.pending ? "1" : "0"}:${m.failed ? "1" : "0"}`;
}

export function Sidebar(props: Props) {
  const {
    requireInvite,
    api,
    roomId,
    setRoomId,
    userName,
    setUserName,
    role,
    setRole,
    joined,
    appSessionToken,
    setJoined,
    setAppSessionToken,
    setHostSessionToken,
    members,
    messages,
    setMessages,
    lastRealtimeChat,
    realtimeChatSender,
    logs,
    pushLog,
    chatPriorityMode = false,
    hideDesktopChat = false,
  } = props;

  const [inviteCode, setInviteCode] = useState("");
  const [inviteTicket, setInviteTicket] = useState("");
  const [redeemToken, setRedeemToken] = useState("");
  const [hostTotpCode, setHostTotpCode] = useState("");
  const [chatText, setChatText] = useState("");
  const [inviteCopied, setInviteCopied] = useState(false);
  const [sessionExpireAt, setSessionExpireAt] = useState(0);
  const [hostSessionExpireAt, setHostSessionExpireAt] = useState(0);
  const [ingressId, setIngressId] = useState("");
  const [whipUrl, setWhipUrl] = useState("");
  const [streamKey, setStreamKey] = useState("");
  const [showBroadcastModal, setShowBroadcastModal] = useState(false);
  const [joining, setJoining] = useState(false);
  const [reclaiming, setReclaiming] = useState(false);
  const [showReclaimCta, setShowReclaimCta] = useState(false);
  const [actionNotice, setActionNotice] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);

  const [openMembers, setOpenMembers] = useState(true);
  const [openChat, setOpenChat] = useState(true);
  const [openLogs, setOpenLogs] = useState(false);
  const [consolePane, setConsolePane] = useState<"control" | "members" | "ops">("control");
  const [hostEntryUnlocked, setHostEntryUnlocked] = useState(false);

  const [avatarPreview, setAvatarPreview] = useState<string>(() => loadCachedAvatar(userName));
  const avatarUploadDataRef = useRef<string>("");
  const avatarPreviewBlobRef = useRef<string>("");
  const [avatarStatus, setAvatarStatus] = useState<{
    kind: "idle" | "ok" | "error";
    text: string;
  }>({ kind: "idle", text: "未上传，使用默认头像" });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatAutoScrollRef = useRef(true);
  const lastChatTailKeyRef = useRef("empty");
  const initialReconnectChecked = useRef(false);
  const lastMessageIdRef = useRef(0);
  const historySyncErrorLoggedRef = useRef(false);
  const heartbeatErrorLoggedRef = useRef(false);
  const [pendingChatHints, setPendingChatHints] = useState(0);
  const shouldReconnectOnBoot = useRef(
    Boolean(localStorage.getItem(LS_KEYS.joined) && localStorage.getItem(LS_KEYS.appSessionToken)),
  );
  const lastChatPriorityModeRef = useRef(chatPriorityMode);
  const inviteMode = Boolean(inviteTicket);
  const effectiveRole: Role = hostEntryUnlocked ? "host" : inviteMode ? "member" : role;
  const showInviteGate = !joined && !inviteMode && !hostEntryUnlocked;
  const isHost = useMemo(
    () => (joined?.role ?? effectiveRole) === "host",
    [joined?.role, effectiveRole],
  );
  const obsWhipEndpoint = useMemo(
    () => deriveObsWhipEndpoint(whipUrl, streamKey),
    [whipUrl, streamKey],
  );

  const showActionNotice = (kind: "ok" | "error", text: string) => {
    setActionNotice({ kind, text });
    window.setTimeout(() => setActionNotice(null), 2600);
  };

  useEffect(() => {
    if (effectiveRole !== "host" && showReclaimCta) {
      setShowReclaimCta(false);
    }
  }, [effectiveRole, showReclaimCta]);

  useEffect(() => {
    const was = lastChatPriorityModeRef.current;
    if (chatPriorityMode && !was) {
      setOpenChat(true);
      setOpenMembers(false);
      setOpenLogs(false);
    }
    lastChatPriorityModeRef.current = chatPriorityMode;
  }, [chatPriorityMode]);

  useEffect(() => {
    if (consolePane === "members") setOpenMembers(true);
    if (consolePane === "ops") setOpenLogs(true);
  }, [consolePane]);

  useEffect(() => {
    return () => {
      if (avatarPreviewBlobRef.current) {
        URL.revokeObjectURL(avatarPreviewBlobRef.current);
        avatarPreviewBlobRef.current = "";
      }
    };
  }, []);

  useEffect(() => {
    if (avatarPreviewBlobRef.current) return;
    setAvatarPreview(loadCachedAvatar(userName));
  }, [userName]);

  useEffect(() => {
    const parsed = parseInviteFromQuery();
    if (parsed.room) setRoomId(parsed.room);
    if (parsed.ticket) {
      setInviteTicket(parsed.ticket);
      setRole("member");
      setHostEntryUnlocked(false);
    }
  }, [setRoomId, setRole]);

  useEffect(() => {
    if (!joined) return;
    api
      .listMessages(roomId, CHAT_HISTORY_LIMIT)
      .then((res) => setMessages(res.items))
      .catch((e) => pushLog(`history error: ${String(e)}`));
  }, [joined, roomId, api, setMessages, pushLog]);

  useEffect(() => {
    const name = userName.trim();
    if (!name) return;
    const latestAvatar = [...messages]
      .reverse()
      .find((m) => m.user_name === name && !!m.avatar_url)?.avatar_url;
    if (!latestAvatar) return;
    saveCachedAvatar(name, latestAvatar);
    if (!avatarPreviewBlobRef.current && avatarPreview !== latestAvatar) {
      setAvatarPreview(latestAvatar);
    }
  }, [messages, userName, avatarPreview]);

  useEffect(() => {
    let maxId = 0;
    for (const item of messages) {
      if (item.id > maxId) maxId = item.id;
    }
    lastMessageIdRef.current = maxId;
  }, [messages]);

  useEffect(() => {
    if (!openChat) return;
    const box = chatScrollRef.current;
    if (!box) return;

    const nextTail = messageTailKey(messages);
    if (nextTail === lastChatTailKeyRef.current) return;
    lastChatTailKeyRef.current = nextTail;

    const distanceToBottom = box.scrollHeight - box.scrollTop - box.clientHeight;
    const isNearBottom = distanceToBottom <= 56;

    if (chatAutoScrollRef.current || isNearBottom) {
      const doScroll = () => {
        const target = chatScrollRef.current;
        if (!target) return;
        target.scrollTo({ top: target.scrollHeight, behavior: "smooth" });
      };
      if (typeof window !== "undefined" && "requestAnimationFrame" in window) {
        window.requestAnimationFrame(doScroll);
      } else {
        doScroll();
      }
      chatAutoScrollRef.current = true;
      setPendingChatHints(0);
      return;
    }

    setPendingChatHints((n) => Math.min(n + 1, 99));
  }, [messages, openChat]);

  const scrollChatToBottom = (behavior: ScrollBehavior = "smooth") => {
    const box = chatScrollRef.current;
    if (!box) return;
    box.scrollTo({ top: box.scrollHeight, behavior });
    chatAutoScrollRef.current = true;
    setPendingChatHints(0);
  };

  const onChatScroll = () => {
    const box = chatScrollRef.current;
    if (!box) return;
    const distanceToBottom = box.scrollHeight - box.scrollTop - box.clientHeight;
    const isNearBottom = distanceToBottom <= 56;
    chatAutoScrollRef.current = isNearBottom;
    if (isNearBottom && pendingChatHints) {
      setPendingChatHints(0);
    }
  };

  useEffect(() => {
    if (!openChat) return;
    if (!joined) return;
    scrollChatToBottom("auto");
  }, [openChat, joined, roomId]);

  useEffect(() => {
    if (!joined || !appSessionToken) return;
    let stopped = false;
    let closeStream: (() => void) | null = null;
    let retryDelayMs = 1000;

    const connect = () => {
      if (stopped) return;
      const afterId = lastMessageIdRef.current > 0 ? lastMessageIdRef.current : undefined;
      closeStream = api.streamMessages(
        roomId,
        afterId,
        (item) => {
          historySyncErrorLoggedRef.current = false;
          setMessages((prev) => mergeMessages(prev, [{ ...item, pending: false, failed: false }]));
        },
        (error) => {
          if (stopped) return;
          if (!historySyncErrorLoggedRef.current) {
            historySyncErrorLoggedRef.current = true;
            pushLog(`chat stream error: ${error.message}`);
          }
          if (closeStream) {
            closeStream();
            closeStream = null;
          }
          window.setTimeout(connect, retryDelayMs);
          retryDelayMs = Math.min(retryDelayMs * 2, 10000);
        },
      );
    };

    connect();
    return () => {
      stopped = true;
      if (closeStream) closeStream();
    };
  }, [joined, appSessionToken, roomId, api, setMessages, pushLog]);

  useEffect(() => {
    if (!joined || !lastRealtimeChat) return;
    if (lastRealtimeChat.room_id !== roomId.trim()) return;
    setMessages((prev) => mergeMessages(prev, [toRealtimeMessage(lastRealtimeChat)]));
  }, [joined, lastRealtimeChat, roomId, setMessages]);

  useEffect(() => {
    if (initialReconnectChecked.current) return;
    if (!shouldReconnectOnBoot.current) {
      initialReconnectChecked.current = true;
      return;
    }
    if (!joined) return;
    initialReconnectChecked.current = true;
    const restored = joined;
    // Avoid duplicate room connect with stale token before reconnect returns.
    setJoined(null);

    void api
      .reconnectRoom()
      .then((res) => {
        setJoined({ ...restored, ...res });
        pushLog("session restored after refresh");
      })
      .catch((e) => {
        setJoined(null);
        setAppSessionToken("");
        setHostSessionToken("");
        setHostSessionExpireAt(0);
        setSessionExpireAt(0);
        setMessages([]);
        localStorage.removeItem(LS_KEYS.joined);
        localStorage.removeItem(LS_KEYS.appSessionToken);
        localStorage.removeItem(LS_KEYS.hostSessionToken);
        pushLog(`session restore failed: ${String(e)}`);
        showActionNotice("error", "会话已失效，请重新加入房间");
      });
  }, [joined, api, setJoined, setAppSessionToken, setHostSessionToken, setMessages, pushLog]);

  useEffect(() => {
    if (!joined || !sessionExpireAt) return;
    const timer = window.setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      if (now >= sessionExpireAt - SESSION_REFRESH_BEFORE_SECONDS) {
        void api
          .refreshSession()
          .then((res) => {
            setAppSessionToken(res.app_session_token);
            setSessionExpireAt(now + res.app_session_expires_in_seconds);
            pushLog("app session refreshed");
          })
          .catch((e) => pushLog(`session refresh failed: ${String(e)}`));
      }
    }, SESSION_REFRESH_POLL_MS);
    return () => window.clearInterval(timer);
  }, [joined, sessionExpireAt, api, setAppSessionToken, pushLog]);

  useEffect(() => {
    if (!joined || !appSessionToken) return;
    const timer = window.setInterval(() => {
      void api
        .heartbeatSession()
        .then(() => {
          heartbeatErrorLoggedRef.current = false;
        })
        .catch((e) => {
          if (heartbeatErrorLoggedRef.current) return;
          heartbeatErrorLoggedRef.current = true;
          pushLog(`session heartbeat failed: ${errorText(e)}`);
        });
    }, SESSION_HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [joined, appSessionToken, api, pushLog]);

  useEffect(() => {
    if (!joined || !isHost || !hostSessionExpireAt) return;
    const timer = window.setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      if (now >= hostSessionExpireAt - SESSION_REFRESH_BEFORE_SECONDS) {
        void api
          .refreshHostSession()
          .then((res) => {
            setHostSessionToken(res.host_session_token);
            setHostSessionExpireAt(now + res.expires_in_seconds);
            pushLog("host session refreshed");
          })
          .catch((e) => {
            setJoined(null);
            setAppSessionToken("");
            setHostSessionToken("");
            setHostSessionExpireAt(0);
            setHostTotpCode("");
            setMessages([]);
            pushLog(`host session refresh failed: ${String(e)}`);
            pushLog("主持权限已过期，请重新输入 TOTP");
          });
      }
    }, SESSION_REFRESH_POLL_MS);
    return () => window.clearInterval(timer);
  }, [joined, isHost, hostSessionExpireAt, api, setAppSessionToken, setHostSessionToken, setJoined, setMessages, pushLog]);

  const leaveRoom = async () => {
    const shouldNotifyLeave = Boolean(joined && appSessionToken);
    if (shouldNotifyLeave) {
      try {
        const res = await api.leaveRoom();
        pushLog(res.released ? "left room (presence released)" : "left room (presence already cleared)");
      } catch (e) {
        pushLog(`leave notify failed: ${String(e)}`);
      }
    }

    setJoined(null);
    setAppSessionToken("");
    setHostSessionToken("");
    setHostTotpCode("");
    setHostSessionExpireAt(0);
    setSessionExpireAt(0);
    setShowReclaimCta(false);
    setPendingChatHints(0);
    chatAutoScrollRef.current = true;
    lastChatTailKeyRef.current = "empty";
    avatarUploadDataRef.current = "";
    if (avatarPreviewBlobRef.current) {
      URL.revokeObjectURL(avatarPreviewBlobRef.current);
      avatarPreviewBlobRef.current = "";
    }
    setMessages([]);
    localStorage.removeItem(LS_KEYS.joined);
    localStorage.removeItem(LS_KEYS.appSessionToken);
    localStorage.removeItem(LS_KEYS.hostSessionToken);
    pushLog("left room");
  };

  const joinRoom = async (options?: { skipAutoReclaim?: boolean }) => {
    if (joining) return;
    if (!userName.trim()) throw new Error("name is required");

    setJoining(true);
    try {
      if (joined) {
        await leaveRoom();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      let token = redeemToken.trim();
      let joinAuthToken: string | undefined;
      if ((requireInvite || inviteMode) && effectiveRole === "member" && !token) {
        if (!inviteCode.trim() || !inviteTicket.trim()) {
          throw new Error("invite_code and invite_ticket required");
        }
        const redeem = await api.redeemInvite({
          room_id: roomId.trim(),
          user_name: userName.trim(),
          invite_code: inviteCode.trim(),
          invite_ticket: inviteTicket.trim(),
        });
        token = redeem.redeem_token;
        setRedeemToken(token);
        pushLog("invite redeemed");
      }
      if (effectiveRole === "host") {
        const verified = await api.loginHostWithTotp({
          room_id: roomId.trim(),
          host_identity: userName.trim(),
          totp_code: hostTotpCode.trim(),
        });
        setHostSessionToken(verified.host_session_token);
        setHostSessionExpireAt(Math.floor(Date.now() / 1000) + verified.expires_in_seconds);
        joinAuthToken = verified.host_session_token;
        pushLog("host login verified");
      }

      let res: JoinResp;
      try {
        res = await api.join({
          room_id: roomId.trim(),
          user_name: userName.trim(),
          role: effectiveRole,
          nickname: userName.trim(),
          redeem_token: token || undefined,
        }, joinAuthToken);
      } catch (e) {
        const message = errorText(e);
        const shouldAutoReclaim =
          effectiveRole === "host" &&
          !options?.skipAutoReclaim &&
          isIdentityInUseError(message);
        if (!shouldAutoReclaim) {
          throw e;
        }
        const reclaimed = await api.forceReclaimHostLock(
          {
            room_id: roomId.trim(),
            host_identity: userName.trim(),
          },
          joinAuthToken,
        );
        pushLog(
          `host reclaim(auto): ${reclaimed.reason} (stale_age=${reclaimed.stale_age_seconds}s)`,
        );
        res = await api.join({
          room_id: roomId.trim(),
          user_name: userName.trim(),
          role: effectiveRole,
          nickname: userName.trim(),
          redeem_token: token || undefined,
        }, joinAuthToken);
      }

      setJoined(res);
      setShowReclaimCta(false);
      setAppSessionToken(res.app_session_token);
      setHostSessionToken(res.host_session_token ?? "");
      if (res.host_session_token && res.host_session_expires_in_seconds) {
        setHostSessionExpireAt(Math.floor(Date.now() / 1000) + res.host_session_expires_in_seconds);
      }
      setSessionExpireAt(Math.floor(Date.now() / 1000) + res.app_session_expires_in_seconds);
      pushLog(`joined: ${userName} (${res.role})`);
      if (avatarUploadDataRef.current) {
        try {
          const uploaded = await api.uploadAvatar(avatarUploadDataRef.current, res.app_session_token);
          setAvatarStatus({ kind: "ok", text: "头像上传成功" });
          setAvatarPreview(uploaded.avatar_url);
          saveCachedAvatar(userName.trim(), uploaded.avatar_url);
          avatarUploadDataRef.current = "";
          if (avatarPreviewBlobRef.current) {
            URL.revokeObjectURL(avatarPreviewBlobRef.current);
            avatarPreviewBlobRef.current = "";
          }
          setMessages((prev) =>
            prev.map((m) =>
              m.user_name === userName.trim() ? { ...m, avatar_url: uploaded.avatar_url } : m,
            ),
          );
          pushLog(`avatar uploaded: ${uploaded.avatar_url}`);
        } catch (e) {
          setAvatarStatus({ kind: "error", text: "头像上传失败，已使用默认头像" });
          pushLog(`avatar upload failed: ${String(e)}`);
        }
      }
    } catch (e) {
      const message = errorText(e);
      if (effectiveRole === "host" && isIdentityInUseError(message)) {
        setShowReclaimCta(true);
        showActionNotice("error", "主持身份被占用，可一键回收后重试");
        pushLog("host identity occupied; use force reclaim and retry");
      }
      throw e;
    } finally {
      setJoining(false);
    }
  };

  const forceReclaimAndRetry = async () => {
    if (reclaiming) return;
    setReclaiming(true);
    try {
      const reclaimed = await api.forceReclaimHostLock({
        room_id: roomId.trim(),
        host_identity: userName.trim(),
      });
      pushLog(
        `host reclaim: ${reclaimed.reason} (stale_age=${reclaimed.stale_age_seconds}s)`,
      );
      showActionNotice("ok", "已回收残留会话，正在重试");
      setShowReclaimCta(false);
      await joinRoom({ skipAutoReclaim: true });
    } finally {
      setReclaiming(false);
    }
  };

  const issueInvite = async () => {
    const payload = await api.issueInvite({
      room_id: roomId.trim(),
      host_identity: userName.trim(),
    });

    const expiresAt = new Date(payload.expires_at).toLocaleString();
    const msg = `房间链接：${payload.invite_url}\n邀请码：${payload.invite_code}\n可使用人数：${payload.invite_max_uses}\n有效期至：${expiresAt}`;
    await navigator.clipboard.writeText(msg);

    setInviteCode(payload.invite_code);
    setInviteTicket(payload.invite_ticket);
    setInviteCopied(true);
    window.setTimeout(() => setInviteCopied(false), INVITE_COPY_HINT_MS);
    const hostRoomUrl = `/?room=${encodeURIComponent(roomId.trim())}`;
    window.history.replaceState({}, "", hostRoomUrl);
    setRole("host");
    pushLog("invite issued and copied");
    pushLog(`switched to host room url: ${hostRoomUrl}`);
    showActionNotice("ok", "已复制微信群邀请文案");
  };

  const startBroadcast = async () => {
    const issue = await api.issueBroadcast({
      room_id: roomId.trim(),
      host_identity: userName.trim(),
    });

    const started = await api.startBroadcast({
      room_id: roomId.trim(),
      participant_identity: userName.trim(),
      participant_name: userName.trim(),
      start_token: issue.start_token,
    });

    setIngressId(started.ingress_id);
    setWhipUrl(deriveWhipUrl(started.whip_url, joined?.lk_url));
    setStreamKey(started.stream_key);
    setShowBroadcastModal(true);
    pushLog("broadcast started");
    pushLog("echo-safe tip: OBS 只推桌面+系统音，麦克风请走房间语音");
    showActionNotice("ok", "推流参数已生成");
  };

  const stopBroadcast = async () => {
    if (!ingressId.trim()) throw new Error("ingress_id required");
    await api.stopBroadcast({ ingress_id: ingressId.trim() });
    pushLog("broadcast stopped");
    showActionNotice("ok", "推流已停止");
  };

  const muteAll = async (muted: boolean) => {
    const res = await api.muteAll({
      room_id: roomId.trim(),
      host_identity: userName.trim(),
      muted,
    });
    pushLog(`${muted ? "mute all" : "unmute all"} applied (${res.affected_tracks})`);
    if (res.affected_tracks === 0) {
      showActionNotice(
        "error",
        muted
          ? "未命中可静音麦克风（可能成员未开麦或未发布麦克风）"
          : "未命中可解除的麦克风（可能当前都未被服务端静音）",
      );
    } else {
      showActionNotice("ok", `${muted ? "全员静音" : "解除全员静音"}已应用（${res.affected_tracks}）`);
    }
  };

  const muteOne = async (targetIdentity: string, muted: boolean) => {
    const res = await api.muteMember({
      room_id: roomId.trim(),
      host_identity: userName.trim(),
      target_identity: targetIdentity,
      muted,
    });
    pushLog(`${muted ? "mute" : "unmute"} ${targetIdentity} (${res.affected_tracks})`);
    if (res.affected_tracks === 0) {
      showActionNotice("error", `未命中 ${targetIdentity} 的麦克风轨道`);
    } else {
      showActionNotice(
        "ok",
        `${muted ? "已静音" : "已解除静音"} ${targetIdentity}（${res.affected_tracks}）`,
      );
    }
  };

  const sendChat = async () => {
    const text = chatText.trim();
    if (!text || !joined) return;
    chatAutoScrollRef.current = true;
    setPendingChatHints(0);
    const clientId = createClientId();
    const payload: RealtimeChatPayload = {
      type: "chat.message",
      room_id: roomId.trim(),
      client_id: clientId,
      user_name: userName.trim(),
      nickname: userName.trim(),
      avatar_url: null,
      role: joined.role,
      text,
      created_at: Math.floor(Date.now() / 1000),
    };

    setMessages((prev) => mergeMessages(prev, [toRealtimeMessage(payload)]));
    if (realtimeChatSender) {
      try {
        await realtimeChatSender(payload);
      } catch (e) {
        pushLog(`realtime send error: ${String(e)}`);
      }
    }

    try {
      const created = await api.createMessage(roomId.trim(), { text, client_id: clientId });
      setMessages((prev) =>
        mergeMessages(prev, [{ ...created, pending: false, failed: false }]),
      );
    } catch (e) {
      setMessages((prev) => markMessageFailed(prev, clientId));
      throw e;
    }
    setChatText("");
  };

  const onPickAvatar = () => fileInputRef.current?.click();

  const onAvatarFileChange = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setAvatarPreview(loadCachedAvatar(userName));
      avatarUploadDataRef.current = "";
      setAvatarStatus({ kind: "error", text: "上传失败：仅支持图片，已使用默认头像" });
      pushLog("avatar upload failed: only image files are allowed, using default avatar");
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setAvatarPreview(loadCachedAvatar(userName));
      avatarUploadDataRef.current = "";
      setAvatarStatus({ kind: "error", text: "上传失败：图片超过 2MB，已使用默认头像" });
      pushLog("avatar upload failed: file must be <= 2MB, using default avatar");
      return;
    }
    if (avatarPreviewBlobRef.current) {
      URL.revokeObjectURL(avatarPreviewBlobRef.current);
      avatarPreviewBlobRef.current = "";
    }
    const objectUrl = URL.createObjectURL(file);
    avatarPreviewBlobRef.current = objectUrl;
    setAvatarPreview(objectUrl);

    void fileToDataUrl(file)
      .then((data) => {
      if (!data.startsWith("data:image/")) {
        setAvatarPreview(loadCachedAvatar(userName));
        avatarUploadDataRef.current = "";
        setAvatarStatus({ kind: "error", text: "上传失败：图片编码异常，已使用默认头像" });
        pushLog("avatar upload failed: invalid data url");
        return;
      }
      avatarUploadDataRef.current = data;
      if (joined && appSessionToken) {
        void api
          .uploadAvatar(data, appSessionToken)
          .then(async (uploaded) => {
            setAvatarPreview(uploaded.avatar_url);
            saveCachedAvatar(userName.trim(), uploaded.avatar_url);
            avatarUploadDataRef.current = "";
            if (avatarPreviewBlobRef.current) {
              URL.revokeObjectURL(avatarPreviewBlobRef.current);
              avatarPreviewBlobRef.current = "";
            }
            setAvatarStatus({ kind: "ok", text: "头像上传成功" });
            setMessages((prev) =>
              prev.map((m) =>
                m.user_name === userName.trim() ? { ...m, avatar_url: uploaded.avatar_url } : m,
              ),
            );
            pushLog(`avatar uploaded: ${uploaded.avatar_url}`);
          })
          .catch((e) => {
            setAvatarStatus({ kind: "error", text: "头像上传失败，已使用默认头像" });
            pushLog(`avatar upload failed: ${String(e)}`);
          });
      } else {
        setAvatarStatus({ kind: "ok", text: "头像已选择，加入后自动上传" });
        pushLog("avatar selected");
      }
    })
      .catch(() => {
      setAvatarPreview(loadCachedAvatar(userName));
      avatarUploadDataRef.current = "";
      setAvatarStatus({ kind: "error", text: "上传失败：读取图片失败，已使用默认头像" });
      pushLog("avatar upload failed: file read error");
    });
  };

  const run = (fn: () => Promise<void>) => {
    void fn().catch((e) => {
      const message = errorText(e);
      pushLog(message);
      if (showReclaimCta && isIdentityInUseError(message)) {
        return;
      }
      showActionNotice("error", message);
    });
  };

  return (
    <>
      <aside className="flex h-full min-h-0 flex-col gap-3 overflow-x-hidden overflow-y-auto rounded-[26px] border border-white/10 bg-[linear-gradient(180deg,rgba(18,35,48,0.92),rgba(10,20,28,0.88))] p-3 shadow-[0_20px_70px_rgba(0,0,0,0.35)] backdrop-blur-md lg:p-4">
        <section className="rounded-2xl border border-white/10 bg-card/80 p-3 backdrop-blur-md">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">Command Center</h2>
              <p className="text-xs text-white/60">
                {joined ? `房间: ${roomId} · 身份: ${joined.role}` : "未加入房间"}
              </p>
            </div>
            {joined ? (
              <button
                onClick={() => run(leaveRoom)}
                className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm"
              >
                <LogOut size={16} /> Leave
              </button>
            ) : null}
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-black/25 p-2.5">
          <p className="px-1 text-[10px] uppercase tracking-[0.16em] text-white/45">Navigator</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setConsolePane("control")}
              className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs ${
                consolePane === "control"
                  ? "border border-accent/45 bg-accent/12 text-accent"
                  : "border border-white/10 bg-white/5 text-white/70"
              }`}
            >
              <SlidersHorizontal size={12} /> 控制
            </button>
            <button
              type="button"
              onClick={() => setConsolePane("members")}
              className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs ${
                consolePane === "members"
                  ? "border border-accent/45 bg-accent/12 text-accent"
                  : "border border-white/10 bg-white/5 text-white/70"
              }`}
            >
              <Users size={12} /> 成员
            </button>
            <button
              type="button"
              onClick={() => setConsolePane("ops")}
              className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs ${
                consolePane === "ops"
                  ? "border border-accent/45 bg-accent/12 text-accent"
                  : "border border-white/10 bg-white/5 text-white/70"
              }`}
            >
              <Terminal size={12} /> 系统
            </button>
          </div>
        </section>

        {joined && consolePane === "control" ? (
          <section className="rounded-2xl border border-white/10 bg-card/80 p-3 backdrop-blur-md">
            <h3 className="mb-2 text-sm font-semibold">Profile</h3>
            <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
              <div className="h-10 w-10 overflow-hidden rounded-full border border-white/20 bg-black/30">
                {avatarPreview ? (
                  <img src={avatarPreview} alt="avatar" className="h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full w-full place-items-center text-white/60">
                    <Image size={14} />
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={onPickAvatar}
                className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm"
              >
                <ImagePlus size={16} /> 上传头像
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => onAvatarFileChange(e.target.files?.[0])}
                className="hidden"
              />
            </div>
            <p
              className={`mt-2 font-mono text-[11px] ${
                avatarStatus.kind === "ok"
                  ? "text-ok"
                  : avatarStatus.kind === "error"
                    ? "text-red-300"
                    : "text-white/50"
              }`}
            >
              {avatarStatus.text}
            </p>
          </section>
        ) : null}

        {actionNotice ? (
          <section
            className={`rounded-2xl border px-3 py-2 text-sm ${
              actionNotice.kind === "ok"
                ? "border-ok/40 bg-ok/10 text-ok"
                : "border-red-300/40 bg-red-500/20 text-red-100"
            }`}
          >
            {actionNotice.text}
          </section>
        ) : null}

        {isHost && consolePane === "control" ? (
          <section className="rounded-2xl border border-white/10 bg-card/80 p-3 backdrop-blur-md">
            <h3 className="mb-2 text-sm font-semibold">主持工具</h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => run(issueInvite)}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm"
              >
                <UserPlus size={16} /> 复制邀请
              </button>
              <button
                onClick={() => run(startBroadcast)}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-[#06211f]"
              >
                <Radio size={16} /> Broadcast
              </button>
              <button
                onClick={() => run(stopBroadcast)}
                className="col-span-2 inline-flex items-center justify-center gap-2 rounded-xl bg-red-500/80 px-3 py-2 text-sm"
              >
                <CircleStop size={16} /> Stop Broadcast
              </button>
              <button
                onClick={() => run(() => muteAll(true))}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm"
              >
                全员静音
              </button>
              <button
                onClick={() => run(() => muteAll(false))}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm"
              >
                解除全员静音
              </button>
            </div>
            {inviteCopied ? (
              <div className="mt-2 inline-flex items-center gap-2 rounded-xl border border-ok/50 bg-ok/15 px-3 py-1 text-xs text-ok">
                <Copy size={14} /> 复制成功
              </div>
            ) : null}
          </section>
        ) : null}

        {consolePane === "members" ? (
        <section className="rounded-2xl border border-white/10 bg-card/80 p-3 backdrop-blur-md">
          <button
            onClick={() => setOpenMembers((v) => !v)}
            className="mb-2 flex w-full items-center justify-between text-left text-sm font-semibold"
          >
            <span>Members ({members.length})</span>
            {openMembers ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
          {openMembers ? (
            <div className="max-h-36 space-y-2 overflow-auto pr-1">
              {members.map((m) => (
                <div
                  key={m.identity}
                  className={`flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2 ${
                    m.speaking ? "ring-1 ring-ok shadow-[0_0_10px_#7edb8f]" : ""
                  }`}
                >
                  <span className="truncate text-sm">{m.identity}{m.isLocal ? " (me)" : ""}</span>
                  <div className="inline-flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-xs text-white/60">
                      {m.micEnabled ? <Mic size={12} /> : <MicOff size={12} />}
                      {m.speaking ? "speaking" : m.micEnabled ? "on" : "muted"}
                    </span>
                    {isHost && !m.isLocal ? (
                      <button
                        onClick={() => run(() => muteOne(m.identity, m.micEnabled))}
                        className="rounded-lg bg-white/10 px-2 py-1 text-[11px]"
                      >
                        {m.micEnabled ? "静音" : "解除"}
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </section>
        ) : null}

        <section className={`min-h-0 flex-1 space-y-3 ${hideDesktopChat ? "lg:flex-none" : ""}`}>
          <div
            className={`min-h-0 rounded-2xl border border-white/10 bg-card/80 p-3 backdrop-blur-md ${
              hideDesktopChat ? "xl:hidden" : ""
            }`}
          >
            <button
              onClick={() => setOpenChat((v) => !v)}
              className="mb-2 flex w-full items-center justify-between text-left text-sm font-semibold"
            >
              <span className="inline-flex items-center gap-2">
                <MessageCircle size={14} /> Chat
                {chatPriorityMode ? (
                  <span className="rounded-full border border-accent/45 bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
                    Focus
                  </span>
                ) : null}
              </span>
              {openChat ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
            {openChat ? (
              <div
                className={`flex min-h-0 flex-col ${
                  chatPriorityMode ? "h-[56vh] lg:h-[64vh]" : "h-[340px]"
                }`}
              >
                <div className="relative min-h-0 flex-1">
                  <div
                    ref={chatScrollRef}
                    onScroll={onChatScroll}
                    className="h-full min-h-0 space-y-2 overflow-y-auto pr-1"
                  >
                    {!messages.length ? (
                      <div className="grid h-full place-items-center rounded-xl border border-dashed border-white/15 bg-black/20 px-3 text-sm text-white/50">
                        暂无消息，发送第一条开始聊天
                      </div>
                    ) : (
                      messages.map((m) => {
                        const isMine = m.user_name === userName.trim();
                        return (
                          <div
                            key={m.client_id ?? m.id}
                            className={`flex ${isMine ? "justify-end" : "justify-start"}`}
                          >
                            <div
                              className={`flex max-w-[90%] items-end gap-2 ${
                                isMine ? "flex-row-reverse" : ""
                              }`}
                            >
                              <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full border border-white/15 bg-black/40">
                                <div className="grid h-full w-full place-items-center text-[11px] text-white/60">
                                  {m.nickname.slice(0, 1).toUpperCase()}
                                </div>
                                {m.avatar_url ? (
                                  <img
                                    src={resolveAvatarSrc(m.avatar_url)}
                                    alt={m.nickname}
                                    className="absolute inset-0 h-full w-full object-cover"
                                    onError={(e) => {
                                      e.currentTarget.onerror = null;
                                      e.currentTarget.style.display = "none";
                                    }}
                                  />
                                ) : null}
                              </div>
                              <div
                                className={`min-w-0 rounded-2xl border px-3 py-2 ${
                                  isMine
                                    ? "border-accent/50 bg-accent/15"
                                    : "border-white/10 bg-black/20"
                                }`}
                              >
                                <div className="mb-1 flex items-center gap-2 text-[11px] text-white/65">
                                  <span className="max-w-[8rem] truncate font-medium text-white/80">
                                    {m.nickname}
                                  </span>
                                  <span className="rounded bg-white/10 px-1.5 py-0.5 uppercase tracking-wide">
                                    {m.role}
                                  </span>
                                  <span>{formatChatTime(m.created_at)}</span>
                                  {m.failed ? (
                                    <span className="text-red-300">发送失败</span>
                                  ) : m.pending ? (
                                    <span className="text-accent">发送中</span>
                                  ) : null}
                                </div>
                                <p className="whitespace-pre-wrap break-words text-sm leading-5">
                                  {m.text}
                                </p>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                  {pendingChatHints > 0 ? (
                    <button
                      type="button"
                      onClick={() => scrollChatToBottom("smooth")}
                      className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full border border-accent/50 bg-card/90 px-3 py-1 text-xs font-medium text-accent shadow-[0_6px_20px_rgba(0,0,0,0.35)] backdrop-blur-md"
                    >
                      {pendingChatHints > 1 ? `${pendingChatHints} 条新消息` : "1 条新消息"}，点击查看
                    </button>
                  ) : null}
                </div>
                <div className="mt-2 flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 p-1.5">
                  <input
                    value={chatText}
                    onChange={(e) => setChatText(e.target.value)}
                    placeholder="输入消息，按 Enter 发送"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") run(sendChat);
                    }}
                    className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm outline-none placeholder:text-white/45"
                  />
                  <button
                    onClick={() => run(sendChat)}
                    disabled={!chatText.trim()}
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent leading-none text-[#06211f] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Send size={16} />
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className={`rounded-2xl border border-white/10 bg-black/30 p-3 ${consolePane === "ops" ? "" : "xl:hidden"}`}>
            <button
              onClick={() => setOpenLogs((v) => !v)}
              className="mb-2 flex w-full items-center justify-between text-left text-sm font-semibold"
            >
              <span>Logs</span>
              {openLogs ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
            {openLogs ? (
              <div className="font-mono max-h-40 space-y-1 overflow-auto text-[11px] text-white/75">
                {logs.map((line, idx) => (
                  <p key={`${line}-${idx}`}>{line}</p>
                ))}
              </div>
            ) : (
              <p className="font-mono text-xs text-white/50">点击展开查看系统日志</p>
            )}
          </div>
        </section>
      </aside>

      {showInviteGate ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-card/80 p-5 backdrop-blur-md">
            <h2 className="text-xl font-semibold">Enter Ivena Meet</h2>
            <p className="mt-1 text-sm text-white/60">
              需要邀请链接才能进入房间。若你是主持人，请走主持人入口。
            </p>
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setHostEntryUnlocked(true)}
                className="rounded-xl bg-accent px-3 py-2 font-semibold text-[#06211f]"
              >
                主持人入口
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-xl bg-white/10 px-3 py-2 text-white"
              >
                我有邀请链接
              </button>
            </div>
            <p className="mt-3 text-xs text-white/50">
              邀请模式请使用包含 room/ticket 参数的完整链接打开。
            </p>
          </div>
        </div>
      ) : null}

      {!joined && !showInviteGate ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-card/80 p-5 backdrop-blur-md">
            <h2 className="text-xl font-semibold">Enter Ivena Meet</h2>
            <p className="mt-1 text-sm text-white/60">先完成鉴权和房间配置，才能继续进入会话。</p>

            <div className="mt-4 space-y-2">
              <input
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                placeholder="room_id"
                className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2"
              />
              <input
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder="name"
                className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2"
              />

              {effectiveRole === "member" ? (
                <>
                  <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                    <div className="h-10 w-10 overflow-hidden rounded-full border border-white/20 bg-black/30">
                      {avatarPreview ? (
                        <img src={avatarPreview} alt="avatar" className="h-full w-full object-cover" />
                      ) : (
                        <div className="grid h-full w-full place-items-center text-white/60">
                          <Image size={14} />
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={onPickAvatar}
                      className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm"
                    >
                      <ImagePlus size={16} /> 上传头像
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(e) => onAvatarFileChange(e.target.files?.[0])}
                      className="hidden"
                    />
                  </div>
                  <p
                    className={`font-mono text-[11px] ${
                      avatarStatus.kind === "ok"
                        ? "text-ok"
                        : avatarStatus.kind === "error"
                          ? "text-red-300"
                          : "text-white/50"
                    }`}
                  >
                    {avatarStatus.text}
                  </p>
                </>
              ) : (
                <p className="font-mono text-[11px] text-white/50">
                  主持人请先成功加入房间，再在侧边栏上传头像。
                </p>
              )}

              {hostEntryUnlocked ? (
                <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/70">
                  <span>host mode</span>
                  <button
                    type="button"
                    onClick={() => setHostEntryUnlocked(false)}
                    className="rounded-lg bg-white/10 px-2 py-1 text-xs text-white/80"
                  >
                    切回成员
                  </button>
                </div>
              ) : !inviteMode ? (
                <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/70">
                  member mode
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/70">
                  <span>invite mode: member</span>
                  <button
                    type="button"
                    onClick={() => setHostEntryUnlocked(true)}
                    className="rounded-lg bg-accent/90 px-2 py-1 text-xs font-semibold text-[#06211f]"
                  >
                    主持人入口
                  </button>
                </div>
              )}

              {(requireInvite || inviteMode) && effectiveRole === "member" ? (
                <>
                  <div className="relative">
                    <Ticket size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/50" />
                    <input
                      value={inviteCode}
                      onChange={(e) => setInviteCode(e.target.value)}
                      placeholder="invite_code"
                      className="w-full rounded-xl border border-white/10 bg-black/20 py-2 pl-9 pr-3"
                    />
                  </div>
                  <input
                    value={inviteTicket}
                    onChange={(e) => setInviteTicket(e.target.value)}
                    placeholder="invite_ticket"
                    className="font-mono w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs"
                  />
                </>
              ) : null}

              {effectiveRole === "host" ? (
                <>
                  <div className="relative">
                    <ShieldCheck size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/50" />
                    <input
                      value={hostTotpCode}
                      onChange={(e) => setHostTotpCode(e.target.value)}
                      type="password"
                      placeholder="TOTP 动态码（6位）"
                      className="font-mono w-full rounded-xl border border-white/10 bg-black/20 py-2 pl-9 pr-3 text-xs"
                    />
                  </div>
                  <p className="font-mono text-[11px] text-white/50">
                    使用 TOTP 验证后签发 15 分钟主持会话，系统会自动续期。
                  </p>
                </>
              ) : null}

              {effectiveRole === "host" && hostSessionExpireAt > 0 ? (
                <div className="rounded-xl border border-ok/40 bg-ok/10 px-3 py-2 text-xs text-ok">
                  主持人认证凭证已就绪
                </div>
              ) : null}

            </div>

            <button
              disabled={joining}
              onClick={() => run(joinRoom)}
              className="mt-4 w-full rounded-xl bg-accent px-3 py-2 font-semibold text-[#06211f] disabled:opacity-60"
            >
              {joining ? "Joining..." : "Join Room"}
            </button>

            {effectiveRole === "host" && showReclaimCta ? (
              <button
                disabled={reclaiming}
                onClick={() => run(forceReclaimAndRetry)}
                className="mt-2 w-full rounded-xl border border-ok/40 bg-ok/15 px-3 py-2 font-semibold text-ok disabled:opacity-60"
              >
                {reclaiming ? "回收中..." : "房间被占用，回收后重试"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {showBroadcastModal ? (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4">
          <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-card/80 p-4 backdrop-blur-md">
            <h3 className="mb-3 text-lg font-semibold">WHIP Broadcast Credentials</h3>
            <div className="font-mono space-y-2 text-xs">
              <div className="rounded-xl border border-white/10 bg-black/30 p-2">
                <p className="mb-1 text-white/60">obs_whip_endpoint</p>
                <p className="break-all">{obsWhipEndpoint || "-"}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/30 p-2">
                <p className="mb-1 text-white/60">whip_url</p>
                <p className="break-all">{whipUrl || "-"}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/30 p-2">
                <p className="mb-1 text-white/60">stream_key</p>
                <p className="break-all">{streamKey || "-"}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/30 p-2">
                <p className="mb-1 text-white/60">ingress_id</p>
                <p className="break-all">{ingressId || "-"}</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-white/70">
              OBS 推荐直接填 <span className="font-mono">obs_whip_endpoint</span>。如果使用该完整地址，
              不需要再单独填写 Bearer Token。
            </p>
            <p className="mt-2 text-xs text-white/70">
              防回声建议：OBS 只保留“桌面/窗口 + 系统音频”，不要添加麦克风音源；
              麦克风请使用本页面的语音按钮单独上麦。
            </p>
            <button
              onClick={() => setShowBroadcastModal(false)}
              className="mt-3 w-full rounded-xl bg-accent px-3 py-2 font-semibold text-[#06211f]"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { CHAT_HISTORY_LIMIT } from "../../lib/env";
import { messageTailKey } from "../../lib/chat";
import type { JoinResp, MessageItem, RealtimeChatPayload } from "../../lib/types";

type ApiClient = ReturnType<typeof import("../../lib/api").createApi>;

type Params = {
  api: ApiClient;
  joined: JoinResp | null;
  appSessionToken: string;
  roomId: string;
  userName: string;
  messages: MessageItem[];
  openChat: boolean;
  setMessages: Dispatch<SetStateAction<MessageItem[]>>;
  lastRealtimeChat: RealtimeChatPayload | null;
  realtimeChatSender: ((payload: RealtimeChatPayload) => Promise<void>) | null;
  pushLog: (s: string) => void;
};

function createClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
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

export function useChatState({
  api,
  joined,
  appSessionToken,
  roomId,
  userName,
  messages,
  openChat,
  setMessages,
  lastRealtimeChat,
  realtimeChatSender,
  pushLog,
}: Params) {
  const [chatText, setChatText] = useState("");
  const [pendingChatHints, setPendingChatHints] = useState(0);

  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatAutoScrollRef = useRef(true);
  const lastChatTailKeyRef = useRef("empty");
  const lastMessageIdRef = useRef(0);
  const historySyncErrorLoggedRef = useRef(false);

  useEffect(() => {
    if (!joined) return;
    api
      .listMessages(roomId, CHAT_HISTORY_LIMIT)
      .then((res) => setMessages(res.items))
      .catch((e) => pushLog(`history error: ${String(e)}`));
  }, [joined, roomId, api, setMessages, pushLog]);

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
          setMessages((prev) => {
            const next = mergeMessages(prev, [{ ...item, pending: false, failed: false }]);
            let maxId = lastMessageIdRef.current;
            for (const message of next) {
              if (message.id > maxId) maxId = message.id;
            }
            lastMessageIdRef.current = maxId;
            return next;
          });
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
    setMessages((prev) => {
      const next = mergeMessages(prev, [toRealtimeMessage(lastRealtimeChat)]);
      let maxId = lastMessageIdRef.current;
      for (const message of next) {
        if (message.id > maxId) maxId = message.id;
      }
      lastMessageIdRef.current = maxId;
      return next;
    });
  }, [joined, lastRealtimeChat, roomId, setMessages]);

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

  const resetChatState = () => {
    setPendingChatHints(0);
    chatAutoScrollRef.current = true;
    lastChatTailKeyRef.current = "empty";
  };

  return {
    chatText,
    setChatText,
    pendingChatHints,
    chatScrollRef,
    onChatScroll,
    scrollChatToBottom,
    sendChat,
    resetChatState,
  };
}

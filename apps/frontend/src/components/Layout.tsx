import { useCallback, useEffect, useMemo, useState } from "react";
import type { JoinResp, MemberItem, MessageItem, RealtimeChatPayload, Role } from "../lib/types";
import {
  API_BASE_URL,
  DEFAULT_ROOM_ID,
  DEFAULT_ROLE,
  DEFAULT_USER_NAME,
  LOG_MAX_LINES,
  REQUIRE_INVITE,
} from "../lib/env";
import { createApi } from "../lib/api";
import { Sidebar } from "./Sidebar";
import { MainStage } from "./MainStage";
import { ChatPanel } from "./ChatPanel";

const LS_KEYS = {
  roomId: "ivena.meet.room_id",
  userName: "ivena.meet.user_name",
  role: "ivena.meet.role",
  joined: "ivena.meet.joined",
  appSessionToken: "ivena.meet.app_session_token",
  hostSessionToken: "ivena.meet.host_session_token",
} as const;

export function Layout() {
  const [hostSessionToken, setHostSessionToken] = useState(
    () => localStorage.getItem(LS_KEYS.hostSessionToken) ?? "",
  );
  const [appSessionToken, setAppSessionToken] = useState(
    () => localStorage.getItem(LS_KEYS.appSessionToken) ?? "",
  );

  const [roomId, setRoomId] = useState(
    () => localStorage.getItem(LS_KEYS.roomId) ?? DEFAULT_ROOM_ID,
  );
  const [userName, setUserName] = useState(
    () => localStorage.getItem(LS_KEYS.userName) ?? DEFAULT_USER_NAME,
  );
  const [role, setRole] = useState<Role>(() => {
    const raw = localStorage.getItem(LS_KEYS.role);
    return raw === "host" || raw === "member" ? raw : DEFAULT_ROLE;
  });

  const [joined, setJoined] = useState<JoinResp | null>(() => {
    const raw = localStorage.getItem(LS_KEYS.joined);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as JoinResp;
    } catch {
      return null;
    }
  });
  const [members, setMembers] = useState<MemberItem[]>([]);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [hasVisualMedia, setHasVisualMedia] = useState(false);
  const [lastRealtimeChat, setLastRealtimeChat] = useState<RealtimeChatPayload | null>(null);
  const [realtimeChatSender, setRealtimeChatSender] = useState<((payload: RealtimeChatPayload) => Promise<void>) | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const sortMessages = (items: MessageItem[]): MessageItem[] =>
    [...items].sort((a, b) => {
      if (a.created_at !== b.created_at) return a.created_at - b.created_at;
      if (a.id === b.id) return 0;
      if (a.id < 0 && b.id > 0) return -1;
      if (a.id > 0 && b.id < 0) return 1;
      return a.id - b.id;
    });

  const upsertMessage = useCallback((base: MessageItem[], next: MessageItem): MessageItem[] => {
    let idx = -1;
    if (next.client_id) {
      idx = base.findIndex((m) => m.client_id === next.client_id);
    }
    if (idx < 0) {
      idx = base.findIndex((m) => m.id === next.id);
    }
    if (idx < 0) return sortMessages([...base, next]);
    const out = [...base];
    out[idx] = { ...out[idx], ...next };
    return sortMessages(out);
  }, []);

  const handleRealtimeChatSenderReady = useCallback(
    (sender: ((payload: RealtimeChatPayload) => Promise<void>) | null) => {
      setRealtimeChatSender(() => sender);
    },
    [],
  );

  const api = useMemo(
    () =>
      createApi(API_BASE_URL, {
        getControlToken: () => hostSessionToken,
        getAppSessionToken: () => appSessionToken,
      }),
    [hostSessionToken, appSessionToken],
  );

  const pushLog = useCallback((line: string) => {
    setLogs((prev) => [...prev.slice(-(LOG_MAX_LINES - 1)), `[${new Date().toLocaleTimeString()}] ${line}`]);
  }, []);

  useEffect(() => {
    localStorage.setItem(LS_KEYS.roomId, roomId);
  }, [roomId]);
  useEffect(() => {
    localStorage.setItem(LS_KEYS.userName, userName);
  }, [userName]);
  useEffect(() => {
    localStorage.setItem(LS_KEYS.role, role);
  }, [role]);
  useEffect(() => {
    if (joined) localStorage.setItem(LS_KEYS.joined, JSON.stringify(joined));
    else localStorage.removeItem(LS_KEYS.joined);
  }, [joined]);
  useEffect(() => {
    if (appSessionToken) localStorage.setItem(LS_KEYS.appSessionToken, appSessionToken);
    else localStorage.removeItem(LS_KEYS.appSessionToken);
  }, [appSessionToken]);
  useEffect(() => {
    if (hostSessionToken) localStorage.setItem(LS_KEYS.hostSessionToken, hostSessionToken);
    else localStorage.removeItem(LS_KEYS.hostSessionToken);
  }, [hostSessionToken]);

  useEffect(() => {
    if (!joined) setHasVisualMedia(false);
  }, [joined]);

  const chatPriorityMode = Boolean(joined && !hasVisualMedia);
  const stagePriorityMode = Boolean(joined && hasVisualMedia);
  const desktopGridClass = stagePriorityMode
    ? "lg:grid-cols-[300px_1fr]"
    : "lg:grid-cols-[320px_1fr] xl:grid-cols-[300px_minmax(620px,1.08fr)_minmax(520px,0.92fr)]";

  const handleSendChat = useCallback(
    async (text: string) => {
      const body = text.trim();
      if (!joined || !body) return;
      const clientId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID().replace(/-/g, "")
          : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

      const pendingMessage: MessageItem = {
        id: -Math.floor(Date.now() * 1000 + Math.random() * 1000),
        room_id: roomId.trim(),
        user_name: userName.trim(),
        nickname: userName.trim(),
        avatar_url: null,
        role: joined.role,
        client_id: clientId,
        text: body,
        created_at: Math.floor(Date.now() / 1000),
        pending: true,
        failed: false,
      };
      setMessages((prev) => upsertMessage(prev, pendingMessage));

      if (realtimeChatSender) {
        try {
          await realtimeChatSender({
            type: "chat.message",
            room_id: roomId.trim(),
            client_id: clientId,
            user_name: userName.trim(),
            nickname: userName.trim(),
            avatar_url: null,
            role: joined.role,
            text: body,
            created_at: pendingMessage.created_at,
          });
        } catch (e) {
          pushLog(`realtime send error: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      try {
        const created = await api.createMessage(roomId.trim(), {
          text: body,
          client_id: clientId,
        });
        setMessages((prev) => upsertMessage(prev, { ...created, pending: false, failed: false }));
      } catch (e) {
        setMessages((prev) =>
          prev.map((m) =>
            m.client_id === clientId
              ? { ...m, pending: false, failed: true }
              : m,
          ),
        );
        throw e;
      }
    },
    [api, joined, roomId, userName, realtimeChatSender, upsertMessage, pushLog],
  );

  return (
    <div className="relative h-screen overflow-hidden bg-[#081118] font-space text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-28 top-[-120px] h-[360px] w-[360px] rounded-full bg-[#4ecdc4]/12 blur-[80px]" />
        <div className="absolute right-[-140px] top-[10%] h-[420px] w-[420px] rounded-full bg-[#7edb8f]/10 blur-[100px]" />
        <div className="absolute bottom-[-180px] left-[25%] h-[420px] w-[620px] rounded-full bg-[#123d58]/30 blur-[120px]" />
      </div>
      <div className="relative mx-auto flex h-full w-full max-w-[1920px] flex-col p-3 lg:p-5">
        <header className="mb-3 rounded-2xl border border-white/10 bg-card/55 px-4 py-3 backdrop-blur-md lg:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-white/95 lg:text-xl">
                Ivena Meet
              </h1>
              <p className="text-xs text-white/60">
                Private Real-time Lounge
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="rounded-full border border-white/15 bg-black/25 px-3 py-1 text-white/75">
                room: {roomId}
              </span>
              <span className="rounded-full border border-accent/35 bg-accent/10 px-3 py-1 text-accent">
                {joined ? (chatPriorityMode ? "chat focus" : "stage focus") : "standby"}
              </span>
              <span className="rounded-full border border-white/15 bg-black/25 px-3 py-1 text-white/70">
                {joined ? joined.role : role}
              </span>
            </div>
          </div>
        </header>

        <div className={`grid min-h-0 flex-1 items-stretch gap-3 overflow-hidden xl:gap-4 ${desktopGridClass}`}>
          <Sidebar
            requireInvite={REQUIRE_INVITE}
            api={api}
            roomId={roomId}
            setRoomId={setRoomId}
            userName={userName}
            setUserName={setUserName}
            role={role}
            setRole={setRole}
            joined={joined}
            appSessionToken={appSessionToken}
            setJoined={setJoined}
            setAppSessionToken={setAppSessionToken}
            setHostSessionToken={setHostSessionToken}
            members={members}
            messages={messages}
            setMessages={setMessages}
            lastRealtimeChat={lastRealtimeChat}
            realtimeChatSender={realtimeChatSender}
            logs={logs}
            pushLog={pushLog}
            chatPriorityMode={chatPriorityMode}
            hideDesktopChat={!stagePriorityMode}
          />

          {!stagePriorityMode ? (
            <ChatPanel
              joined={joined}
              roomId={roomId}
              userName={userName}
              onlineCount={members.length}
              stageFocused={!chatPriorityMode}
              messages={messages}
              onSend={handleSendChat}
              className="xl:flex"
            />
          ) : null}

          <MainStage
            joined={joined}
            roomId={roomId}
            userName={userName}
            role={joined?.role ?? role}
            compact={chatPriorityMode}
            onMembersChange={setMembers}
            onRealtimeChatMessage={setLastRealtimeChat}
            onRealtimeChatSenderReady={handleRealtimeChatSenderReady}
            onVisualMediaChange={setHasVisualMedia}
            onLog={pushLog}
          />
        </div>
      </div>
    </div>
  );
}

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
import { LiveKitRoom } from "@livekit/components-react";

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

    const content = (
        <div className="relative flex h-full w-full mx-auto max-w-[2000px]">
            {/* We won't need the header row since discord/slack typically puts server info in the sidebar */}
            <div className={`flex w-full h-full gap-2 p-2`}>

                {/* Left Sidebar (fixed width, slightly wider to accommodate videos later) */}
                <div className="w-[340px] flex-shrink-0 flex flex-col hidden lg:flex">
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
                </div>

                {/* Main Stage Output */}
                <div className="flex-1 min-w-0 flex flex-col gap-2">
                    {/* Minimal top bar for room info if needed (optional, moving to sidebar might be better, keeping here temporarily or simplifying) */}
                    <header className="shrink-0 flex items-center justify-between bg-bg-panel/40 rounded-xl px-4 py-3 border border-bg-light">
                        <div className="flex items-center gap-3">
                            <h1 className="text-lg font-semibold tracking-tight text-white hover:text-accent transition-colors cursor-default">
                                Ivena Meet
                            </h1>
                            <div className="h-4 w-px bg-gray-600"></div>
                            <div className="flex items-center gap-2 text-xs font-mono">
                                <span className="text-gray-400">CH/<span className="text-gray-200">{roomId}</span></span>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 text-xs font-mono">
                            <span className="rounded bg-bg-light/60 px-2 py-1 text-accent border border-accent/20">
                                {joined ? (chatPriorityMode ? "CHAT_MODE" : "STAGE_MODE") : "STANDBY"}
                            </span>
                            <span className="rounded bg-bg-light/60 px-2 py-1 text-gray-300">
                                {joined ? joined.role.toUpperCase() : role.toUpperCase()}
                            </span>
                        </div>
                    </header>

                    <div className={`flex flex-1 min-h-0 gap-2 ${desktopGridClass}`}>
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

                        {/* Chat Panel - Only show if not stage priority, or if we force it */}
                        {!stagePriorityMode ? (
                            <ChatPanel
                                joined={joined}
                                roomId={roomId}
                                userName={userName}
                                onlineCount={members.length}
                                stageFocused={!chatPriorityMode}
                                messages={messages}
                                onSend={handleSendChat}
                                className="xl:flex w-[340px] flex-shrink-0"
                            />
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <div className="relative h-screen overflow-hidden bg-bg-dark font-space text-gray-200 flex">
            {joined ? (
                <LiveKitRoom
                    key={joined.token}
                    token={joined.token}
                    serverUrl={joined.lk_url}
                    connect
                    options={{ adaptiveStream: true, dynacast: true }}
                    audio={false}
                    video={false}
                    onConnected={() => pushLog(`livekit connected: ${roomId} as ${userName}`)}
                    onDisconnected={() => pushLog("livekit disconnected")}
                    onError={(e: Error) => pushLog(`livekit error: ${e?.message ?? String(e)}`)}
                >
                    {content}
                </LiveKitRoom>
            ) : content}
        </div>
    );
};

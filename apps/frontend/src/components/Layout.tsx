import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
    JoinResp,
    MemberItem,
    MessageItem,
    RealtimeChatPayload,
    Role,
    StageFeature,
} from "../lib/types";
import {
    API_BASE_URL,
    DEFAULT_ROOM_ID,
    DEFAULT_ROLE,
    DEFAULT_USER_NAME,
    LOG_MAX_LINES,
    REQUIRE_INVITE,
} from "../lib/env";
import { createApi } from "../lib/api";
import {
    applyResolvedTheme,
    readThemeMode,
    resolveTheme,
    THEME_LS_KEY,
    type ResolvedTheme,
    type ThemeMode,
} from "../lib/theme";
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
    const layoutRef = useRef<HTMLDivElement>(null);
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
    const [theaterMode, setTheaterMode] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [localScreenShareActive, setLocalScreenShareActive] = useState(false);
    const [chatDominant, setChatDominant] = useState(false);
    const [theaterControlOpen, setTheaterControlOpen] = useState(false);
    const [theaterChatOpen, setTheaterChatOpen] = useState(false);
    const [lastRealtimeChat, setLastRealtimeChat] = useState<RealtimeChatPayload | null>(null);
    const [realtimeChatSender, setRealtimeChatSender] = useState<((payload: RealtimeChatPayload) => Promise<void>) | null>(null);
    const [logs, setLogs] = useState<string[]>([]);
    const [themeMode, setThemeMode] = useState<ThemeMode>(() => readThemeMode());
    const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
        resolveTheme(
            readThemeMode(),
            typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches,
        ),
    );

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

    const inTheaterMode = Boolean(joined && hasVisualMedia && theaterMode);
    const isHostView = (joined?.role ?? role) === "host";
    const chatPriorityMode = Boolean(joined && (chatDominant || !hasVisualMedia));
    const stagePriorityMode = Boolean(joined && hasVisualMedia && !chatDominant);
    const centerPaneClass = inTheaterMode ? "flex min-h-0 flex-1" : "flex min-h-0 flex-1 gap-2";

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
        try {
            localStorage.setItem(THEME_LS_KEY, themeMode);
        } catch {
            // Ignore storage quota/privacy mode failures.
        }
    }, [themeMode]);
    useEffect(() => {
        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        const apply = () => {
            const next = resolveTheme(themeMode, mq.matches);
            setResolvedTheme(next);
            applyResolvedTheme(next);
        };
        apply();
        if (themeMode !== "system") return;
        const onChange = () => apply();
        if (typeof mq.addEventListener === "function") {
            mq.addEventListener("change", onChange);
        } else {
            (mq as MediaQueryList & { addListener?: (cb: () => void) => void }).addListener?.(onChange);
        }
        return () => {
            if (typeof mq.removeEventListener === "function") {
                mq.removeEventListener("change", onChange);
                return;
            }
            (mq as MediaQueryList & { removeListener?: (cb: () => void) => void }).removeListener?.(onChange);
        };
    }, [themeMode]);

    useEffect(() => {
        if (!joined) {
            setHasVisualMedia(false);
            setChatDominant(false);
        }
    }, [joined]);

    useEffect(() => {
        if (!joined) setLocalScreenShareActive(false);
    }, [joined]);

    useEffect(() => {
        if (!joined || !hasVisualMedia) {
            setTheaterMode(false);
        }
    }, [joined, hasVisualMedia]);

    useEffect(() => {
        if (!inTheaterMode) {
            setTheaterControlOpen(false);
            setTheaterChatOpen(false);
        }
    }, [inTheaterMode]);

    useEffect(() => {
        if (!hasVisualMedia) {
            setChatDominant(false);
        }
    }, [joined, hasVisualMedia]);

    useEffect(() => {
        const onFullscreenChange = () => {
            const active = Boolean(document.fullscreenElement);
            setIsFullscreen(active);
            if (!active) setTheaterMode(false);
        };
        document.addEventListener("fullscreenchange", onFullscreenChange);
        return () => {
            document.removeEventListener("fullscreenchange", onFullscreenChange);
        };
    }, []);

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

    const handleHostStagePermissionChange = useCallback(
        async (targetIdentity: string, feature: StageFeature, enabled: boolean) => {
            const activeRole = joined?.role ?? role;
            if (activeRole !== "host") {
                throw new Error("only host can change stage permissions");
            }
            const room = roomId.trim();
            const hostIdentity = userName.trim();
            if (!room || !hostIdentity) {
                throw new Error("room_id and host identity are required");
            }
            const res = await api.setMemberMediaPermission({
                room_id: room,
                host_identity: hostIdentity,
                target_identity: targetIdentity,
                feature,
                enabled,
            });
            pushLog(
                `stage permission ${enabled ? "allow" : "deny"} ${feature} -> ${targetIdentity} (affected=${res.affected_tracks})`,
            );
        },
        [api, joined?.role, role, roomId, userName, pushLog],
    );

    const toggleFullscreenStage = useCallback(async () => {
        if (!joined || !hasVisualMedia) return;
        const isHostSession = (joined?.role ?? role) === "host";
        try {
            if (localScreenShareActive || isHostSession) {
                // Never use browser fullscreen API for host/local share to avoid capture interruptions.
                setChatDominant(false);
                setTheaterMode((v) => !v);
                return;
            }
            if (document.fullscreenElement) {
                await document.exitFullscreen();
                setTheaterMode(false);
                return;
            }
            setChatDominant(false);
            setTheaterMode(true);
            await (layoutRef.current ?? document.documentElement).requestFullscreen();
            setIsFullscreen(true);
        } catch (e) {
            pushLog(`fullscreen failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    }, [joined, role, hasVisualMedia, localScreenShareActive, pushLog]);

    const toggleChatFocusLayout = useCallback(async () => {
        if (!joined || !hasVisualMedia) return;
        if (chatDominant) {
            setChatDominant(false);
            return;
        }
        const isHostSession = (joined?.role ?? role) === "host";
        try {
            if (document.fullscreenElement && !localScreenShareActive && !isHostSession) {
                await document.exitFullscreen();
            }
        } catch (e) {
            pushLog(`exit fullscreen failed: ${e instanceof Error ? e.message : String(e)}`);
        }
        setIsFullscreen(false);
        setTheaterMode(false);
        setChatDominant(true);
    }, [joined, role, hasVisualMedia, chatDominant, localScreenShareActive, pushLog]);

    const content = (
        <div className="relative flex h-full w-full mx-auto max-w-[2000px]">
            {/* We won't need the header row since discord/slack typically puts server info in the sidebar */}
            <div className={`flex h-full w-full ${inTheaterMode ? "p-0" : "gap-2 p-2"}`}>

                {/* Left Sidebar (fixed width, slightly wider to accommodate videos later) */}
                {!inTheaterMode ? (
                    <div className="flex w-0 flex-col lg:w-[340px] lg:flex-shrink-0">
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
                            enableBootReconnect
                            themeMode={themeMode}
                            resolvedTheme={resolvedTheme}
                            setThemeMode={setThemeMode}
                        />
                    </div>
                ) : null}

                {/* Main Stage Output */}
                <div className={`min-w-0 flex-1 ${inTheaterMode ? "flex flex-col" : "flex flex-col gap-2"}`}>
                    {/* Minimal top bar for room info if needed (optional, moving to sidebar might be better, keeping here temporarily or simplifying) */}
                    <header
                        className={`shrink-0 flex items-center justify-between border border-bg-light bg-bg-panel/40 ${
                            inTheaterMode ? "rounded-none px-3 py-2" : "rounded-xl px-4 py-3"
                        }`}
                    >
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
                            {joined && hasVisualMedia ? (
                                <button
                                    type="button"
                                    onClick={() => {
                                        void toggleChatFocusLayout();
                                    }}
                                    className={`rounded border px-2 py-1 ${
                                        chatDominant
                                            ? "border-accent/45 bg-accent/15 text-accent"
                                            : "border-white/20 bg-black/25 text-white/80"
                                    }`}
                                >
                                    {chatDominant ? "EXIT_CHAT_FOCUS" : "CHAT_FOCUS"}
                                </button>
                            ) : null}
                            {joined && hasVisualMedia ? (
                                <button
                                    type="button"
                                    onClick={() => {
                                        void toggleFullscreenStage();
                                    }}
                                    className={`rounded border px-2 py-1 ${
                                        isFullscreen || inTheaterMode
                                            ? "border-accent/45 bg-accent/15 text-accent"
                                            : "border-white/20 bg-black/25 text-white/80"
                                    }`}
                                >
                                    {isHostView || localScreenShareActive
                                        ? inTheaterMode
                                            ? "EXIT_STAGE"
                                            : "STAGE_FOCUS"
                                        : isFullscreen
                                          ? "EXIT_FULLSCREEN"
                                          : "FULLSCREEN"}
                                </button>
                            ) : null}
                            <span className="rounded bg-bg-light/60 px-2 py-1 text-accent border border-accent/20">
                                {joined ? (chatPriorityMode ? "CHAT_MODE" : "STAGE_MODE") : "STANDBY"}
                            </span>
                            <span className="rounded bg-bg-light/60 px-2 py-1 text-gray-300">
                                {joined ? joined.role.toUpperCase() : role.toUpperCase()}
                            </span>
                        </div>
                    </header>

                    <div className={centerPaneClass}>
                        <div className="min-h-0 min-w-0 flex-1">
                            <MainStage
                                joined={joined}
                                roomId={roomId}
                                userName={userName}
                                role={joined?.role ?? role}
                                compact={chatPriorityMode}
                                immersive={inTheaterMode}
                                onMembersChange={setMembers}
                                onRealtimeChatMessage={setLastRealtimeChat}
                                onRealtimeChatSenderReady={handleRealtimeChatSenderReady}
                                onVisualMediaChange={setHasVisualMedia}
                                onLocalScreenShareChange={setLocalScreenShareActive}
                                onHostStagePermissionChange={handleHostStagePermissionChange}
                                onLog={pushLog}
                            />
                        </div>

                        {/* Chat Panel - Only show if not stage priority, or if we force it */}
                        {!inTheaterMode && chatPriorityMode ? (
                            <ChatPanel
                                joined={joined}
                                roomId={roomId}
                                userName={userName}
                                onlineCount={members.length}
                                messages={messages}
                                onSend={handleSendChat}
                                className="hidden xl:flex w-[340px] flex-shrink-0"
                            />
                        ) : null}
                    </div>
                </div>

                {inTheaterMode ? (
                    <>
                        <div
                            className="pointer-events-none absolute inset-y-0 z-[60] hidden items-center lg:flex"
                            style={{ left: theaterControlOpen ? 322 : 0 }}
                        >
                            <button
                                type="button"
                                onClick={() => setTheaterControlOpen((v) => !v)}
                                className="pointer-events-auto ml-1 rounded-r-xl border border-white/20 bg-black/45 px-2 py-3 text-[11px] font-mono text-white/80 backdrop-blur-md hover:bg-black/60"
                            >
                                {theaterControlOpen ? "HIDE CTRL" : "CTRL"}
                            </button>
                        </div>
                        <div
                            className="pointer-events-none absolute inset-y-0 z-[60] hidden items-center lg:flex"
                            style={{ right: theaterChatOpen ? 362 : 0 }}
                        >
                            <button
                                type="button"
                                onClick={() => setTheaterChatOpen((v) => !v)}
                                className="pointer-events-auto mr-1 rounded-l-xl border border-white/20 bg-black/45 px-2 py-3 text-[11px] font-mono text-white/80 backdrop-blur-md hover:bg-black/60"
                            >
                                {theaterChatOpen ? "HIDE CHAT" : "CHAT"}
                            </button>
                        </div>

                        {theaterControlOpen ? (
                            <div className="absolute bottom-2 left-2 top-2 z-50 hidden w-[320px] lg:block">
                                <button
                                    type="button"
                                    onClick={() => setTheaterControlOpen(false)}
                                    className="absolute right-2 top-2 z-[70] grid h-6 w-6 place-items-center rounded-full border border-white/15 bg-black/30 text-xs text-white/60 transition-all hover:bg-black/55 hover:text-white/90"
                                    aria-label="close control drawer"
                                >
                                    ×
                                </button>
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
                                    chatPriorityMode={false}
                                    hideDesktopChat
                                    hideChatSectionCompletely
                                    enableBootReconnect={false}
                                    themeMode={themeMode}
                                    resolvedTheme={resolvedTheme}
                                    setThemeMode={setThemeMode}
                                />
                            </div>
                        ) : null}

                        {theaterChatOpen ? (
                            <div className="absolute bottom-2 right-2 top-2 z-50 hidden w-[360px] lg:block">
                                <button
                                    type="button"
                                    onClick={() => setTheaterChatOpen(false)}
                                    className="absolute left-2 top-2 z-[70] grid h-6 w-6 place-items-center rounded-full border border-white/15 bg-black/30 text-xs text-white/60 transition-all hover:bg-black/55 hover:text-white/90"
                                    aria-label="close chat drawer"
                                >
                                    ×
                                </button>
                                <ChatPanel
                                    joined={joined}
                                    roomId={roomId}
                                    userName={userName}
                                    onlineCount={members.length}
                                    messages={messages}
                                    onSend={handleSendChat}
                                    className="!flex h-full w-full rounded-2xl border border-white/15 bg-[linear-gradient(180deg,rgba(18,35,48,0.86),rgba(10,20,28,0.82))]"
                                />
                            </div>
                        ) : null}
                    </>
                ) : null}
            </div>
        </div>
    );

    return (
        <div ref={layoutRef} className="relative h-screen overflow-hidden bg-bg-dark font-space text-gray-200 flex">
            {content}
        </div>
    );
};

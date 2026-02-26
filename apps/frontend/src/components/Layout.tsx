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
    DEV_AUTH_BYPASS,
    DEV_DISABLE_LIVEKIT,
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

const DEBUG_QUERY_KEY = "debug";
const DEBUG_QUERY_MOBILE_VALUE = "mobile";
const DEBUG_LIVEKIT_QUERY_KEY = "livekit";
const DEBUG_LIVEKIT_OFF_VALUE = "off";

function readStoredRole(): Role {
    const raw = localStorage.getItem(LS_KEYS.role);
    return raw === "host" || raw === "member" ? raw : DEFAULT_ROLE;
}

function createDebugJoined(userName: string, role: Role): JoinResp {
    return {
        lk_url: "wss://debug.invalid",
        token: "debug-livekit-token",
        expires_in_seconds: 3600,
        role,
        camera_allowed: true,
        screen_share_allowed: true,
        camera_expires_at: null,
        screen_share_expires_at: null,
        nickname: userName,
        avatar_url: null,
        app_session_token: "",
        app_session_expires_in_seconds: 3600,
    };
}

function readDebugFlags(): { debugMobileMode: boolean; disableLivekitInDebug: boolean } {
    if (typeof window === "undefined" || !DEV_AUTH_BYPASS) {
        return { debugMobileMode: false, disableLivekitInDebug: false };
    }
    const params = new URLSearchParams(window.location.search);
    const debugMobileMode = params.get(DEBUG_QUERY_KEY) === DEBUG_QUERY_MOBILE_VALUE;
    const disableLivekitInDebug = debugMobileMode
        && (DEV_DISABLE_LIVEKIT || params.get(DEBUG_LIVEKIT_QUERY_KEY) === DEBUG_LIVEKIT_OFF_VALUE);
    return { debugMobileMode, disableLivekitInDebug };
}

function createChatClientId(): string {
    return typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID().replace(/-/g, "")
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function Layout() {
    const layoutRef = useRef<HTMLDivElement>(null);
    const { debugMobileMode, disableLivekitInDebug } = useMemo(() => readDebugFlags(), []);
    const [hostSessionToken, setHostSessionToken] = useState(
        () => (debugMobileMode ? "" : localStorage.getItem(LS_KEYS.hostSessionToken) ?? ""),
    );
    const [appSessionToken, setAppSessionToken] = useState(
        () => (debugMobileMode ? "" : localStorage.getItem(LS_KEYS.appSessionToken) ?? ""),
    );

    const [roomId, setRoomId] = useState(
        () => localStorage.getItem(LS_KEYS.roomId) ?? DEFAULT_ROOM_ID,
    );
    const [userName, setUserName] = useState(
        () => localStorage.getItem(LS_KEYS.userName) ?? DEFAULT_USER_NAME,
    );
    const [role, setRole] = useState<Role>(() => readStoredRole());

    const [joined, setJoined] = useState<JoinResp | null>(() => {
        if (debugMobileMode) {
            const storedName = localStorage.getItem(LS_KEYS.userName) ?? DEFAULT_USER_NAME;
            return createDebugJoined(storedName, readStoredRole());
        }
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
    const centerPaneClass = inTheaterMode
        ? "flex min-h-0 flex-col flex-1"
        : "flex min-h-0 flex-col lg:flex-row flex-1 gap-2";

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
        if (debugMobileMode) return;
        if (joined) localStorage.setItem(LS_KEYS.joined, JSON.stringify(joined));
        else localStorage.removeItem(LS_KEYS.joined);
    }, [debugMobileMode, joined]);
    useEffect(() => {
        if (debugMobileMode) return;
        if (appSessionToken) localStorage.setItem(LS_KEYS.appSessionToken, appSessionToken);
        else localStorage.removeItem(LS_KEYS.appSessionToken);
    }, [appSessionToken, debugMobileMode]);
    useEffect(() => {
        if (debugMobileMode) return;
        if (hostSessionToken) localStorage.setItem(LS_KEYS.hostSessionToken, hostSessionToken);
        else localStorage.removeItem(LS_KEYS.hostSessionToken);
    }, [hostSessionToken, debugMobileMode]);
    useEffect(() => {
        if (!debugMobileMode) return;
        localStorage.removeItem(LS_KEYS.joined);
        localStorage.removeItem(LS_KEYS.appSessionToken);
        localStorage.removeItem(LS_KEYS.hostSessionToken);
        if (appSessionToken) setAppSessionToken("");
        if (hostSessionToken) setHostSessionToken("");
    }, [appSessionToken, debugMobileMode, hostSessionToken]);
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
        if (!debugMobileMode) return;
        const safeName = userName.trim() || DEFAULT_USER_NAME;
        setJoined((prev) => {
            if (prev && prev.nickname === safeName && prev.role === role) {
                return prev;
            }
            return createDebugJoined(safeName, role);
        });
    }, [debugMobileMode, joined, role, userName]);

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
            const clientId = createChatClientId();

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

    const retryFailedChatMessage = useCallback(
        async (target: MessageItem) => {
            const body = target.text.trim();
            if (!joined || !body || !target.failed) return;
            const room = roomId.trim();
            const name = userName.trim();
            if (!room || !name) return;

            const clientId = createChatClientId();
            const createdAt = Math.floor(Date.now() / 1000);
            const targetClientId = target.client_id ?? null;
            const targetId = target.id;

            setMessages((prev) =>
                prev.map((m) => {
                    const hit = targetClientId ? m.client_id === targetClientId : m.id === targetId;
                    if (!hit) return m;
                    return {
                        ...m,
                        client_id: clientId,
                        created_at: createdAt,
                        pending: true,
                        failed: false,
                    };
                }),
            );

            if (realtimeChatSender) {
                try {
                    await realtimeChatSender({
                        type: "chat.message",
                        room_id: room,
                        client_id: clientId,
                        user_name: name,
                        nickname: name,
                        avatar_url: target.avatar_url ?? null,
                        role: joined.role,
                        text: body,
                        created_at: createdAt,
                    });
                } catch (e) {
                    pushLog(`realtime retry send error: ${e instanceof Error ? e.message : String(e)}`);
                }
            }

            try {
                const created = await api.createMessage(room, {
                    text: body,
                    client_id: clientId,
                });
                setMessages((prev) => upsertMessage(prev, { ...created, pending: false, failed: false }));
            } catch (e) {
                setMessages((prev) =>
                    prev.map((m) =>
                        m.client_id === clientId ? { ...m, pending: false, failed: true } : m,
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
            const expiresAt = feature === "camera" ? res.camera_expires_at : res.screen_share_expires_at;
            pushLog(
                `stage permission ${enabled ? "allow" : "deny"} ${feature} -> ${targetIdentity} (affected=${res.affected_tracks}${expiresAt ? `, expires_at=${expiresAt}` : ""})`,
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

    const toggleTheaterControlPanel = useCallback(() => {
        setTheaterControlOpen((prev) => {
            const next = !prev;
            if (next) setTheaterChatOpen(false);
            return next;
        });
    }, []);

    const toggleTheaterChatPanel = useCallback(() => {
        setTheaterChatOpen((prev) => {
            const next = !prev;
            if (next) setTheaterControlOpen(false);
            return next;
        });
    }, []);

    const content = (
        <div className="relative flex h-full w-full mx-auto max-w-[2000px]">
            {/* We won't need the header row since discord/slack typically puts server info in the sidebar */}
            <div
                className={`flex h-full w-full flex-col lg:flex-row ${inTheaterMode ? "p-0" : "gap-2 p-2"}`}
            >

                {/* Left Sidebar (fixed width, slightly wider to accommodate videos later) */}
                {!inTheaterMode ? (
                    <div className="flex w-full flex-col lg:w-[340px] lg:flex-shrink-0">
                        <Sidebar
                            requireInvite={debugMobileMode ? false : REQUIRE_INVITE}
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
                            onRetryMessage={retryFailedChatMessage}
                            chatPriorityMode={chatPriorityMode}
                            hideDesktopChat={!stagePriorityMode}
                            enableBootReconnect={!debugMobileMode}
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
                        className={`shrink-0 flex items-center justify-between border border-ink/10 bg-parchment/60 shadow-mucha backdrop-blur-sm ${inTheaterMode ? "rounded-none px-3 py-2" : "rounded-panel px-4 py-3"
                            }`}
                    >
                        <div className="flex items-center gap-3">
                            <h1 className="font-display text-lg font-semibold tracking-tight text-ink hover:text-gold transition-colors ease-mucha cursor-default">
                                Ivena Meet
                            </h1>
                            <div className="h-4 w-px bg-gold/35"></div>
                            <div className="flex items-center gap-2 text-xs font-mono">
                                <span className="text-ink/50">CH/<span className="text-ink/80">{roomId}</span></span>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 text-xs font-mono">
                            {joined && hasVisualMedia ? (
                                <button
                                    type="button"
                                    aria-label={chatDominant ? "退出聊天聚焦布局" : "开启聊天聚焦布局"}
                                    aria-pressed={chatDominant}
                                    onClick={() => {
                                        void toggleChatFocusLayout();
                                    }}
                                    className={`rounded-chip border px-2 py-1 transition-colors ease-mucha ${chatDominant
                                        ? "border-gold/55 bg-ink/8 text-ink/70"
                                        : "border-ink/20 bg-canvas/60 text-ink/75 hover:border-ink/12"
                                        }`}
                                >
                                    {chatDominant ? "EXIT_CHAT_FOCUS" : "CHAT_FOCUS"}
                                </button>
                            ) : null}
                            {joined && hasVisualMedia ? (
                                <button
                                    type="button"
                                    aria-pressed={isHostView || localScreenShareActive
                                        ? inTheaterMode
                                        : isFullscreen}
                                    aria-label={isHostView || localScreenShareActive
                                        ? inTheaterMode
                                            ? "退出舞台聚焦"
                                            : "开启舞台聚焦"
                                        : isFullscreen
                                            ? "退出全屏"
                                            : "进入全屏"}
                                    onClick={() => {
                                        void toggleFullscreenStage();
                                    }}
                                    className={`rounded-chip border px-2 py-1 transition-colors ease-mucha ${isFullscreen || inTheaterMode
                                        ? "border-gold/55 bg-ink/8 text-ink/70"
                                        : "border-ink/20 bg-canvas/60 text-ink/75 hover:border-ink/12"
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
                            <span className="rounded-chip bg-ink/6 px-2 py-1 text-gold border border-ink/10">
                                {joined ? (chatPriorityMode ? "CHAT_MODE" : "STAGE_MODE") : "STANDBY"}
                            </span>
                            <span className="rounded-chip bg-parchment/70 px-2 py-1 text-ink/70 border border-ink/8">
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
                                disableLivekit={disableLivekitInDebug}
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
                                onRetryMessage={retryFailedChatMessage}
                                className="w-full lg:w-[340px] flex-shrink-0"
                            />
                        ) : null}
                    </div>
                </div>

                {inTheaterMode ? (
                    <>
                        <div className="pointer-events-none absolute inset-x-0 bottom-2 z-[60] flex items-center justify-center gap-2 px-2 lg:hidden">
                            <button
                                type="button"
                                aria-label={theaterControlOpen ? "关闭舞台控制面板" : "打开舞台控制面板"}
                                aria-pressed={theaterControlOpen}
                                onClick={toggleTheaterControlPanel}
                                className="pointer-events-auto rounded-chip border border-ink/20 bg-parchment/90 px-3 py-2 text-xs font-mono text-ink/80 shadow-mucha backdrop-blur-md"
                            >
                                {theaterControlOpen ? "关闭控制" : "控制"}
                            </button>
                            <button
                                type="button"
                                aria-label={theaterChatOpen ? "关闭舞台聊天面板" : "打开舞台聊天面板"}
                                aria-pressed={theaterChatOpen}
                                onClick={toggleTheaterChatPanel}
                                className="pointer-events-auto rounded-chip border border-ink/20 bg-parchment/90 px-3 py-2 text-xs font-mono text-ink/80 shadow-mucha backdrop-blur-md"
                            >
                                {theaterChatOpen ? "关闭聊天" : "聊天"}
                            </button>
                        </div>

                        <div
                            className="pointer-events-none absolute inset-y-0 z-[60] hidden items-center lg:flex"
                            style={{ left: theaterControlOpen ? 322 : 0 }}
                        >
                            <button
                                type="button"
                                aria-label={theaterControlOpen ? "收起舞台控制器" : "展开舞台控制器"}
                                aria-pressed={theaterControlOpen}
                                onClick={toggleTheaterControlPanel}
                                className="pointer-events-auto ml-1 rounded-r-panel border border-ink/12 bg-parchment/85 px-2 py-3 text-[11px] font-mono text-ink/75 backdrop-blur-md hover:bg-parchment transition-colors ease-mucha"
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
                                aria-label={theaterChatOpen ? "收起舞台聊天栏" : "展开舞台聊天栏"}
                                aria-pressed={theaterChatOpen}
                                onClick={toggleTheaterChatPanel}
                                className="pointer-events-auto mr-1 rounded-l-panel border border-ink/12 bg-parchment/85 px-2 py-3 text-[11px] font-mono text-ink/75 backdrop-blur-md hover:bg-parchment transition-colors ease-mucha"
                            >
                                {theaterChatOpen ? "HIDE CHAT" : "CHAT"}
                            </button>
                        </div>

                        {theaterControlOpen ? (
                            <>
                                <div
                                    className="absolute inset-0 z-50 bg-ink/55 backdrop-blur-sm lg:hidden"
                                    onClick={() => setTheaterControlOpen(false)}
                                />
                                <div className="absolute inset-2 z-[70] overflow-hidden rounded-panel border border-ink/8 bg-parchment/80 shadow-mucha backdrop-blur-lg lg:hidden">
                                    <button
                                        type="button"
                                        onClick={() => setTheaterControlOpen(false)}
                                        className="absolute right-2 top-2 z-[80] grid h-7 w-7 place-items-center rounded-full border border-ink/10 bg-parchment/85 text-xs text-ink/65 transition-all ease-mucha hover:bg-parchment hover:text-ink"
                                        aria-label="关闭控制面板抽屉"
                                    >
                                        ×
                                    </button>
                                    <Sidebar
                                        requireInvite={debugMobileMode ? false : REQUIRE_INVITE}
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
                                        onRetryMessage={retryFailedChatMessage}
                                        chatPriorityMode={false}
                                        hideDesktopChat
                                        hideChatSectionCompletely
                                        enableBootReconnect={false}
                                        themeMode={themeMode}
                                        resolvedTheme={resolvedTheme}
                                        setThemeMode={setThemeMode}
                                    />
                                </div>
                                <div className="absolute bottom-2 left-2 top-2 z-50 hidden w-[320px] overflow-hidden rounded-panel border border-ink/8 bg-parchment/70 shadow-mucha backdrop-blur-lg lg:block">
                                    <button
                                        type="button"
                                        onClick={() => setTheaterControlOpen(false)}
                                        className="absolute right-2 top-2 z-[70] grid h-6 w-6 place-items-center rounded-full border border-ink/10 bg-parchment/80 text-xs text-ink/55 transition-all ease-mucha hover:bg-parchment hover:text-ink"
                                        aria-label="关闭控制面板抽屉"
                                    >
                                        ×
                                    </button>
                                    <Sidebar
                                        requireInvite={debugMobileMode ? false : REQUIRE_INVITE}
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
                                        onRetryMessage={retryFailedChatMessage}
                                        chatPriorityMode={false}
                                        hideDesktopChat
                                        hideChatSectionCompletely
                                        enableBootReconnect={false}
                                        themeMode={themeMode}
                                        resolvedTheme={resolvedTheme}
                                        setThemeMode={setThemeMode}
                                    />
                                </div>
                            </>
                        ) : null}

                        {theaterChatOpen ? (
                            <>
                                <div
                                    className="absolute inset-0 z-50 bg-ink/55 backdrop-blur-sm lg:hidden"
                                    onClick={() => setTheaterChatOpen(false)}
                                />
                                <div className="absolute inset-2 z-[70] overflow-hidden rounded-panel border border-ink/8 bg-parchment/80 shadow-mucha backdrop-blur-lg lg:hidden">
                                    <button
                                        type="button"
                                        onClick={() => setTheaterChatOpen(false)}
                                        className="absolute left-2 top-2 z-[80] grid h-7 w-7 place-items-center rounded-full border border-ink/10 bg-parchment/85 text-xs text-ink/65 transition-all ease-mucha hover:bg-parchment hover:text-ink"
                                        aria-label="关闭舞台聊天栏"
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
                                        onRetryMessage={retryFailedChatMessage}
                                        className="!flex h-full w-full rounded-panel border border-ink/10 bg-parchment/95 shadow-mucha backdrop-blur-md"
                                    />
                                </div>
                                <div className="absolute bottom-2 right-2 top-2 z-50 hidden w-[360px] overflow-hidden rounded-panel border border-ink/8 bg-parchment/70 shadow-mucha backdrop-blur-lg lg:block">
                                    <button
                                        type="button"
                                        onClick={() => setTheaterChatOpen(false)}
                                        className="absolute left-2 top-2 z-[70] grid h-6 w-6 place-items-center rounded-full border border-ink/10 bg-parchment/80 text-xs text-ink/55 transition-all ease-mucha hover:bg-parchment hover:text-ink"
                                        aria-label="关闭舞台聊天栏"
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
                                        onRetryMessage={retryFailedChatMessage}
                                        className="!flex h-full w-full rounded-panel border border-ink/10 bg-parchment/95 shadow-mucha backdrop-blur-md"
                                    />
                                </div>
                            </>
                        ) : null}
                    </>
                ) : null}
            </div>
        </div>
    );

    return (
        <div ref={layoutRef} className="relative h-screen overflow-hidden bg-canvas font-body text-ink flex">
            {content}
        </div>
    );
};

import { useEffect, useId, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
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
    RefreshCw,
    Send,
    Terminal,
    Ticket,
    Trash2,
    Users,
    UserPlus,
} from "lucide-react";
import {
    resolveAvatarSrc,
} from "../lib/avatar";
import type { ResolvedTheme, ThemeMode } from "../lib/theme";
import type { JoinResp, MemberItem, MessageItem, RealtimeChatPayload, Role } from "../lib/types";
import { ChatMessageRow } from "./chat/ChatMessageRow";
import { OrnamentFrame, OrnateDivider } from "./mucha-primitives";
import { useAvatarState } from "../hooks/sidebar/useAvatarState";
import { useChatState } from "../hooks/sidebar/useChatState";
import { usePresenceState } from "../hooks/sidebar/usePresenceState";
import { useRoomState } from "../hooks/sidebar/useRoomState";
import { useSessionState } from "../hooks/sidebar/useSessionState";

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
    onRetryMessage?: (message: MessageItem) => Promise<void>;
    chatPriorityMode?: boolean;
    hideDesktopChat?: boolean;
    hideChatSectionCompletely?: boolean;
    enableBootReconnect?: boolean;
    themeMode: ThemeMode;
    resolvedTheme: ResolvedTheme;
    setThemeMode: (v: ThemeMode) => void;
};

type MeetingTimelineItem = {
    id: string;
    at: number;
    kind: "presence" | "audio" | "video" | "broadcast" | "moderation";
    text: string;
};

const DIALOG_FOCUSABLE_SELECTOR =
    "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

const getFocusableElements = (root: HTMLElement): HTMLElement[] =>
    Array.from(root.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR));

type UseDialogFocusOptions = {
    isOpen: boolean;
    rootRef: RefObject<HTMLDivElement | null>;
    onClose?: () => void;
    getInitialFocus?: () => HTMLElement | null;
};

const useDialogFocus = ({
    isOpen,
    rootRef,
    onClose,
    getInitialFocus,
}: UseDialogFocusOptions) => {
    const previousFocusRef = useRef<HTMLElement | null>(null);
    const onCloseRef = useRef(onClose);
    const getInitialFocusRef = useRef(getInitialFocus);

    useEffect(() => {
        onCloseRef.current = onClose;
        getInitialFocusRef.current = getInitialFocus;
    }, [onClose, getInitialFocus]);

    useEffect(() => {
        if (!isOpen) return;
        const dialog = rootRef.current;
        if (!dialog) return;

        previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const focusable = getFocusableElements(dialog);
        const explicitInitial = getInitialFocusRef.current?.();
        const initial = (explicitInitial && dialog.contains(explicitInitial)) ? explicitInitial : (focusable[0] ?? dialog);
        initial.focus({ preventScroll: true });

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                const close = onCloseRef.current;
                if (!close) return;
                event.preventDefault();
                close();
                return;
            }
            if (event.key !== "Tab") return;

            const focusableElements = getFocusableElements(dialog);
            if (!focusableElements.length) {
                event.preventDefault();
                return;
            }

            const first = focusableElements[0];
            const last = focusableElements[focusableElements.length - 1];
            const active = document.activeElement;

            if (event.shiftKey) {
                if (!active || active === first || !dialog.contains(active)) {
                    event.preventDefault();
                    last.focus({ preventScroll: true });
                }
                return;
            }

            if (active === last) {
                event.preventDefault();
                first.focus({ preventScroll: true });
            }
        };

        dialog.addEventListener("keydown", onKeyDown);
        return () => {
            dialog.removeEventListener("keydown", onKeyDown);
            const previousFocus = previousFocusRef.current;
            if (previousFocus?.isConnected) {
                previousFocus.focus({ preventScroll: true });
            }
        };
    }, [isOpen, rootRef]);
};

function inviteExpiryHint(expiresAt: string): string {
    const expiresMs = Date.parse(expiresAt);
    if (!Number.isFinite(expiresMs)) return "失效时间未知";
    const diffSeconds = Math.floor((expiresMs - Date.now()) / 1000);
    if (diffSeconds <= 0) return "已失效";
    if (diffSeconds < 60) return `${diffSeconds}s 后失效`;
    if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m 后失效`;
    return `${Math.floor(diffSeconds / 3600)}h 后失效`;
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
        onRetryMessage,
        chatPriorityMode = false,
        hideDesktopChat = false,
        hideChatSectionCompletely = false,
        enableBootReconnect = true,
        themeMode,
        resolvedTheme,
        setThemeMode,
    } = props;

    const {
        openMembers,
        setOpenMembers,
        openChat,
        setOpenChat,
        openLogs,
        setOpenLogs,
        consolePane,
        setConsolePane,
    } = usePresenceState(chatPriorityMode);

    const {
        avatarPreview,
        setAvatarPreview,
        avatarStatus,
        setAvatarStatus,
        avatarEditorOpen,
        setAvatarEditorOpen,
        fileInputRef,
        avatarUploadDataRef,
        avatarPreviewBlobRef,
        syncAvatarFromServer,
        resetAvatarTransient,
        openAvatarEditor,
        onPickAvatar,
        onAvatarFileChange,
    } = useAvatarState({
        api,
        joined,
        appSessionToken,
        userName,
        messages,
        setMessages,
        pushLog,
    });

    const {
        chatText,
        setChatText,
        pendingChatHints,
        chatScrollRef,
        onChatScroll,
        scrollChatToBottom,
        sendChat,
        resetChatState,
    } = useChatState({
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
    });

    const {
        inviteCode,
        setInviteCode,
        inviteTicket,
        setInviteTicket,
        hostTotpCode,
        setHostTotpCode,
        inviteCopied,
        sessionExpireAt,
        setSessionExpireAt,
        hostSessionExpireAt,
        setHostSessionExpireAt,
        ingressId,
        whipUrl,
        streamKey,
        setShowBroadcastModal,
        showBroadcastModal,
        joining,
        reclaiming,
        showReclaimCta,
        actionNotice,
        hostEntryUnlocked,
        setHostEntryUnlocked,
        inviteItems,
        inviteListLoading,
        inviteMode,
        effectiveRole,
        showInviteGate,
        isHost,
        obsWhipEndpoint,
        showActionNotice,
        clearClientState,
        leaveRoom,
        joinRoom,
        forceReclaimAndRetry,
        issueInvite,
        refreshInviteList,
        revokeInvite,
        startBroadcast,
        stopBroadcast,
        muteAll,
        muteOne,
        setMemberMediaPermission,
        run,
    } = useRoomState({
        requireInvite,
        api,
        roomId,
        setRoomId,
        userName,
        role,
        setRole,
        joined,
        appSessionToken,
        setJoined,
        setAppSessionToken,
        setHostSessionToken,
        setMessages,
        pushLog,
        avatarPreview,
        avatarUploadDataRef,
        avatarPreviewBlobRef,
        setAvatarPreview,
        setAvatarStatus,
        syncAvatarFromServer,
        onLeaveCleanup: () => {
            resetChatState();
            resetAvatarTransient();
        },
    });

    const {
        sessionConnectionStatus,
        sessionReconnectInSeconds,
        retrySessionRecovery,
        rejoinSession,
    } = useSessionState({
        api,
        joined,
        appSessionToken,
        isHost,
        sessionExpireAt,
        hostSessionExpireAt,
        setSessionExpireAt,
        setHostSessionExpireAt,
        setJoined,
        clearClientState,
        setMessages: (items) => setMessages(items),
        showActionNotice,
        pushLog,
        enableBootReconnect,
    });

    const [openTimeline, setOpenTimeline] = useState(true);
    const [retryingMessageKey, setRetryingMessageKey] = useState("");
    const [timelineItems, setTimelineItems] = useState<MeetingTimelineItem[]>([]);
    const memberSnapshotRef = useRef<Map<string, { mic: boolean; camera: boolean; screen: boolean }>>(
        new Map(),
    );
    const memberSnapshotReadyRef = useRef(false);
    const lastLogIndexRef = useRef(0);
    const lastIngressIdRef = useRef("");

    const appendTimeline = (
        kind: MeetingTimelineItem["kind"],
        text: string,
    ) => {
        setTimelineItems((prev) => {
            const next: MeetingTimelineItem = {
                id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
                at: Date.now(),
                kind,
                text,
            };
            return [next, ...prev].slice(0, 120);
        });
    };

    useEffect(() => {
        if (joined) {
            lastLogIndexRef.current = logs.length;
            return;
        }
        lastLogIndexRef.current = logs.length;
        lastIngressIdRef.current = "";
        memberSnapshotRef.current.clear();
        memberSnapshotReadyRef.current = false;
        setTimelineItems([]);
    }, [joined]);

    useEffect(() => {
        if (!joined) return;
        const nextSnapshot = new Map<string, { mic: boolean; camera: boolean; screen: boolean }>();
        for (const member of members) {
            nextSnapshot.set(member.identity, {
                mic: member.micEnabled,
                camera: member.cameraEnabled,
                screen: member.screenShareEnabled,
            });
        }
        if (!memberSnapshotReadyRef.current) {
            memberSnapshotRef.current = nextSnapshot;
            memberSnapshotReadyRef.current = true;
            return;
        }

        const prevSnapshot = memberSnapshotRef.current;
        for (const member of members) {
            const prev = prevSnapshot.get(member.identity);
            if (!prev) {
                appendTimeline("presence", `${member.identity} 加入语音`);
                continue;
            }
            if (prev.mic !== member.micEnabled) {
                appendTimeline("audio", `${member.identity}${member.micEnabled ? " 上麦" : " 静音"}`);
            }
            if (prev.camera !== member.cameraEnabled) {
                appendTimeline("video", `${member.identity}${member.cameraEnabled ? " 打开摄像头" : " 关闭摄像头"}`);
            }
            if (prev.screen !== member.screenShareEnabled) {
                appendTimeline("video", `${member.identity}${member.screenShareEnabled ? " 开启投屏" : " 关闭投屏"}`);
            }
        }
        for (const identity of prevSnapshot.keys()) {
            if (!nextSnapshot.has(identity)) {
                appendTimeline("presence", `${identity} 离开语音`);
            }
        }
        memberSnapshotRef.current = nextSnapshot;
    }, [joined, members]);

    useEffect(() => {
        if (!joined) return;
        const prev = lastIngressIdRef.current.trim();
        const next = ingressId.trim();
        if (!prev && next) {
            appendTimeline("broadcast", `${userName} 开始广播`);
        } else if (prev && !next) {
            appendTimeline("broadcast", `${userName} 停止广播`);
        }
        lastIngressIdRef.current = next;
    }, [joined, ingressId, userName]);

    useEffect(() => {
        if (!joined) return;
        const start = lastLogIndexRef.current;
        if (start >= logs.length) return;
        const freshLogs = logs.slice(start);
        lastLogIndexRef.current = logs.length;
        for (const raw of freshLogs) {
            const text = raw.replace(/^\[[^\]]+\]\s*/, "");
            if (text.startsWith("mute all applied")) {
                appendTimeline("moderation", "主持人开启全员静音");
                continue;
            }
            if (text.startsWith("unmute all applied")) {
                appendTimeline("moderation", "主持人解除全员静音");
                continue;
            }
            const muteOne = text.match(/^mute\s+(.+?)\s+\(/i);
            if (muteOne) {
                appendTimeline("moderation", `主持人静音 ${muteOne[1]}`);
                continue;
            }
            const unmuteOne = text.match(/^unmute\s+(.+?)\s+\(/i);
            if (unmuteOne) {
                appendTimeline("moderation", `主持人解除静音 ${unmuteOne[1]}`);
                continue;
            }
            const stagePermission = text.match(/^(allow|deny)\s+(camera|screen_share)\s+(.+?)\s+\(/i);
            if (stagePermission) {
                const action = stagePermission[1].toLowerCase() === "allow" ? "允许" : "关闭";
                const feature = stagePermission[2].toLowerCase() === "camera" ? "摄像头" : "投屏";
                appendTimeline("moderation", `主持人${action} ${stagePermission[3]} 的${feature}`);
            }
        }
    }, [joined, logs]);

    const requiresInviteCode = (requireInvite || inviteMode) && effectiveRole === "member";
    const canJoin = Boolean(roomId.trim() && userName.trim()) && (!requiresInviteCode || Boolean(inviteCode.trim() && inviteTicket.trim()));
    const myUserName = userName.trim();

    const retryFailedMessage = async (message: MessageItem) => {
        if (!onRetryMessage || !message.failed) return;
        const key = message.client_id ? `client:${message.client_id}` : `id:${message.id}`;
        if (retryingMessageKey === key) return;
        setRetryingMessageKey(key);
        try {
            await onRetryMessage(message);
        } finally {
            setRetryingMessageKey("");
        }
    };

    const avatarEditorDialogRef = useRef<HTMLDivElement>(null);
    const inviteGateDialogRef = useRef<HTMLDivElement>(null);
    const joinDialogRef = useRef<HTMLDivElement>(null);
    const whipDialogRef = useRef<HTMLDivElement>(null);

    const avatarEditorUploadButtonRef = useRef<HTMLButtonElement>(null);
    const roomIdInputRef = useRef<HTMLInputElement>(null);
    const inviteGateHostButtonRef = useRef<HTMLButtonElement>(null);
    const inviteGateGuestButtonRef = useRef<HTMLButtonElement>(null);
    const whipDialogCloseButtonRef = useRef<HTMLButtonElement>(null);

    const sidebarInstanceId = useId();
    const consolePanelId = `${sidebarInstanceId}-sidebar-console-control-panel`;
    const membersSectionId = `${sidebarInstanceId}-sidebar-members-section`;
    const chatSectionId = `${sidebarInstanceId}-sidebar-chat-section`;
    const chatMessageListId = `${sidebarInstanceId}-sidebar-chat-message-list`;
    const logsSectionId = `${sidebarInstanceId}-sidebar-logs-section`;
    const timelineSectionId = `${sidebarInstanceId}-sidebar-timeline-section`;
    const chatInputId = `${sidebarInstanceId}-sidebar-chat-input`;
    const membersListId = `${sidebarInstanceId}-sidebar-members-list`;
    const chatUnreadHintId = `${sidebarInstanceId}-sidebar-chat-unread-hint`;
    const opsPanelId = `${sidebarInstanceId}-sidebar-console-ops-panel`;
    const avatarEditorTitleId = `${sidebarInstanceId}-avatar-editor-title`;
    const inviteGateTitleId = `${sidebarInstanceId}-invite-gate-title`;
    const joinDialogTitleId = `${sidebarInstanceId}-join-dialog-title`;
    const whipDialogTitleId = `${sidebarInstanceId}-whip-dialog-title`;
    const consoleTabControlId = `${sidebarInstanceId}-sidebar-tab-control`;
    const consoleTabMembersId = `${sidebarInstanceId}-sidebar-tab-members`;
    const consoleTabOpsId = `${sidebarInstanceId}-sidebar-tab-ops`;
    const joinRoomInputId = `${sidebarInstanceId}-join-room-id`;
    const joinUserNameInputId = `${sidebarInstanceId}-join-user-name`;
    const joinInviteCodeInputId = `${sidebarInstanceId}-join-invite-code`;
    const joinInviteTicketInputId = `${sidebarInstanceId}-join-invite-ticket`;
    const joinHostTotpInputId = `${sidebarInstanceId}-join-host-totp`;

    useDialogFocus({
        isOpen: avatarEditorOpen,
        rootRef: avatarEditorDialogRef,
        onClose: () => setAvatarEditorOpen(false),
        getInitialFocus: () => avatarEditorUploadButtonRef.current,
    });

    useDialogFocus({
        isOpen: showInviteGate,
        rootRef: inviteGateDialogRef,
        getInitialFocus: () => inviteGateHostButtonRef.current ?? inviteGateGuestButtonRef.current,
    });

    useDialogFocus({
        isOpen: !joined && !showInviteGate,
        rootRef: joinDialogRef,
        getInitialFocus: () => roomIdInputRef.current,
    });

    useDialogFocus({
        isOpen: showBroadcastModal,
        rootRef: whipDialogRef,
        onClose: () => setShowBroadcastModal(false),
        getInitialFocus: () => whipDialogCloseButtonRef.current,
    });

    return (
        <>
            <OrnamentFrame className="paper-grain mucha-surface flex h-full min-h-0 flex-col gap-3 shadow-mucha">
                <section className="px-5 pt-5 pb-0 flex flex-col shrink-0">
                    <div className="flex items-center justify-between gap-2">
                        <div>
                            <h2 className="font-display text-sm font-bold text-ink tracking-wide uppercase">Command Center</h2>
                            <p className="text-xs font-mono text-ink/50 mt-0.5">
                                {joined ? `CH/${roomId} · ${joined.role.toUpperCase()}` : "STANDBY"}
                            </p>
                        </div>
                        {joined ? (
                            <button
                                type="button"
                                aria-label="离开房间"
                                onClick={() => run(leaveRoom)}
                                className="inline-flex min-h-11 items-center gap-2 rounded-chip border border-ink/10 bg-canvas/60 px-3 py-2 text-sm text-ink/70 transition-colors ease-mucha hover:border-gold/50"
                            >
                                <LogOut size={16} /> Leave
                            </button>
                        ) : null}
                    </div>
                    <OrnateDivider className="mt-4 mb-2" />
                </section>

                <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-4 pb-4 [-webkit-overflow-scrolling:touch]">
                    <section className="px-4 py-2 shrink-0">
                        <p className="px-1 font-display text-[10px] font-bold uppercase tracking-[0.16em] text-ink/45 mb-2">Navigator</p>
                        <div className="mt-2 grid grid-cols-3 gap-2" role="tablist" aria-label="侧边栏面板导航">
                            <button
                                type="button"
                                role="tab"
                                aria-label="切换到控制面板"
                                id={consoleTabControlId}
                                aria-selected={consolePane === "control"}
                                aria-controls={consolePanelId}
                                tabIndex={consolePane === "control" ? 0 : -1}
                                onClick={() => setConsolePane("control")}
                                className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-chip px-2 py-2 text-xs transition-colors ease-mucha ${consolePane === "control"
                                    ? "border border-gold/55 bg-ink/6 text-ink/70"
                                    : "border border-ink/15 mucha-panel text-ink/65 hover:border-ink/12"
                                    }`}
                            >
                                <SlidersHorizontal size={12} /> 控制
                            </button>
                            <button
                                type="button"
                                role="tab"
                                aria-label="切换到成员列表"
                                id={consoleTabMembersId}
                                aria-selected={consolePane === "members"}
                                aria-controls={membersSectionId}
                                tabIndex={consolePane === "members" ? 0 : -1}
                                onClick={() => setConsolePane("members")}
                                className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-chip px-2 py-2 text-xs transition-colors ease-mucha ${consolePane === "members"
                                    ? "border border-gold/55 bg-ink/6 text-ink/70"
                                    : "border border-ink/15 mucha-panel text-ink/65 hover:border-ink/12"
                                    }`}
                            >
                                <Users size={12} /> 成员
                            </button>
                            <button
                                type="button"
                                role="tab"
                                aria-label="切换到系统面板"
                                id={consoleTabOpsId}
                                aria-selected={consolePane === "ops"}
                                aria-controls={opsPanelId}
                                tabIndex={consolePane === "ops" ? 0 : -1}
                                onClick={() => setConsolePane("ops")}
                                className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-chip px-2 py-2 text-xs font-medium transition-colors ease-mucha ${consolePane === "ops"
                                    ? "border border-gold/55 bg-ink/6 text-ink/70"
                                    : "border border-ink/15 mucha-panel text-ink/65 hover:border-ink/12"
                                    }`}
                            >
                                <Terminal size={12} /> 系统
                            </button>
                        </div>
                    </section>

                    {joined && consolePane === "control" && !isHost ? (
                        <section
                            id={consolePanelId}
                            role="tabpanel"
                            aria-labelledby={consoleTabControlId}
                            className="rounded-panel border border-ink/8 bg-canvas/60 p-3"
                        >
                            <h3 className="mb-2 font-display text-sm font-semibold text-ink">Profile</h3>
                            <div className="flex items-center gap-3 rounded-chip border border-ink/10 bg-parchment/50 px-3 py-2">
                                <div className="h-10 w-10 overflow-hidden rounded-full border border-ink/10 bg-canvas/60">
                                    {avatarPreview ? (
                                        <img src={resolveAvatarSrc(avatarPreview)} alt="avatar" className="h-full w-full object-cover" />
                                    ) : (
                                        <div className="grid h-full w-full place-items-center text-ink/50">
                                            <Image size={14} />
                                        </div>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    aria-label="打开个人页头像上传"
                                    onClick={onPickAvatar}
                                    className="inline-flex items-center gap-2 rounded-chip border border-ink/10 mucha-panel px-3 py-2 text-sm text-ink/70 transition-colors ease-mucha hover:border-gold/50"
                                >
                                    <ImagePlus size={16} /> 上传头像
                                </button>
                            </div>
                            <p
                                role="status"
                                aria-live="polite"
                                aria-atomic="true"
                                className={`mt-2 font-mono text-[11px] ${avatarStatus.kind === "ok"
                                    ? "text-teal"
                                    : avatarStatus.kind === "error"
                                        ? "text-coral"
                                        : "text-ink/45"
                                    }`}
                            >
                                {avatarStatus.text}
                            </p>
                        </section>
                    ) : null}

                    {actionNotice ? (
                        <section
                            role="status"
                            aria-live="polite"
                            aria-atomic="true"
                            className={`rounded-panel border px-3 py-2 font-body text-sm ${actionNotice.kind === "ok"
                                ? "border-teal/40 bg-teal/10 text-teal"
                                : "border-coral/40 bg-coral/12 text-coral"
                                }`}
                        >
                            {actionNotice.text}
                        </section>
                    ) : null}

                    {joined ? (
                        <section
                            role="status"
                            aria-live="polite"
                            aria-atomic="true"
                            className={`rounded-panel border px-3 py-2 ${sessionConnectionStatus === "connected"
                                ? "border-teal/35 bg-teal/10 text-teal"
                                : sessionConnectionStatus === "reconnecting"
                                    ? "border-gold/45 bg-gold/10 text-gold"
                                    : "border-coral/40 bg-coral/12 text-coral"
                                }`}
                        >
                            <div className="flex items-center justify-between gap-2">
                                <p className="font-mono text-xs">
                                    连接状态
                                </p>
                                <span className="font-mono text-xs">
                                    {sessionConnectionStatus === "connected"
                                        ? "已连接"
                                        : sessionConnectionStatus === "reconnecting"
                                            ? `重连中${sessionReconnectInSeconds > 0 ? ` (${sessionReconnectInSeconds}s)` : ""}`
                                            : "已断开"}
                                </span>
                            </div>
                            {sessionConnectionStatus !== "connected" ? (
                                <div className="mt-2 grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        aria-label="立即尝试恢复连接"
                                        onClick={retrySessionRecovery}
                                        className="rounded-chip border border-ink/15 bg-canvas/70 px-2 py-1.5 text-xs text-ink/75 transition-colors ease-mucha hover:border-ink/12"
                                    >
                                        重新连接
                                    </button>
                                    <button
                                        type="button"
                                        aria-label={isHost ? "重新加入并重新验证主持身份" : "重新加入房间"}
                                        onClick={rejoinSession}
                                        className="rounded-chip border border-coral/40 bg-coral/12 px-2 py-1.5 text-xs text-coral transition-colors ease-mucha hover:bg-coral/18"
                                    >
                                        重新加入
                                    </button>
                                </div>
                            ) : null}
                        </section>
                    ) : null}

                    {isHost && consolePane === "control" ? (
                        <section
                            id={consolePanelId}
                            role="tabpanel"
                            aria-labelledby={consoleTabControlId}
                            className="rounded-panel border border-ink/8 bg-canvas/60 p-3"
                        >
                            <h3 className="mb-2 font-display text-sm font-semibold text-ink">主持工具</h3>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    aria-label="复制邀请链接"
                                    onClick={() => run(issueInvite)}
                                    className="inline-flex items-center justify-center gap-2 rounded-chip border border-ink/10 mucha-panel px-3 py-2 text-sm text-ink/70 transition-colors ease-mucha hover:border-ink/15"
                                >
                                    <UserPlus size={16} /> 复制邀请
                                </button>
                                <button
                                    type="button"
                                    aria-label="开始广播"
                                    onClick={() => run(startBroadcast)}
                                    className="inline-flex items-center justify-center gap-2 rounded-chip bg-gold px-3 py-2 text-sm font-semibold text-canvas transition-colors ease-mucha hover:bg-gold/85"
                                >
                                    <Radio size={16} /> Broadcast
                                </button>
                                <button
                                    type="button"
                                    aria-label="停止广播"
                                    onClick={() => run(stopBroadcast)}
                                    className="col-span-2 inline-flex items-center justify-center gap-2 rounded-chip bg-coral/80 px-3 py-2 text-sm text-canvas transition-colors ease-mucha hover:bg-coral/70"
                                >
                                    <CircleStop size={16} /> Stop Broadcast
                                </button>
                                <button
                                    type="button"
                                    aria-label="静音所有成员"
                                    onClick={() => run(() => muteAll(true))}
                                    className="inline-flex items-center justify-center gap-2 rounded-chip border border-ink/10 mucha-panel px-3 py-2 text-sm text-ink/70 transition-colors ease-mucha hover:border-ink/15"
                                >
                                    全员静音
                                </button>
                                <button
                                    type="button"
                                    aria-label="解除所有成员静音"
                                    onClick={() => run(() => muteAll(false))}
                                    className="inline-flex items-center justify-center gap-2 rounded-chip border border-ink/10 mucha-panel px-3 py-2 text-sm text-ink/70 transition-colors ease-mucha hover:border-ink/15"
                                >
                                    解除全员静音
                                </button>
                            </div>
                            {inviteCopied ? (
                                <div
                                    role="status"
                                    aria-live="polite"
                                    aria-atomic="true"
                                    className="mt-2 inline-flex items-center gap-2 rounded-chip border border-teal/50 bg-teal/12 px-3 py-1 text-xs text-teal"
                                >
                                    <Copy size={14} /> 复制成功
                                </div>
                            ) : null}
                            <div className="mt-3 rounded-chip border border-ink/10 bg-parchment/45 p-2">
                                <div className="mb-2 flex items-center justify-between gap-2">
                                    <p className="font-display text-xs font-semibold text-ink/70">邀请码管理</p>
                                    <button
                                        type="button"
                                        aria-label="刷新邀请码列表"
                                        onClick={() => run(refreshInviteList)}
                                        className="inline-flex items-center gap-1 rounded-chip border border-ink/12 bg-canvas/60 px-2 py-1 text-[11px] text-ink/65 hover:border-ink/15"
                                    >
                                        <RefreshCw size={12} />
                                        刷新
                                    </button>
                                </div>
                                {inviteListLoading ? (
                                    <p role="status" aria-live="polite" className="font-mono text-[11px] text-ink/45">加载中...</p>
                                ) : !inviteItems.length ? (
                                    <p role="status" aria-live="polite" className="font-mono text-[11px] text-ink/45">当前无可用邀请码</p>
                                ) : (
                                    <div className="max-h-36 space-y-2 overflow-y-auto pr-1">
                                        {inviteItems.map((item) => (
                                            <div
                                                key={item.invite_ticket}
                                                className="rounded-chip border border-ink/10 bg-canvas/65 px-2 py-2 text-[11px]"
                                            >
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="font-mono text-ink/70">
                                                        code {item.invite_code}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        aria-label={`作废邀请码 ${item.invite_code}`}
                                                        onClick={() => run(() => revokeInvite(item.invite_ticket))}
                                                        className="inline-flex items-center gap-1 rounded-chip border border-coral/40 bg-coral/12 px-2 py-1 text-coral hover:bg-coral/18"
                                                    >
                                                        <Trash2 size={11} />
                                                        作废
                                                    </button>
                                                </div>
                                                <p className="mt-1 font-mono text-ink/50">
                                                    剩余 {item.remaining_uses} 次 · {inviteExpiryHint(item.expires_at)}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </section>
                    ) : null}

                    {consolePane === "members" ? (
                        <section
                            id={membersSectionId}
                            role="tabpanel"
                            aria-labelledby={consoleTabMembersId}
                            className="flex-1 min-h-0 overflow-y-auto px-2 py-2 flex flex-col gap-2"
                        >
                            {/* Members list */}
                            <button
                                type="button"
                                aria-label={openMembers ? "折叠成员列表" : "展开成员列表"}
                                aria-expanded={openMembers}
                                aria-controls={membersListId}
                                onClick={() => setOpenMembers((v) => !v)}
                                className="flex w-full items-center justify-between text-left font-display text-xs font-bold uppercase tracking-wider text-ink/50 hover:text-ink/80 px-2 py-1 transition-colors ease-mucha"
                            >
                                <span>Voice Connected - {members.length}</span>
                                {openMembers ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                            {openMembers ? (
                                <div id={membersListId} className="max-h-36 space-y-2 overflow-auto pr-1">
                                    {members.map((m) => (
                                        <div
                                            key={m.identity}
                                            className={`animate-slide-in rounded-chip border border-ink/8 mucha-panel px-3 py-2 ${m.speaking ? "ripple-active" : ""
                                                }`}
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="truncate text-sm text-ink">{m.identity}{m.isLocal ? " (me)" : ""}</span>
                                                <span className="inline-flex shrink-0 items-center gap-1 text-xs text-ink/50">
                                                    {m.micEnabled ? <Mic size={12} /> : <MicOff size={12} />}
                                                    {m.speaking ? "speaking" : m.micEnabled ? "on" : "muted"}
                                                </span>
                                            </div>
                                            {isHost && !m.isLocal ? (
                                                <div className="mt-2 grid grid-cols-3 gap-1">
                                                    <button
                                                        type="button"
                                                        aria-label={m.micEnabled ? `禁用 ${m.identity} 麦克风` : `开启 ${m.identity} 麦克风`}
                                                        onClick={() => run(() => muteOne(m.identity, m.micEnabled))}
                                                        className="rounded-chip bg-canvas/60 border border-ink/8 px-2 py-1 text-[11px] text-ink/65 transition-colors ease-mucha hover:border-ink/12"
                                                    >
                                                        {m.micEnabled ? "静音" : "解除"}
                                                    </button>
                                                    {m.cameraEnabled ? (
                                                        <button
                                                            type="button"
                                                            aria-label={`禁用 ${m.identity} 摄像头`}
                                                            onClick={() => run(() => setMemberMediaPermission(m.identity, "camera", false))}
                                                            className="rounded-chip border border-coral/35 bg-coral/15 px-2 py-1 text-[11px] text-coral"
                                                        >
                                                            关摄
                                                        </button>
                                                    ) : (
                                                        <span className="rounded-chip border border-ink/12 mucha-panel px-2 py-1 text-[11px] text-ink/40">
                                                            摄像头未开
                                                        </span>
                                                    )}
                                                    {m.screenShareEnabled ? (
                                                        <button
                                                            type="button"
                                                            aria-label={`禁用 ${m.identity} 屏幕共享`}
                                                            onClick={() => run(() => setMemberMediaPermission(m.identity, "screen_share", false))}
                                                            className="rounded-chip border border-coral/35 bg-coral/15 px-2 py-1 text-[11px] text-coral"
                                                        >
                                                            关屏
                                                        </button>
                                                    ) : (
                                                        <span className="rounded-chip border border-ink/12 mucha-panel px-2 py-1 text-[11px] text-ink/40">
                                                            投屏未开
                                                        </span>
                                                    )}
                                                </div>
                                            ) : null}
                                        </div>
                                    ))}
                                </div>
                            ) : null}
                        </section>
                    ) : null}

                    <section className={`min-h-0 flex-1 space-y-3 ${hideDesktopChat ? "lg:flex-none" : ""}`}>
                        <div
                            className={`min-h-0 flex-1 flex flex-col rounded-panel border border-ink/8 mucha-panel p-2 ${hideChatSectionCompletely ? "hidden" : hideDesktopChat ? "hidden" : ""
                                }`}
                        >
                            <button
                                type="button"
                                aria-label={openChat ? "收起聊天面板" : "展开聊天面板"}
                                aria-expanded={openChat}
                                aria-controls={chatSectionId}
                                onClick={() => setOpenChat((v) => !v)}
                                className="flex w-full items-center justify-between text-left font-display text-xs font-bold uppercase tracking-wider text-ink/50 hover:text-ink/80 px-2 py-1 transition-colors ease-mucha mb-2"
                            >
                                <span className="inline-flex items-center gap-2">
                                    <MessageCircle size={14} /> Chat
                                    {chatPriorityMode ? (
                                        <span className="rounded-chip border border-ink/15 bg-ink/6 px-2 py-0.5 text-[10px] font-medium text-ink/70">
                                            Focus
                                        </span>
                                    ) : null}
                                </span>
                                {openChat ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            </button>
                            {openChat ? (
                                <div
                                    className={`flex min-h-0 flex-col flex-1`}
                                >
                                    <div id={chatSectionId} className="relative min-h-0 flex-1">
                                        <label htmlFor={chatInputId} className="sr-only">发送侧边栏聊天消息</label>
                                        <div
                                            id={chatMessageListId}
                                            ref={chatScrollRef}
                                            onScroll={onChatScroll}
                                            role="log"
                                            aria-live="polite"
                                            aria-atomic="true"
                                            className="h-full min-h-0 space-y-2 overflow-y-auto pr-1"
                                        >
                                            {!messages.length ? (
                                                <div className="grid h-full place-items-center rounded-chip border border-dashed border-ink/10 mucha-panel px-3 font-body text-sm text-ink/40">
                                                    暂无消息，发送第一条开始聊天
                                                </div>
                                            ) : (
                                                messages.map((m) => (
                                                    <ChatMessageRow
                                                        key={m.client_id ?? m.id}
                                                        message={m}
                                                        currentUserName={myUserName}
                                                        variant="sidebar"
                                                        onRetry={onRetryMessage && m.failed && m.user_name === myUserName
                                                            ? () => {
                                                                run(() => retryFailedMessage(m));
                                                            }
                                                            : undefined}
                                                        retrying={retryingMessageKey === (m.client_id ? `client:${m.client_id}` : `id:${m.id}`)}
                                                    />
                                                ))
                                            )}
                                        </div>
                                        <span id={chatUnreadHintId} className="sr-only">
                                            {pendingChatHints > 0 ? `${pendingChatHints > 1 ? `${pendingChatHints} 条未读消息` : "1 条未读消息"}` : "当前无未读消息"}
                                        </span>
                                        {pendingChatHints > 0 ? (
                                            <>
                                                <button
                                                    type="button"
                                                    aria-label={pendingChatHints > 1 ? `${pendingChatHints} 条未读消息，点击回到最新` : "1 条未读消息，点击回到最新"}
                                                    onClick={() => scrollChatToBottom("smooth")}
                                                    aria-controls={chatMessageListId}
                                                    aria-describedby={chatUnreadHintId}
                                                    className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-chip border border-gold/50 bg-parchment/90 px-3 py-1 text-xs font-medium text-gold shadow-gold-glow backdrop-blur-md"
                                                >
                                                    {pendingChatHints > 1 ? `${pendingChatHints} 条新消息` : "1 条新消息"}，点击查看
                                                </button>
                                            </>
                                        ) : null}
                                    </div>
                                    <div className="mt-2 flex items-center gap-2 rounded-chip border border-ink/10 bg-parchment/50 p-1.5">
                                        <input
                                            id={chatInputId}
                                            value={chatText}
                                            onChange={(e) => setChatText(e.target.value)}
                                            aria-label="发送侧边栏聊天消息"
                                            aria-describedby={chatUnreadHintId}
                                            placeholder="输入消息，按 Enter 发送"
                                            onKeyDown={(e) => {
                                                const keyboard = e.nativeEvent as KeyboardEvent;
                                                if (e.key === "Enter" && !e.shiftKey && !keyboard.isComposing) {
                                                    e.preventDefault();
                                                    run(sendChat);
                                                }
                                            }}
                                            className="min-w-0 flex-1 bg-transparent px-2 py-2 font-body text-sm text-ink outline-none placeholder:text-ink/35"
                                        />
                                        <button
                                            type="button"
                                            aria-label={chatText.trim() ? "发送侧边栏聊天消息" : "请输入聊天内容后发送"}
                                            aria-describedby={chatUnreadHintId}
                                            onClick={() => run(sendChat)}
                                            disabled={!chatText.trim()}
                                            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-chip bg-gold leading-none text-canvas font-semibold disabled:cursor-not-allowed disabled:opacity-40 transition-all ease-mucha hover:bg-gold/85 hover:shadow-gold-glow press-feedback"
                                        >
                                            <Send size={16} />
                                        </button>
                                    </div>
                                </div>
                            ) : null}
                        </div>

                        <div
                            id={opsPanelId}
                            role="tabpanel"
                            aria-labelledby={consoleTabOpsId}
                            className={`rounded-panel border border-ink/8 mucha-panel p-3 ${consolePane === "ops" ? "" : "xl:hidden"}`}
                        >
                            <p className="mb-2 font-display text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/50">Visual Theme</p>
                            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="界面主题模式">
                                {(["system", "light", "twilight", "dark"] as ThemeMode[]).map((mode) => (
                                    <button
                                        key={mode}
                                        type="button"
                                        role="radio"
                                        aria-label={`切换主题：${mode}`}
                                        aria-checked={themeMode === mode}
                                        onClick={() => setThemeMode(mode)}
                                        className={`rounded-chip border px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide transition-colors ease-mucha ${themeMode === mode
                                            ? "border-gold/55 bg-ink/8 text-ink/70"
                                            : "border-ink/15 mucha-panel text-ink/65 hover:border-ink/12"
                                            }`}
                                    >
                                        {mode}
                                    </button>
                                ))}
                            </div>
                            <p className="mt-2 text-[11px] text-ink/50">
                                active: <span className="font-mono text-ink/75">{resolvedTheme}</span>
                            </p>
                        </div>

                        <div className={`rounded-panel border border-ink/8 mucha-panel p-3 ${consolePane === "ops" ? "" : "xl:hidden"}`}>
                            <button
                                type="button"
                                aria-label={openLogs ? "折叠系统日志" : "展开系统日志"}
                                aria-expanded={openLogs}
                                aria-controls={logsSectionId}
                                onClick={() => setOpenLogs((v) => !v)}
                                className="mb-2 flex w-full items-center justify-between text-left font-display text-sm font-semibold text-ink"
                            >
                                <span>Logs</span>
                                {openLogs ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            </button>
                            {openLogs ? (
                                <div id={logsSectionId} className="font-mono max-h-40 space-y-1 overflow-auto text-[11px] text-ink/65">
                                    {logs.map((line, idx) => (
                                        <p key={`${line}-${idx}`}>{line}</p>
                                    ))}
                                </div>
                            ) : (
                                <p className="font-mono text-xs text-ink/40">点击展开查看系统日志</p>
                            )}
                        </div>

                        <div className={`rounded-panel border border-ink/8 mucha-panel p-3 ${consolePane === "ops" ? "" : "xl:hidden"}`}>
                            <button
                                type="button"
                                aria-label={openTimeline ? "折叠会议事件时间线" : "展开会议事件时间线"}
                                aria-expanded={openTimeline}
                                aria-controls={timelineSectionId}
                                onClick={() => setOpenTimeline((v) => !v)}
                                className="mb-2 flex w-full items-center justify-between text-left font-display text-sm font-semibold text-ink"
                            >
                                <span>Timeline</span>
                                {openTimeline ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                            </button>
                            {openTimeline ? (
                                <div
                                    id={timelineSectionId}
                                    role="log"
                                    aria-live="polite"
                                    aria-relevant="additions text"
                                    className="max-h-44 space-y-2 overflow-y-auto pr-1"
                                >
                                    {!timelineItems.length ? (
                                        <p className="font-mono text-xs text-ink/40">暂无会议事件</p>
                                    ) : (
                                        timelineItems.map((item) => (
                                            <div
                                                key={item.id}
                                                className="rounded-chip border border-ink/10 bg-canvas/65 px-2 py-2 text-xs"
                                            >
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="inline-flex min-w-0 items-center gap-1.5 text-ink/70">
                                                        {item.kind === "presence" ? <Users size={12} /> : null}
                                                        {item.kind === "audio" ? <Mic size={12} /> : null}
                                                        {item.kind === "video" ? <Image size={12} /> : null}
                                                        {item.kind === "broadcast" ? <Radio size={12} /> : null}
                                                        {item.kind === "moderation" ? <ShieldCheck size={12} /> : null}
                                                        <span className="truncate">{item.text}</span>
                                                    </div>
                                                    <span className="shrink-0 font-mono text-[10px] text-ink/45">
                                                        {new Date(item.at).toLocaleTimeString()}
                                                    </span>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            ) : (
                                <p className="font-mono text-xs text-ink/40">点击展开查看关键事件</p>
                            )}
                        </div>
                    </section>
                </div>

                {/* Bottom Anchor: User Status */}
                {joined ? (
                    <div className="shrink-0 bg-rail rounded-chip p-2 flex items-center justify-between">
                        <button
                            type="button"
                            aria-label="打开头像编辑器"
                            aria-pressed={avatarEditorOpen}
                            onClick={openAvatarEditor}
                            className="flex min-w-0 items-center gap-2 overflow-hidden rounded-chip px-1 py-1 text-left transition-colors ease-mucha hover:mucha-panel"
                        >
                            <div className="relative h-8 w-8 shrink-0 rounded-full mucha-panel border border-ink/10 overflow-hidden">
                                {avatarPreview ? (
                                    <img src={resolveAvatarSrc(avatarPreview)} alt="me" className="h-full w-full object-cover" />
                                ) : (
                                    <div className="grid h-full w-full place-items-center font-display text-xs font-bold text-ink/60">
                                        {userName.slice(0, 1).toUpperCase()}
                                    </div>
                                )}
                                {/* Status indicator */}
                                <div className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-teal border-2 border-rail"></div>
                            </div>
                            <div className="flex flex-col min-w-0 pr-1 text-left">
                                <span className="truncate text-xs font-bold text-ink">{userName}</span>
                                <span className="truncate text-[10px] items-center gap-1 text-ink/50">
                                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${joined.role === "host" ? "bg-gold" : "bg-ink/30"} mr-1`}></span>
                                    {joined.role}
                                </span>
                            </div>
                        </button>

                        <div className="inline-flex items-center gap-1 rounded-chip border border-ink/8 mucha-panel px-2 py-1 text-[10px] text-ink/45">
                            媒体控制在主舞台区域
                        </div>
                    </div>
                ) : null}
            </OrnamentFrame>

            {joined && avatarEditorOpen ? (
                <div
                    className="fixed inset-0 z-[72] grid place-items-center bg-ink/55 p-4"
                    onClick={() => setAvatarEditorOpen(false)}
                >
                    <section
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby={avatarEditorTitleId}
                        ref={avatarEditorDialogRef}
                        tabIndex={-1}
                        className="w-full max-w-sm rounded-panel border border-ink/10 bg-parchment/95 p-4 shadow-mucha backdrop-blur-md"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between gap-2">
                            <h3 id={avatarEditorTitleId} className="text-sm font-semibold">修改头像</h3>
                            <button
                                type="button"
                                aria-label="关闭头像编辑器"
                                onClick={() => setAvatarEditorOpen(false)}
                                className="rounded-chip border border-ink/8 mucha-panel px-2 py-1 text-xs text-ink/65 hover:border-ink/12"
                            >
                                关闭
                            </button>
                        </div>
                        <div className="mt-3 flex items-center gap-3 rounded-chip border border-ink/10 mucha-panel px-3 py-3">
                            <div className="h-12 w-12 overflow-hidden rounded-full border border-ink/10 mucha-panel">
                                {avatarPreview ? (
                                    <img src={resolveAvatarSrc(avatarPreview)} alt="avatar preview" className="h-full w-full object-cover" />
                                ) : (
                                    <div className="grid h-full w-full place-items-center text-ink/50">
                                        <Image size={16} />
                                    </div>
                                )}
                            </div>
                            <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-ink">{userName}</p>
                                <p className="text-xs text-ink/45">点击下方按钮选择新头像</p>
                            </div>
                        </div>
                        <p
                            role="status"
                            aria-live="polite"
                            aria-atomic="true"
                            className={`mt-2 font-mono text-[11px] ${avatarStatus.kind === "ok"
                                ? "text-ok"
                                : avatarStatus.kind === "error"
                                    ? "text-coral"
                                    : "text-ink/40"
                                }`}
                        >
                            {avatarStatus.text}
                        </p>
                        <button
                            type="button"
                            aria-label="选择并上传头像"
                            onClick={onPickAvatar}
                            className="mt-3 w-full rounded-chip bg-gold px-3 py-2 text-sm font-semibold text-canvas"
                        >
                            选择并上传头像
                        </button>
                    </section>
                </div>
            ) : null}

            {showInviteGate ? (
                <div className="fixed inset-0 z-50 grid place-items-center bg-ink/60 p-4">
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby={inviteGateTitleId}
                        ref={inviteGateDialogRef}
                        tabIndex={-1}
                        className="w-full max-w-lg rounded-panel border border-ink/10 bg-parchment/95 p-5 shadow-mucha backdrop-blur-md"
                    >
                        <h2 id={inviteGateTitleId} className="text-xl font-semibold">Enter Ivena Meet</h2>
                        <p className="mt-1 text-sm text-ink/50">
                            需要邀请链接才能进入房间。若你是主持人，请走主持人入口。
                        </p>
                        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <button
                                type="button"
                                ref={inviteGateHostButtonRef}
                                onClick={() => setHostEntryUnlocked(true)}
                                aria-label="切换到主持人模式加入"
                                className="rounded-chip bg-gold px-3 py-2 font-semibold text-canvas"
                            >
                                主持人入口
                            </button>
                            <button
                                type="button"
                                ref={inviteGateGuestButtonRef}
                                onClick={() => window.location.reload()}
                                aria-label="使用邀请码地址重新进入"
                                className="rounded-chip border border-ink/10 mucha-panel px-3 py-2 text-ink"
                            >
                                我有邀请链接
                            </button>
                        </div>
                        <p className="mt-3 text-xs text-ink/40">
                            邀请模式请使用包含 room/ticket 参数的完整链接打开。
                        </p>
                    </div>
                </div>
            ) : null}

            {!joined && !showInviteGate ? (
                <div className="fixed inset-0 z-50 grid place-items-center bg-ink/60 p-4">
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby={joinDialogTitleId}
                        ref={joinDialogRef}
                        tabIndex={-1}
                        className="w-full max-w-lg rounded-panel border border-ink/10 bg-parchment/95 p-5 shadow-mucha backdrop-blur-md"
                    >
                        <h2 id={joinDialogTitleId} className="text-xl font-semibold">
                            Enter Ivena Meet
                        </h2>
                        <p className="mt-1 text-sm text-ink/50">先完成鉴权和房间配置，才能继续进入会话。</p>

                        <div className="mt-4 space-y-2">
                            <label htmlFor={joinRoomInputId} className="sr-only">房间名</label>
                            <input
                                id={joinRoomInputId}
                                value={roomId}
                                onChange={(e) => setRoomId(e.target.value)}
                                ref={roomIdInputRef}
                                aria-label="房间名"
                                placeholder="room_id"
                                className="w-full rounded-chip border border-ink/10 mucha-panel px-3 py-2 text-ink"
                            />
                            <label htmlFor={joinUserNameInputId} className="sr-only">用户名</label>
                            <input
                                id={joinUserNameInputId}
                                value={userName}
                                onChange={(e) => setUserName(e.target.value)}
                                aria-label="用户名"
                                placeholder="name"
                                className="w-full rounded-chip border border-ink/10 mucha-panel px-3 py-2 text-ink"
                            />

                            {effectiveRole === "member" ? (
                                <>
                                    <div className="flex items-center gap-3 rounded-chip border border-ink/10 mucha-panel px-3 py-2">
                                        <div className="h-10 w-10 overflow-hidden rounded-full border border-ink/10 mucha-panel">
                                            {avatarPreview ? (
                                                <img src={resolveAvatarSrc(avatarPreview)} alt="avatar" className="h-full w-full object-cover" />
                                            ) : (
                                                <div className="grid h-full w-full place-items-center text-ink/50">
                                                    <Image size={14} />
                                                </div>
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={onPickAvatar}
                                            className="inline-flex items-center gap-2 rounded-chip border border-ink/10 mucha-panel px-3 py-2 text-sm text-ink/65"
                                        >
                                            <ImagePlus size={16} /> 上传头像
                                        </button>
                                    </div>
                                    <p
                                        role="status"
                                        aria-live="polite"
                                        aria-atomic="true"
                                        className={`font-mono text-[11px] ${avatarStatus.kind === "ok"
                                            ? "text-ok"
                                            : avatarStatus.kind === "error"
                                                ? "text-coral"
                                                : "text-ink/40"
                                            }`}
                                    >
                                        {avatarStatus.text}
                                    </p>
                                </>
                            ) : (
                                <p className="font-mono text-[11px] text-ink/40">
                                    主持人模式默认沿用已保存头像。
                                </p>
                            )}

                            {hostEntryUnlocked ? (
                                <div className="flex items-center justify-between gap-2 rounded-chip border border-ink/10 mucha-panel px-3 py-2 text-sm text-ink/65">
                                    <span>host mode</span>
                                    <button
                                        type="button"
                                        aria-label="提交新的加入请求"
                                        onClick={() => setHostEntryUnlocked(false)}
                                        className="rounded-chip border border-ink/8 mucha-panel px-2 py-1 text-xs text-ink/65"
                                    >
                                        切回成员
                                    </button>
                                </div>
                            ) : !inviteMode ? (
                                <div className="flex items-center justify-between gap-2 rounded-chip border border-ink/10 mucha-panel px-3 py-2 text-sm text-ink/65">
                                    <span>member mode</span>
                                    <button
                                        type="button"
                                        aria-label="切换到主持人入口"
                                        onClick={() => setHostEntryUnlocked(true)}
                                        className="rounded-chip bg-gold/90 px-2 py-1 text-xs font-semibold text-canvas"
                                    >
                                        主持人入口
                                    </button>
                                </div>
                            ) : (
                                <div className="flex items-center justify-between gap-2 rounded-chip border border-ink/10 mucha-panel px-3 py-2 text-sm text-ink/65">
                                    <span>invite mode: member</span>
                                    <button
                                        type="button"
                                        aria-label="切换到主持人入口"
                                        onClick={() => setHostEntryUnlocked(true)}
                                        className="rounded-chip bg-gold/90 px-2 py-1 text-xs font-semibold text-canvas"
                                    >
                                        主持人入口
                                    </button>
                                </div>
                            )}

                            {(requireInvite || inviteMode) && effectiveRole === "member" ? (
                                <>
                                    <div className="relative">
                                        <Ticket size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/40" />
                                        <label htmlFor={joinInviteCodeInputId} className="sr-only">邀请码 code</label>
                                        <input
                                            id={joinInviteCodeInputId}
                                            value={inviteCode}
                                            onChange={(e) => setInviteCode(e.target.value)}
                                            aria-label="invite_code"
                                            placeholder="invite_code"
                                            className="w-full rounded-chip border border-ink/10 mucha-panel py-2 pl-9 pr-3 text-ink"
                                        />
                                    </div>
                                    <label htmlFor={joinInviteTicketInputId} className="sr-only">邀请 ticket</label>
                                    <input
                                        id={joinInviteTicketInputId}
                                        value={inviteTicket}
                                        onChange={(e) => setInviteTicket(e.target.value)}
                                        aria-label="invite_ticket"
                                        placeholder="invite_ticket"
                                        className="font-mono w-full rounded-chip border border-ink/10 mucha-panel px-3 py-2 text-ink text-xs"
                                    />
                                </>
                            ) : null}

                            {effectiveRole === "host" ? (
                                <>
                                    <div className="relative">
                                        <ShieldCheck size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/40" />
                                        <label htmlFor={joinHostTotpInputId} className="sr-only">TOTP 动态码（6位）</label>
                                        <input
                                            id={joinHostTotpInputId}
                                            value={hostTotpCode}
                                            onChange={(e) => setHostTotpCode(e.target.value)}
                                            aria-label="TOTP 动态码（6位）"
                                            type="password"
                                            placeholder="TOTP 动态码（6位）"
                                            className="font-mono w-full rounded-chip border border-ink/10 mucha-panel py-2 pl-9 pr-3 text-ink text-xs"
                                        />
                                    </div>
                                    <p className="font-mono text-[11px] text-ink/40">
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
                            type="button"
                            disabled={joining || !canJoin}
                            aria-busy={joining}
                            aria-label={joining ? "正在加入房间" : canJoin ? "加入房间" : "请补全必填信息后加入"}
                            onClick={() => run(joinRoom)}
                            className="mt-4 w-full rounded-chip bg-gold px-3 py-2 font-semibold text-canvas disabled:opacity-60 press-feedback"
                        >
                            {joining ? (
                                <span className="inline-flex items-center gap-2"><span className="mucha-spinner" /><span>Joining...</span></span>
                            ) : canJoin ? "Join Room" : "请先填写必填项"}
                        </button>

                        {effectiveRole === "host" && showReclaimCta ? (
                            <button
                                type="button"
                                disabled={reclaiming}
                                aria-label={reclaiming ? "正在回收旧会话" : "房间被占用，回收后重试"}
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
                <div className="fixed inset-0 z-[60] grid place-items-center bg-ink/50 p-4">
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby={whipDialogTitleId}
                        ref={whipDialogRef}
                        tabIndex={-1}
                        className="w-full max-w-xl rounded-panel border border-ink/10 bg-parchment/95 p-4 shadow-mucha backdrop-blur-md"
                    >
                        <h3 id={whipDialogTitleId} className="mb-3 text-lg font-semibold">WHIP Broadcast Credentials</h3>
                        <div className="font-mono space-y-2 text-xs">
                            <div className="rounded-chip border border-ink/8 mucha-panel p-2">
                                <p className="mb-1 text-ink/50">obs_whip_endpoint</p>
                                <p className="break-all">{obsWhipEndpoint || "-"}</p>
                            </div>
                            <div className="rounded-chip border border-ink/8 mucha-panel p-2">
                                <p className="mb-1 text-ink/50">whip_url</p>
                                <p className="break-all">{whipUrl || "-"}</p>
                            </div>
                            <div className="rounded-chip border border-ink/8 mucha-panel p-2">
                                <p className="mb-1 text-ink/50">stream_key</p>
                                <p className="break-all">{streamKey || "-"}</p>
                            </div>
                            <div className="rounded-chip border border-ink/8 mucha-panel p-2">
                                <p className="mb-1 text-ink/50">ingress_id</p>
                                <p className="break-all">{ingressId || "-"}</p>
                            </div>
                        </div>
                        <p className="mt-3 text-xs text-ink/60">
                            OBS 推荐直接填 <span className="font-mono">obs_whip_endpoint</span>。如果使用该完整地址，
                            不需要再单独填写 Bearer Token。
                        </p>
                        <p className="mt-2 text-xs text-ink/60">
                            防回声建议：OBS 只保留“桌面/窗口 + 系统音频”，不要添加麦克风音源；
                            麦克风请使用本页面的语音按钮单独上麦。
                        </p>
                            <button
                                type="button"
                                ref={whipDialogCloseButtonRef}
                                aria-label="关闭广播信息"
                                onClick={() => setShowBroadcastModal(false)}
                                className="mt-3 w-full rounded-chip bg-gold px-3 py-2 font-semibold text-canvas"
                            >
                                关闭
                            </button>
                    </div>
                </div>
            ) : null}
            <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                aria-label="头像文件上传"
                onChange={(e) => onAvatarFileChange(e.target.files?.[0])}
                className="hidden"
            />
        </>
    );
}

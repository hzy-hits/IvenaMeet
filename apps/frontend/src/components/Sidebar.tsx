import type { Dispatch, SetStateAction } from "react";
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
    resolveAvatarSrc,
} from "../lib/avatar";
import type { ResolvedTheme, ThemeMode } from "../lib/theme";
import type { JoinResp, MemberItem, MessageItem, RealtimeChatPayload, Role } from "../lib/types";
import { ChatMessageRow } from "./chat/ChatMessageRow";
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
    chatPriorityMode?: boolean;
    hideDesktopChat?: boolean;
    hideChatSectionCompletely?: boolean;
    enableBootReconnect?: boolean;
    themeMode: ThemeMode;
    resolvedTheme: ResolvedTheme;
    setThemeMode: (v: ThemeMode) => void;
};

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
        startBroadcast,
        stopBroadcast,
        muteAll,
        muteOne,
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

    useSessionState({
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

    return (
        <>
      <aside className="hidden h-full min-h-0 flex-col gap-3 overflow-hidden rounded-[26px] border border-white/10 bg-[linear-gradient(180deg,rgba(18,35,48,0.92),rgba(10,20,28,0.88))] p-3 shadow-[0_20px_70px_rgba(0,0,0,0.35)] backdrop-blur-md lg:flex lg:p-4">
                <section className="bg-bg-panel p-4 flex flex-col shrink-0 border-b border-bg-light">
                    <div className="flex items-center justify-between gap-2">
                        <div>
                            <h2 className="text-sm font-bold text-white tracking-wide uppercase">Command Center</h2>
                            <p className="text-xs font-mono text-gray-400 mt-0.5">
                                {joined ? `CH/${roomId} · ${joined.role.toUpperCase()}` : "STANDBY"}
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

                <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
                <section className="px-4 py-2 shrink-0">
                    <p className="px-1 text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500 mb-2">Navigator</p>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                        <button
                            type="button"
                            onClick={() => setConsolePane("control")}
                            className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs ${consolePane === "control"
                                ? "border border-accent/45 bg-accent/12 text-accent"
                                : "border border-white/10 bg-white/5 text-white/70"
                                }`}
                        >
                            <SlidersHorizontal size={12} /> 控制
                        </button>
                        <button
                            type="button"
                            onClick={() => setConsolePane("members")}
                            className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs ${consolePane === "members"
                                ? "border border-accent/45 bg-accent/12 text-accent"
                                : "border border-white/10 bg-white/5 text-white/70"
                                }`}
                        >
                            <Users size={12} /> 成员
                        </button>
                        <button
                            type="button"
                            onClick={() => setConsolePane("ops")}
                            className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium transition-colors ${consolePane === "ops"
                                ? "bg-bg-light text-white"
                                : "bg-transparent text-gray-400 hover:bg-bg-light/50 hover:text-gray-200"
                                }`}
                        >
                            <Terminal size={12} /> 系统
                        </button>
                    </div>
                </section>

                {joined && consolePane === "control" && !isHost ? (
                    <section className="rounded-2xl border border-white/10 bg-card/80 p-3 backdrop-blur-md">
                        <h3 className="mb-2 text-sm font-semibold">Profile</h3>
                        <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                            <div className="h-10 w-10 overflow-hidden rounded-full border border-white/20 bg-black/30">
                                {avatarPreview ? (
                                    <img src={resolveAvatarSrc(avatarPreview)} alt="avatar" className="h-full w-full object-cover" />
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
                        </div>
                        <p
                            className={`mt-2 font-mono text-[11px] ${avatarStatus.kind === "ok"
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
                        className={`rounded-2xl border px-3 py-2 text-sm ${actionNotice.kind === "ok"
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
                    <section className="flex-1 min-h-0 overflow-y-auto px-2 py-2 flex flex-col gap-2">
                        {/* Members list (which will later hold videos) */}
                        <button
                            onClick={() => setOpenMembers((v) => !v)}
                            className="flex w-full items-center justify-between text-left text-xs font-bold uppercase tracking-wider text-gray-400 hover:text-gray-200 px-2 py-1 transition-colors"
                        >
                            <span>Voice Connected - {members.length}</span>
                            {openMembers ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                        {openMembers ? (
                            <div className="max-h-36 space-y-2 overflow-auto pr-1">
                                {members.map((m) => (
                                    <div
                                        key={m.identity}
                                        className={`flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2 ${m.speaking ? "ring-1 ring-ok shadow-[0_0_10px_#7edb8f]" : ""
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
                        className={`min-h-0 flex-1 flex flex-col rounded-xl border border-white/5 bg-black/20 p-2 ${
                            hideChatSectionCompletely ? "hidden" : hideDesktopChat ? "xl:hidden" : ""
                        }`}
                    >
                        <button
                            onClick={() => setOpenChat((v) => !v)}
                            className="flex w-full items-center justify-between text-left text-xs font-bold uppercase tracking-wider text-gray-400 hover:text-gray-200 px-2 py-1 transition-colors mb-2"
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
                                className={`flex min-h-0 flex-col flex-1`}
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
                                            messages.map((m) => (
                                                <ChatMessageRow
                                                    key={m.client_id ?? m.id}
                                                    message={m}
                                                    currentUserName={userName}
                                                    variant="sidebar"
                                                />
                                            ))
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

                    <div className={`rounded-xl border border-white/5 bg-black/20 p-3 ${consolePane === "ops" ? "" : "xl:hidden"}`}>
                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/60">Visual Theme</p>
                        <div className="grid grid-cols-3 gap-2">
                            {(["system", "dark", "light"] as ThemeMode[]).map((mode) => (
                                <button
                                    key={mode}
                                    type="button"
                                    onClick={() => setThemeMode(mode)}
                                    className={`rounded-lg border px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide ${
                                        themeMode === mode
                                            ? "border-accent/45 bg-accent/15 text-accent"
                                            : "border-white/15 bg-white/5 text-white/75 hover:bg-white/10"
                                    }`}
                                >
                                    {mode}
                                </button>
                            ))}
                        </div>
                        <p className="mt-2 text-[11px] text-white/55">
                            active: <span className="font-mono text-white/80">{resolvedTheme}</span>
                        </p>
                    </div>

                    <div className={`rounded-xl border border-white/5 bg-black/20 p-3 ${consolePane === "ops" ? "" : "xl:hidden"}`}>
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
                </div>

                {/* Bottom Anchor: User Status & Media Controls (Discord Style) */}
                {joined ? (
                    <div className="shrink-0 bg-bg-dark rounded-xl p-2 flex items-center justify-between shadow-inner">
                        <button
                            type="button"
                            onClick={openAvatarEditor}
                            className="flex min-w-0 items-center gap-2 overflow-hidden rounded-lg px-1 py-1 text-left transition hover:bg-white/5"
                            title="修改头像"
                        >
                            <div className="relative h-8 w-8 shrink-0 rounded-full bg-black/40 border border-white/10 overflow-hidden">
                                {avatarPreview ? (
                                    <img src={resolveAvatarSrc(avatarPreview)} alt="me" className="h-full w-full object-cover" />
                                ) : (
                                    <div className="grid h-full w-full place-items-center text-xs font-bold text-white/70">
                                        {userName.slice(0, 1).toUpperCase()}
                                    </div>
                                )}
                                {/* Status indicator */}
                                <div className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-ok border-2 border-bg-dark"></div>
                            </div>
                            <div className="flex flex-col min-w-0 pr-1 text-left">
                                <span className="truncate text-xs font-bold text-gray-200">{userName}</span>
                                <span className="truncate text-[10px] items-center gap-1 text-gray-400">
                                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${joined.role === 'host' ? 'bg-accent' : 'bg-gray-500'} mr-1`}></span>
                                    {joined.role}
                                </span>
                            </div>
                        </button>

                        <div className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-black/25 px-2 py-1 text-[10px] text-white/55">
                            媒体控制在主舞台区域
                        </div>
                    </div>
                ) : null}
            </aside>

            {joined && avatarEditorOpen ? (
                <div
                    className="fixed inset-0 z-[72] grid place-items-center bg-black/65 p-4"
                    onClick={() => setAvatarEditorOpen(false)}
                >
                    <section
                        className="w-full max-w-sm rounded-2xl border border-white/10 bg-card/90 p-4 backdrop-blur-md"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between gap-2">
                            <h3 className="text-sm font-semibold">修改头像</h3>
                            <button
                                type="button"
                                onClick={() => setAvatarEditorOpen(false)}
                                className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/75 hover:bg-white/10"
                            >
                                Close
                            </button>
                        </div>
                        <div className="mt-3 flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-3">
                            <div className="h-12 w-12 overflow-hidden rounded-full border border-white/20 bg-black/30">
                                {avatarPreview ? (
                                    <img src={resolveAvatarSrc(avatarPreview)} alt="avatar preview" className="h-full w-full object-cover" />
                                ) : (
                                    <div className="grid h-full w-full place-items-center text-white/60">
                                        <Image size={16} />
                                    </div>
                                )}
                            </div>
                            <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-white">{userName}</p>
                                <p className="text-xs text-white/55">点击下方按钮选择新头像</p>
                            </div>
                        </div>
                        <p
                            className={`mt-2 font-mono text-[11px] ${avatarStatus.kind === "ok"
                                ? "text-ok"
                                : avatarStatus.kind === "error"
                                    ? "text-red-300"
                                    : "text-white/50"
                                }`}
                        >
                            {avatarStatus.text}
                        </p>
                        <button
                            type="button"
                            onClick={onPickAvatar}
                            className="mt-3 w-full rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-[#06211f]"
                        >
                            选择并上传头像
                        </button>
                    </section>
                </div>
            ) : null}

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
                                                <img src={resolveAvatarSrc(avatarPreview)} alt="avatar" className="h-full w-full object-cover" />
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
                                    </div>
                                    <p
                                        className={`font-mono text-[11px] ${avatarStatus.kind === "ok"
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
                                    主持人模式默认沿用已保存头像。
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
            <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => onAvatarFileChange(e.target.files?.[0])}
                className="hidden"
            />
        </>
    );
}

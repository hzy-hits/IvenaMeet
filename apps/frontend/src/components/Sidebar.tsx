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
  Radio,
  Send,
  Ticket,
  UserPlus,
} from "lucide-react";
import {
  AVATAR_MAX_BYTES,
  CHAT_HISTORY_LIMIT,
  INVITE_COPY_HINT_MS,
  SESSION_REFRESH_BEFORE_SECONDS,
  SESSION_REFRESH_POLL_MS,
} from "../lib/env";
import type { JoinResp, MemberItem, MessageItem, Role } from "../lib/types";

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
  setJoined: (v: JoinResp | null) => void;
  setAppSessionToken: (v: string) => void;
  setHostSessionToken: (v: string) => void;
  members: MemberItem[];
  messages: MessageItem[];
  setMessages: Dispatch<SetStateAction<MessageItem[]>>;
  logs: string[];
  pushLog: (s: string) => void;
};

const LS_KEYS = {
  joined: "ivena.meet.joined",
  appSessionToken: "ivena.meet.app_session_token",
  hostSessionToken: "ivena.meet.host_session_token",
} as const;

function parseInviteFromQuery() {
  const q = new URLSearchParams(window.location.search);
  return {
    room: q.get("room") ?? "",
    ticket: q.get("ticket") ?? "",
  };
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
    setJoined,
    setAppSessionToken,
    setHostSessionToken,
    members,
    messages,
    setMessages,
    logs,
    pushLog,
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
  const [actionNotice, setActionNotice] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);

  const [openMembers, setOpenMembers] = useState(true);
  const [openChat, setOpenChat] = useState(true);
  const [openLogs, setOpenLogs] = useState(false);
  const [hostEntryUnlocked, setHostEntryUnlocked] = useState(false);

  const [avatarPreview, setAvatarPreview] = useState<string>("");
  const [avatarStatus, setAvatarStatus] = useState<{
    kind: "idle" | "ok" | "error";
    text: string;
  }>({ kind: "idle", text: "未上传，使用默认头像" });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initialReconnectChecked = useRef(false);
  const inviteMode = Boolean(inviteTicket);
  const effectiveRole: Role = inviteMode ? "member" : hostEntryUnlocked ? "host" : role;
  const showInviteGate = !joined && !inviteMode && !hostEntryUnlocked;
  const isHost = useMemo(
    () => (joined?.role ?? effectiveRole) === "host",
    [joined?.role, effectiveRole],
  );

  const showActionNotice = (kind: "ok" | "error", text: string) => {
    setActionNotice({ kind, text });
    window.setTimeout(() => setActionNotice(null), 2600);
  };

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
    if (initialReconnectChecked.current) return;
    initialReconnectChecked.current = true;
    if (!joined) return;

    void api
      .reconnectRoom()
      .then((res) => {
        setJoined({ ...joined, ...res });
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
    setJoined(null);
    setAppSessionToken("");
    setHostSessionToken("");
    setHostTotpCode("");
    setHostSessionExpireAt(0);
    setSessionExpireAt(0);
    setMessages([]);
    localStorage.removeItem(LS_KEYS.joined);
    localStorage.removeItem(LS_KEYS.appSessionToken);
    localStorage.removeItem(LS_KEYS.hostSessionToken);
    pushLog("left room");
  };

  const joinRoom = async () => {
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

      const res = await api.join({
        room_id: roomId.trim(),
        user_name: userName.trim(),
        role: effectiveRole,
        nickname: userName.trim(),
        redeem_token: token || undefined,
      }, joinAuthToken);

      setJoined(res);
      setAppSessionToken(res.app_session_token);
      setHostSessionToken(res.host_session_token ?? "");
      if (res.host_session_token && res.host_session_expires_in_seconds) {
        setHostSessionExpireAt(Math.floor(Date.now() / 1000) + res.host_session_expires_in_seconds);
      }
      setSessionExpireAt(Math.floor(Date.now() / 1000) + res.app_session_expires_in_seconds);
      pushLog(`joined: ${userName} (${res.role})`);
    } finally {
      setJoining(false);
    }
  };

  const issueInvite = async () => {
    const payload = await api.issueInvite({
      room_id: roomId.trim(),
      host_identity: userName.trim(),
    });

    const msg = `房间链接：${payload.invite_url}\n邀请码：${payload.invite_code}\n有效期：24小时`;
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
    setWhipUrl(started.whip_url);
    setStreamKey(started.stream_key);
    setShowBroadcastModal(true);
    pushLog("broadcast started");
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
  };

  const muteOne = async (targetIdentity: string, muted: boolean) => {
    const res = await api.muteMember({
      room_id: roomId.trim(),
      host_identity: userName.trim(),
      target_identity: targetIdentity,
      muted,
    });
    pushLog(`${muted ? "mute" : "unmute"} ${targetIdentity} (${res.affected_tracks})`);
  };

  const sendChat = async () => {
    const text = chatText.trim();
    if (!text || !joined) return;
    await api.createMessage(roomId.trim(), { text });
    const next = await api.listMessages(roomId.trim(), CHAT_HISTORY_LIMIT);
    setMessages(next.items);
    setChatText("");
  };

  const onPickAvatar = () => fileInputRef.current?.click();

  const onAvatarFileChange = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setAvatarPreview("");
      setAvatarStatus({ kind: "error", text: "上传失败：仅支持图片，已使用默认头像" });
      pushLog("avatar upload failed: only image files are allowed, using default avatar");
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setAvatarPreview("");
      setAvatarStatus({ kind: "error", text: "上传失败：图片超过 2MB，已使用默认头像" });
      pushLog("avatar upload failed: file must be <= 2MB, using default avatar");
      return;
    }
    const url = URL.createObjectURL(file);
    setAvatarPreview(url);
    setAvatarStatus({ kind: "ok", text: "头像已选择（当前为本地预览）" });
    pushLog("avatar selected");
  };

  const run = (fn: () => Promise<void>) => {
    void fn().catch((e) => {
      const message = e instanceof Error ? e.message : String(e);
      pushLog(message);
      showActionNotice("error", message);
    });
  };

  return (
    <>
      <aside className="flex h-[calc(100vh-1.5rem)] min-h-0 flex-col gap-3 overflow-x-hidden overflow-y-auto rounded-2xl bg-card p-3 lg:p-4">
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

        {isHost ? (
          <section className="rounded-2xl border border-white/10 bg-card/80 p-3 backdrop-blur-md">
            <h3 className="mb-2 text-sm font-semibold">Host Tools</h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => run(issueInvite)}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-[#06211f]"
              >
                <UserPlus size={16} /> Issue Invite
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

        <section className="min-h-0 flex-1 space-y-3">
          <div className="min-h-0 rounded-2xl border border-white/10 bg-card/80 p-3 backdrop-blur-md">
            <button
              onClick={() => setOpenChat((v) => !v)}
              className="mb-2 flex w-full items-center justify-between text-left text-sm font-semibold"
            >
              <span className="inline-flex items-center gap-2"><MessageCircle size={14} /> Chat</span>
              {openChat ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
            {openChat ? (
              <div className="flex h-[300px] min-h-0 flex-col">
                <div className="min-h-0 flex-1 space-y-2 overflow-auto pr-1">
                  {messages.map((m) => (
                    <div key={m.id} className="rounded-xl border border-white/10 bg-black/20 p-2">
                      <p className="text-xs text-white/60">{m.nickname} ({m.role})</p>
                      <p className="text-sm break-words">{m.text}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    value={chatText}
                    onChange={(e) => setChatText(e.target.value)}
                    placeholder="type message"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") run(sendChat);
                    }}
                    className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2"
                  />
                  <button
                    onClick={() => run(sendChat)}
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent leading-none text-[#06211f]"
                  >
                    <Send size={16} />
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
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
                      accept="image/*"
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
              ) : null}

              {hostEntryUnlocked ? (
                <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/70">
                  host mode
                </div>
              ) : !inviteMode ? (
                <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/70">
                  member mode
                </div>
              ) : (
                <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/70">
                  invite mode: member
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
          </div>
        </div>
      ) : null}

      {showBroadcastModal ? (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4">
          <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-card/80 p-4 backdrop-blur-md">
            <h3 className="mb-3 text-lg font-semibold">WHIP Broadcast Credentials</h3>
            <div className="font-mono space-y-2 text-xs">
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

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleStop,
  Copy,
  ImagePlus,
  LogOut,
  MessageCircle,
  Mic,
  MicOff,
  Radio,
  Send,
  Shield,
  Ticket,
  UserPlus,
} from "lucide-react";
import type { JoinResp, MemberItem, MessageItem, Role } from "../lib/types";

type ApiClient = ReturnType<typeof import("../lib/api").createApi>;

type Props = {
  requireInvite: boolean;
  api: ApiClient;
  adminToken: string;
  setAdminToken: (v: string) => void;
  roomId: string;
  setRoomId: (v: string) => void;
  userName: string;
  setUserName: (v: string) => void;
  avatarUrl: string;
  setAvatarUrl: (v: string) => void;
  role: Role;
  setRole: (v: Role) => void;
  joined: JoinResp | null;
  setJoined: (v: JoinResp | null) => void;
  setAppSessionToken: (v: string) => void;
  members: MemberItem[];
  messages: MessageItem[];
  setMessages: Dispatch<SetStateAction<MessageItem[]>>;
  logs: string[];
  pushLog: (s: string) => void;
};

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
    adminToken,
    setAdminToken,
    roomId,
    setRoomId,
    userName,
    setUserName,
    avatarUrl,
    setAvatarUrl,
    role,
    setRole,
    joined,
    setJoined,
    setAppSessionToken,
    members,
    messages,
    setMessages,
    logs,
    pushLog,
  } = props;

  const [inviteCode, setInviteCode] = useState("");
  const [inviteTicket, setInviteTicket] = useState("");
  const [redeemToken, setRedeemToken] = useState("");
  const [chatText, setChatText] = useState("");
  const [inviteCopied, setInviteCopied] = useState(false);
  const [sessionExpireAt, setSessionExpireAt] = useState(0);
  const [ingressId, setIngressId] = useState("");
  const [whipUrl, setWhipUrl] = useState("");
  const [streamKey, setStreamKey] = useState("");
  const [showBroadcastModal, setShowBroadcastModal] = useState(false);
  const [joining, setJoining] = useState(false);

  const [openMembers, setOpenMembers] = useState(true);
  const [openChat, setOpenChat] = useState(true);
  const [openLogs, setOpenLogs] = useState(false);

  const [avatarPreview, setAvatarPreview] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const parsed = parseInviteFromQuery();
    if (parsed.room) setRoomId(parsed.room);
    if (parsed.ticket) {
      setInviteTicket(parsed.ticket);
      setRole("member");
    }
  }, [setRoomId, setRole]);

  useEffect(() => {
    if (!joined) return;
    api
      .listMessages(roomId, 80)
      .then((res) => setMessages(res.items))
      .catch((e) => pushLog(`history error: ${String(e)}`));
  }, [joined, roomId, api, setMessages, pushLog]);

  useEffect(() => {
    if (!joined || !sessionExpireAt) return;
    const timer = window.setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      if (now >= sessionExpireAt - 120) {
        void api
          .refreshSession()
          .then((res) => {
            setAppSessionToken(res.app_session_token);
            setSessionExpireAt(now + res.app_session_expires_in_seconds);
            pushLog("app session refreshed");
          })
          .catch((e) => pushLog(`session refresh failed: ${String(e)}`));
      }
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [joined, sessionExpireAt, api, setAppSessionToken, pushLog]);

  const inviteMode = Boolean(inviteTicket);
  const effectiveRole: Role = inviteMode ? "member" : role;
  const isHost = useMemo(
    () => (joined?.role ?? effectiveRole) === "host",
    [joined?.role, effectiveRole],
  );

  const leaveRoom = async () => {
    setJoined(null);
    setAppSessionToken("");
    setSessionExpireAt(0);
    setMessages([]);
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

      const res = await api.join({
        room_id: roomId.trim(),
        user_name: userName.trim(),
        role: effectiveRole,
        nickname: userName.trim(),
        avatar_url: avatarUrl.trim() || undefined,
        redeem_token: token || undefined,
      });

      setJoined(res);
      setAppSessionToken(res.app_session_token);
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
    window.setTimeout(() => setInviteCopied(false), 1800);
    pushLog("invite issued and copied");
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
  };

  const stopBroadcast = async () => {
    if (!ingressId.trim()) throw new Error("ingress_id required");
    await api.stopBroadcast({ ingress_id: ingressId.trim() });
    pushLog("broadcast stopped");
  };

  const sendChat = async () => {
    const text = chatText.trim();
    if (!text || !joined) return;
    await api.createMessage(roomId.trim(), { text });
    const next = await api.listMessages(roomId.trim(), 80);
    setMessages(next.items);
    setChatText("");
  };

  const onPickAvatar = () => fileInputRef.current?.click();

  const onAvatarFileChange = (file?: File) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setAvatarPreview(url);
    pushLog("avatar selected (local preview only)");
  };

  const run = (fn: () => Promise<void>) => {
    void fn().catch((e) => pushLog(String(e)));
  };

  return (
    <>
      <aside className="flex h-[calc(100vh-1.5rem)] min-h-0 flex-col gap-3 overflow-hidden rounded-2xl bg-card p-3 lg:p-4">
        <section className="rounded-2xl border border-white/10 bg-card/80 p-3 backdrop-blur-md">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">Command Center</h2>
              <p className="text-xs text-white/60">{roomId} · {joined?.role ?? effectiveRole}</p>
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
                  <span className="inline-flex items-center gap-1 text-xs text-white/60">
                    {m.micEnabled ? <Mic size={12} /> : <MicOff size={12} />}
                    {m.speaking ? "speaking" : "idle"}
                  </span>
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
                <div className="mt-2 flex gap-2">
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
                    className="inline-flex rounded-xl bg-accent px-3 py-2 text-[#06211f]"
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

      {!joined ? (
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

              <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                <div className="h-10 w-10 overflow-hidden rounded-full border border-white/20 bg-black/30">
                  {avatarPreview ? <img src={avatarPreview} alt="avatar" className="h-full w-full object-cover" /> : null}
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
              <input
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                placeholder="avatar_url (optional https://...)"
                className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2"
              />
              <p className="font-mono text-[11px] text-white/50">说明：当前后端只持久化 https 头像 URL；上传按钮用于本地预览。</p>

              {!inviteMode ? (
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as Role)}
                  className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2"
                >
                  <option value="member">member</option>
                  <option value="host">host</option>
                </select>
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
                <div className="relative">
                  <Shield size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/50" />
                  <input
                    value={adminToken}
                    onChange={(e) => setAdminToken(e.target.value)}
                    type="password"
                    placeholder="ADMIN_TOKEN"
                    className="font-mono w-full rounded-xl border border-white/10 bg-black/20 py-2 pl-9 pr-3 text-xs"
                  />
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

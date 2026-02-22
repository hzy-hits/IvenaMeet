import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  CircleStop,
  Copy,
  MessageCircle,
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
  nickname: string;
  setNickname: (v: string) => void;
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
    nickname,
    setNickname,
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

  useEffect(() => {
    const parsed = parseInviteFromQuery();
    if (parsed.room) setRoomId(parsed.room);
    if (parsed.ticket) setInviteTicket(parsed.ticket);
  }, []);

  useEffect(() => {
    if (!joined) return;
    api
      .listMessages(roomId, 80)
      .then((res) => setMessages(res.items))
      .catch((e) => pushLog(`history error: ${String(e)}`));
  }, [joined, roomId]);

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
  }, [joined, sessionExpireAt]);

  const isHost = useMemo(() => joined?.role === "host" || role === "host", [joined?.role, role]);

  const joinRoom = async () => {
    let token = redeemToken.trim();

    if (requireInvite && role === "member" && !token) {
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
      role,
      nickname: nickname.trim() || userName.trim(),
      avatar_url: avatarUrl.trim() || undefined,
      redeem_token: token || undefined,
    });

    setJoined(res);
    setAppSessionToken(res.app_session_token);
    setSessionExpireAt(Math.floor(Date.now() / 1000) + res.app_session_expires_in_seconds);
    pushLog(`joined: ${userName} (${res.role})`);
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
      participant_name: nickname.trim() || userName.trim(),
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

  const run = (fn: () => Promise<void>) => {
    void fn().catch((e) => pushLog(String(e)));
  };

  return (
    <aside className="flex h-[calc(100vh-1.5rem)] flex-col gap-3 overflow-hidden rounded-2xl bg-card p-3 lg:p-4">
      <section className="rounded-2xl border border-white/10 bg-card/80 p-3 backdrop-blur-md">
        <h2 className="mb-2 text-sm font-semibold">Command Center</h2>

        <div className="space-y-2">
          <input
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            placeholder="room_id"
            className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2"
          />
          <input
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            placeholder="user_name"
            className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2"
          />
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="nickname"
            className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2"
          />
          <input
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            placeholder="avatar_url (https://...)"
            className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2"
          />

          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2"
          >
            <option value="member">member</option>
            <option value="host">host</option>
          </select>

          {requireInvite && role === "member" ? (
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

          <button
            onClick={() => run(joinRoom)}
            className="w-full rounded-xl bg-accent px-3 py-2 font-semibold text-[#06211f]"
          >
            Join
          </button>
        </div>
      </section>

      {isHost ? (
        <section className="rounded-2xl border border-white/10 bg-card/80 p-3 backdrop-blur-md">
          <h3 className="mb-2 text-sm font-semibold">Admin Flow</h3>
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

      <section className="hidden min-h-0 flex-1 flex-col gap-3 overflow-hidden lg:flex">
        <div className="rounded-2xl border border-white/10 bg-card/80 p-3 backdrop-blur-md">
          <h3 className="mb-2 text-sm font-semibold">Members ({members.length})</h3>
          <div className="max-h-40 space-y-2 overflow-auto pr-1">
            {members.map((m) => (
              <div
                key={m.identity}
                className={`flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2 ${
                  m.speaking ? "ring-1 ring-ok shadow-[0_0_10px_#7edb8f]" : ""
                }`}
              >
                <span className="truncate text-sm">{m.identity}{m.isLocal ? " (me)" : ""}</span>
                <span className="text-xs text-white/60">{m.speaking ? "speaking" : "idle"}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 rounded-2xl border border-white/10 bg-card/80 p-3 backdrop-blur-md">
          <h3 className="mb-2 inline-flex items-center gap-2 text-sm font-semibold"><MessageCircle size={14} /> Chat</h3>
          <div className="max-h-44 space-y-2 overflow-auto pr-1">
            {messages.map((m) => (
              <div key={m.id} className="rounded-xl border border-white/10 bg-black/20 p-2">
                <p className="text-xs text-white/60">{m.nickname} ({m.role})</p>
                <p className="text-sm">{m.text}</p>
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

        <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
          <h3 className="mb-2 text-sm font-semibold">Logs</h3>
          <div className="font-mono max-h-24 space-y-1 overflow-auto text-[11px] text-white/75">
            {logs.map((line, idx) => (
              <p key={`${line}-${idx}`}>{line}</p>
            ))}
          </div>
        </div>
      </section>

      {showBroadcastModal ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-4">
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
    </aside>
  );
}

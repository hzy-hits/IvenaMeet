import {
  DataPacket_Kind,
  Room,
  RoomEvent,
  Track,
  type LocalParticipant,
  type Participant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type TrackPublication,
} from "livekit-client";
import { useMemo, useState } from "react";
import { useEffect, useRef } from "react";

type Role = "host" | "member";

type JoinResp = {
  lk_url: string;
  token: string;
  role: Role;
  expires_in_seconds: number;
  app_session_token: string;
  app_session_expires_in_seconds: number;
};

type IssueInviteResp = {
  invite_code: string;
  invite_ticket: string;
  invite_url: string;
};

type RedeemResp = {
  redeem_token: string;
};

type RefreshSessionResp = {
  app_session_token: string;
  app_session_expires_in_seconds: number;
};

type IssueStartResp = {
  start_token: string;
};

type StartBroadcastResp = {
  whip_url: string;
  stream_key: string;
  ingress_id: string;
};

type Message = {
  id?: number;
  room_id?: string;
  user_name: string;
  nickname: string;
  avatar_url?: string | null;
  role: Role;
  text: string;
  created_at: number;
};

type Tile = {
  key: string;
  identity: string;
  kind: string;
  track: Track;
};

type Member = {
  identity: string;
  isLocal: boolean;
  speaking: boolean;
};

function nowTs() {
  return Math.floor(Date.now() / 1000);
}

function fmtTime(ts: number) {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function TrackView({ tile }: { tile: Tile }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = tile.track.attach();
    node.autoplay = true;
    node.playsInline = true;
    if (tile.track.kind === Track.Kind.Audio) {
      node.style.height = "36px";
    }
    ref.current?.appendChild(node);

    return () => {
      tile.track.detach().forEach((n) => n.remove());
    };
  }, [tile]);

  return <div className="track-slot" ref={ref} />;
}

export function App() {
  const [apiBase, setApiBase] = useState("/api");
  const [roomId, setRoomId] = useState("test");
  const [userName, setUserName] = useState("guest");
  const [nickname, setNickname] = useState("Guest");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [inviteTicket, setInviteTicket] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [redeemToken, setRedeemToken] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [adminToken, setAdminToken] = useState("");
  const [startToken, setStartToken] = useState("");
  const [ingressId, setIngressId] = useState("");
  const [whipUrl, setWhipUrl] = useState("");
  const [streamKey, setStreamKey] = useState("");

  const [connected, setConnected] = useState(false);
  const [identityText, setIdentityText] = useState("Not connected");
  const [logs, setLogs] = useState<string[]>([]);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [sessionExpireAt, setSessionExpireAt] = useState(0);

  const roomRef = useRef<Room | null>(null);
  const currentRole = useRef<Role>(role);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const room = q.get("room");
    const ticket = q.get("ticket");
    if (room) setRoomId(room);
    if (ticket) setInviteTicket(ticket);
  }, []);

  const appendLog = (line: string) => {
    setLogs((prev) => [...prev.slice(-180), `[${new Date().toLocaleTimeString()}] ${line}`]);
  };

  const authHeaders = (needAdmin: boolean) => {
    if (!needAdmin || !adminToken.trim()) return { "content-type": "application/json" };
    return {
      "content-type": "application/json",
      authorization: `Bearer ${adminToken.trim()}`,
    };
  };

  const apiPost = async <T,>(path: string, body: unknown, needAdmin: boolean): Promise<T> => {
    const base = apiBase.trim().replace(/\/$/, "") || "/api";
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: authHeaders(needAdmin),
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `${res.status} ${res.statusText}`);
    return json as T;
  };

  const apiPostWithAuth = async <T,>(
    path: string,
    body: unknown,
    authToken: string,
  ): Promise<T> => {
    const base = apiBase.trim().replace(/\/$/, "") || "/api";
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `${res.status} ${res.statusText}`);
    return json as T;
  };

  const apiGet = async <T,>(path: string): Promise<T> => {
    const base = apiBase.trim().replace(/\/$/, "") || "/api";
    const res = await fetch(`${base}${path}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `${res.status} ${res.statusText}`);
    return json as T;
  };

  const rebuildMembers = (room: Room, speakingSet: Set<string>) => {
    const list: Member[] = [];
    if (room.localParticipant) {
      list.push({
        identity: room.localParticipant.identity || "me",
        isLocal: true,
        speaking: speakingSet.has(room.localParticipant.identity),
      });
    }
    for (const p of room.remoteParticipants.values()) {
      list.push({
        identity: p.identity,
        isLocal: false,
        speaking: speakingSet.has(p.identity),
      });
    }
    setMembers(list.sort((a, b) => Number(b.speaking) - Number(a.speaking)));
  };

  const addOrUpdateTile = (next: Tile) => {
    setTiles((prev) => {
      const idx = prev.findIndex((t) => t.key === next.key);
      if (idx >= 0) {
        const copy = prev.slice();
        copy[idx] = next;
        return copy;
      }
      return [...prev, next];
    });
  };

  const removeTile = (key: string) => {
    setTiles((prev) => prev.filter((t) => t.key !== key));
  };

  const onTrackSubscribed = (
    track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: Participant,
  ) => {
    addOrUpdateTile({
      key: `${participant.identity}:${publication.trackSid}`,
      identity: participant.identity,
      kind: track.kind,
      track,
    });
    appendLog(`track ${track.kind} <- ${participant.identity}`);
  };

  const onTrackUnsubscribed = (
    _track: RemoteTrack,
    publication: RemoteTrackPublication,
    participant: Participant,
  ) => {
    removeTile(`${participant.identity}:${publication.trackSid}`);
  };

  const attachLocalTracks = (local: LocalParticipant, identity: string) => {
    for (const pub of local.trackPublications.values()) {
      if (!pub.track) continue;
      addOrUpdateTile({
        key: `local:${pub.trackSid}`,
        identity,
        kind: pub.track.kind,
        track: pub.track,
      });
    }
  };

  const loadHistory = async (rid: string) => {
    try {
      const data = await apiGet<{ items: Message[] }>(`/rooms/${encodeURIComponent(rid)}/messages?limit=80`);
      setMessages(data.items);
    } catch (e) {
      appendLog(`history error: ${String(e)}`);
    }
  };

  const refreshSession = async (token?: string) => {
    const oldToken = (token ?? sessionToken).trim();
    if (!oldToken) throw new Error("app session missing");
    const next = await apiPostWithAuth<RefreshSessionResp>(
      "/sessions/refresh",
      {},
      oldToken,
    );
    setSessionToken(next.app_session_token);
    setSessionExpireAt(nowTs() + next.app_session_expires_in_seconds);
    return next.app_session_token;
  };

  useEffect(() => {
    if (!connected || !sessionToken || !sessionExpireAt) return;
    const id = window.setInterval(() => {
      if (nowTs() >= sessionExpireAt - 120) {
        void refreshSession().catch((e) => appendLog(`session refresh error: ${String(e)}`));
      }
    }, 30_000);
    return () => window.clearInterval(id);
  }, [connected, sessionToken, sessionExpireAt]);

  const join = async () => {
    if (roomRef.current) await leave();

    if (!roomId.trim() || !userName.trim()) {
      throw new Error("room and user_name are required");
    }

    const needAdmin = role === "host";
    let currentRedeem = redeemToken.trim();
    if (!needAdmin && inviteTicket.trim() && inviteCode.trim() && !currentRedeem) {
      const redeem = await apiPost<{ redeem_token: string }>(
        "/invites/redeem",
        {
          room_id: roomId.trim(),
          user_name: userName.trim(),
          invite_ticket: inviteTicket.trim(),
          invite_code: inviteCode.trim(),
        },
        false,
      );
      currentRedeem = redeem.redeem_token;
      setRedeemToken(currentRedeem);
      appendLog("invite redeemed");
    }

    const payload: Record<string, string> = {
      room_id: roomId.trim(),
      user_name: userName.trim(),
      role,
      nickname: nickname.trim() || userName.trim(),
    };
    if (avatarUrl.trim()) payload.avatar_url = avatarUrl.trim();
    if (currentRedeem) payload.redeem_token = currentRedeem;

    const joinResp = await apiPost<JoinResp>("/rooms/join", payload, needAdmin);
    currentRole.current = joinResp.role;
    setSessionToken(joinResp.app_session_token);
    setSessionExpireAt(nowTs() + joinResp.app_session_expires_in_seconds);

    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;

    room.on(RoomEvent.Connected, () => {
      setConnected(true);
      setIdentityText(`${userName.trim()} (${joinResp.role})`);
      appendLog(`connected as ${userName.trim()}`);
    });

    room.on(RoomEvent.Disconnected, () => {
      setConnected(false);
      appendLog("disconnected");
    });

    room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);

    room.on(RoomEvent.LocalTrackPublished, (publication: TrackPublication) => {
      if (!publication.track) return;
      addOrUpdateTile({
        key: `local:${publication.trackSid}`,
        identity: userName.trim(),
        kind: publication.track.kind,
        track: publication.track,
      });
    });

    room.on(RoomEvent.ParticipantConnected, () => rebuildMembers(room, new Set()));
    room.on(RoomEvent.ParticipantDisconnected, () => rebuildMembers(room, new Set()));

    room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
      const set = new Set(speakers.map((s) => s.identity));
      rebuildMembers(room, set);
    });

    room.on(RoomEvent.DataReceived, (payload, participant) => {
      try {
        const body = JSON.parse(new TextDecoder().decode(payload)) as Message;
        if (!body.text) return;
        setMessages((prev) => [...prev.slice(-199), body]);
      } catch {
        const plain = new TextDecoder().decode(payload);
        setMessages((prev) => [
          ...prev.slice(-199),
          {
            user_name: participant?.identity || "unknown",
            nickname: participant?.identity || "unknown",
            role: "member",
            text: plain,
            created_at: nowTs(),
          },
        ]);
      }
    });

    await room.connect(joinResp.lk_url, joinResp.token);
    await room.localParticipant.enableMicrophone();
    attachLocalTracks(room.localParticipant, userName.trim());
    rebuildMembers(room, new Set());
    await loadHistory(roomId.trim());
  };

  const leave = async () => {
    const room = roomRef.current;
    if (!room) return;
    room.disconnect();
    roomRef.current = null;
    currentRole.current = "member";
    setSessionToken("");
    setSessionExpireAt(0);
    setTiles([]);
    setMembers([]);
    setConnected(false);
    setIdentityText("Not connected");
    appendLog("left room");
  };

  const toggleMic = async () => {
    const room = roomRef.current;
    if (!room) return;
    const enabled = !room.localParticipant.isMicrophoneEnabled;
    await room.localParticipant.setMicrophoneEnabled(enabled);
    appendLog(`mic ${enabled ? "on" : "off"}`);
  };

  const toggleCam = async () => {
    const room = roomRef.current;
    if (!room) return;
    const enabled = !room.localParticipant.isCameraEnabled;
    await room.localParticipant.setCameraEnabled(enabled);
    appendLog(`cam ${enabled ? "on" : "off"}`);
  };

  const toggleShare = async () => {
    const room = roomRef.current;
    if (!room) return;
    if (currentRole.current !== "host") {
      throw new Error("only host can share screen");
    }
    const enabled = !room.localParticipant.isScreenShareEnabled;
    await room.localParticipant.setScreenShareEnabled(enabled);
    appendLog(`share ${enabled ? "on" : "off"}`);
  };

  const sendMessage = async () => {
    const room = roomRef.current;
    if (!room) throw new Error("join room first");
    const text = chatInput.trim();
    if (!text) return;

    const msg: Message = {
      room_id: roomId.trim(),
      user_name: userName.trim(),
      nickname: nickname.trim() || userName.trim(),
      avatar_url: avatarUrl.trim() || null,
      role: currentRole.current,
      text,
      created_at: nowTs(),
    };

    await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(msg)), {
      reliable: true,
      topic: "chat",
      kind: DataPacket_Kind.RELIABLE,
    });

    let token = sessionToken.trim();
    if (!token) throw new Error("app session missing");
    if (nowTs() >= sessionExpireAt - 120) {
      token = await refreshSession(token);
    }

    await apiPostWithAuth(`/rooms/${encodeURIComponent(roomId.trim())}/messages`, {
      text: msg.text,
    }, token);

    setMessages((prev) => [...prev.slice(-199), msg]);
    setChatInput("");
  };

  const issueInvite = async () => {
    const data = await apiPost<IssueInviteResp>(
      "/auth/invite",
      { room_id: roomId.trim(), host_identity: userName.trim() },
      true,
    );
    setInviteCode(data.invite_code);
    setInviteTicket(data.invite_ticket);
    setInviteUrl(data.invite_url);
    appendLog(`invite url: ${data.invite_url}`);
  };

  const copyInviteText = async () => {
    if (!inviteUrl.trim() || !inviteCode.trim()) {
      throw new Error("issue invite first");
    }
    const text = [
      `房间链接：${inviteUrl.trim()}`,
      `邀请码：${inviteCode.trim()}`,
      "有效期：24小时",
    ].join("\n");
    await navigator.clipboard.writeText(text);
    appendLog("invite message copied");
  };

  const redeemInvite = async () => {
    const data = await apiPost<RedeemResp>(
      "/invites/redeem",
      {
        room_id: roomId.trim(),
        user_name: userName.trim(),
        invite_ticket: inviteTicket.trim(),
        invite_code: inviteCode.trim(),
      },
      false,
    );
    setRedeemToken(data.redeem_token);
    appendLog("redeem token issued");
  };

  const issueStartToken = async () => {
    const data = await apiPost<IssueStartResp>(
      "/broadcast/issue",
      { room_id: roomId.trim(), host_identity: userName.trim() },
      true,
    );
    setStartToken(data.start_token);
    appendLog("broadcast start token issued");
  };

  const startBroadcast = async () => {
    const data = await apiPost<StartBroadcastResp>(
      "/broadcast/start",
      {
        room_id: roomId.trim(),
        participant_identity: userName.trim(),
        participant_name: nickname.trim() || userName.trim(),
        start_token: startToken.trim(),
      },
      true,
    );
    setIngressId(data.ingress_id);
    setWhipUrl(data.whip_url);
    setStreamKey(data.stream_key);
    appendLog("broadcast started");
  };

  const stopBroadcast = async () => {
    if (!ingressId.trim()) throw new Error("ingress id required");
    await apiPost<{ status: string }>(
      "/broadcast/stop",
      { ingress_id: ingressId.trim() },
      true,
    );
    appendLog("broadcast stopped");
  };

  const memberCount = useMemo(() => members.length, [members.length]);
  const run = (fn: () => Promise<void>) => {
    void fn().catch((e) => appendLog(`error: ${String(e)}`));
  };

  return (
    <div className="app">
      <aside className="side">
        <h1>Signal Room</h1>
        <p className="muted">Private Discord-like Stage</p>

        <section className="card">
          <h2>Join</h2>
          <label>API Base<input value={apiBase} onChange={(e) => setApiBase(e.target.value)} /></label>
          <label>Room<input value={roomId} onChange={(e) => setRoomId(e.target.value)} /></label>
          <label>User Name<input value={userName} onChange={(e) => setUserName(e.target.value)} /></label>
          <label>Nickname<input value={nickname} onChange={(e) => setNickname(e.target.value)} /></label>
          <label>Avatar URL<input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} /></label>
          <label>Role
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="member">member</option>
              <option value="host">host</option>
            </select>
          </label>
          <label>Invite Code<input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} /></label>
          <label>Invite Ticket<input value={inviteTicket} onChange={(e) => setInviteTicket(e.target.value)} /></label>
          <label>Invite URL<input value={inviteUrl} onChange={(e) => setInviteUrl(e.target.value)} /></label>
          <label>Redeem Token<input value={redeemToken} onChange={(e) => setRedeemToken(e.target.value)} /></label>
          <label>Admin Token (required for host)<input type="password" value={adminToken} onChange={(e) => setAdminToken(e.target.value)} /></label>
          <div className="row">
            <button className="primary" onClick={() => run(join)}>Join</button>
            <button onClick={() => run(leave)}>Leave</button>
          </div>
          <div className="row">
            <button onClick={() => run(toggleMic)}>Mic</button>
            <button onClick={() => run(toggleCam)}>Cam</button>
            <button onClick={() => run(toggleShare)} disabled={currentRole.current !== "host"}>Share</button>
          </div>
        </section>

        <section className="card">
          <h2>Admin Flow</h2>
          <div className="row">
            <button className="primary" onClick={() => run(issueInvite)}>Issue Invite</button>
            <button onClick={() => run(copyInviteText)}>Copy Invite Text</button>
            <button onClick={() => run(redeemInvite)}>Redeem</button>
          </div>
          <div className="row">
            <button onClick={() => run(issueStartToken)}>Issue Start</button>
            <button className="primary" onClick={() => run(startBroadcast)}>Start Broadcast</button>
            <button onClick={() => run(stopBroadcast)}>Stop Broadcast</button>
          </div>
          <label>Broadcast Start Token<input value={startToken} onChange={(e) => setStartToken(e.target.value)} /></label>
          <label>Ingress ID<input value={ingressId} onChange={(e) => setIngressId(e.target.value)} /></label>
          <label>WHIP URL<input value={whipUrl} onChange={(e) => setWhipUrl(e.target.value)} /></label>
          <label>Stream Key<input value={streamKey} onChange={(e) => setStreamKey(e.target.value)} /></label>
        </section>

        <section className="card members">
          <h2>Members ({memberCount})</h2>
          {members.map((m) => (
            <div key={m.identity} className={`member ${m.speaking ? "speaking" : ""}`}>
              <span>{m.identity}{m.isLocal ? " (me)" : ""}</span>
              <span className="badge">{m.speaking ? "speaking" : "idle"}</span>
            </div>
          ))}
        </section>
      </aside>

      <main className="main">
        <header className="top">
          <strong>{connected ? "online" : "offline"}</strong>
          <span>{identityText}</span>
          <span>room: {roomId}</span>
        </header>

        <section className="stage">
          {tiles.length === 0 ? <div className="empty">No tracks yet</div> : null}
          {tiles.map((tile) => (
            <article key={tile.key} className="tile">
              <div className="tile-head">
                <span>{tile.identity}</span>
                <span>{tile.kind}</span>
              </div>
              <TrackView tile={tile} />
            </article>
          ))}
        </section>

        <section className="chat">
          <div className="chat-list">
            {messages.map((m, i) => (
              <div key={`${m.created_at}-${i}`} className="msg">
                <span className="msg-meta">{fmtTime(m.created_at)} {m.nickname} ({m.role})</span>
                <span className="msg-text">{m.text}</span>
              </div>
            ))}
          </div>
          <div className="chat-input">
            <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="type message" onKeyDown={(e) => {
              if (e.key === "Enter") run(sendMessage);
            }} />
            <button className="primary" onClick={() => run(sendMessage)}>Send</button>
          </div>
        </section>

        <section className="logs">
          {logs.map((line, i) => <div key={`${line}-${i}`}>{line}</div>)}
        </section>
      </main>
    </div>
  );
}

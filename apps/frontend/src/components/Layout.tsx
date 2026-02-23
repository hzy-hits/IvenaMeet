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
  const [lastRealtimeChat, setLastRealtimeChat] = useState<RealtimeChatPayload | null>(null);
  const [realtimeChatSender, setRealtimeChatSender] = useState<((payload: RealtimeChatPayload) => Promise<void>) | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

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

  return (
    <div className="min-h-screen bg-bg font-space text-white">
      <div className="mx-auto w-full max-w-[1880px] p-3 lg:p-4">
        <div className="grid gap-3 lg:grid-cols-[360px_1fr]">
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
          />

          <MainStage
            joined={joined}
            roomId={roomId}
            userName={userName}
            role={joined?.role ?? role}
            onMembersChange={setMembers}
            onRealtimeChatMessage={setLastRealtimeChat}
            onRealtimeChatSenderReady={handleRealtimeChatSenderReady}
            onLog={pushLog}
          />
        </div>
      </div>
    </div>
  );
}

import { useMemo, useState } from "react";
import type { JoinResp, MemberItem, MessageItem, Role } from "../lib/types";
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

export function Layout() {
  const [hostSessionToken, setHostSessionToken] = useState("");
  const [appSessionToken, setAppSessionToken] = useState("");

  const [roomId, setRoomId] = useState(DEFAULT_ROOM_ID);
  const [userName, setUserName] = useState(DEFAULT_USER_NAME);
  const [role, setRole] = useState<Role>(DEFAULT_ROLE);

  const [joined, setJoined] = useState<JoinResp | null>(null);
  const [members, setMembers] = useState<MemberItem[]>([]);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [logs, setLogs] = useState<string[]>([]);

  const api = useMemo(
    () =>
      createApi(API_BASE_URL, {
        getControlToken: () => hostSessionToken,
        getAppSessionToken: () => appSessionToken,
      }),
    [hostSessionToken, appSessionToken],
  );

  const pushLog = (line: string) => {
    setLogs((prev) => [...prev.slice(-(LOG_MAX_LINES - 1)), `[${new Date().toLocaleTimeString()}] ${line}`]);
  };

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
            setJoined={setJoined}
            setAppSessionToken={setAppSessionToken}
            setHostSessionToken={setHostSessionToken}
            members={members}
            messages={messages}
            setMessages={setMessages}
            logs={logs}
            pushLog={pushLog}
          />

          <MainStage
            joined={joined}
            roomId={roomId}
            userName={userName}
            role={role}
            onMembersChange={setMembers}
            onLog={pushLog}
          />
        </div>
      </div>
    </div>
  );
}

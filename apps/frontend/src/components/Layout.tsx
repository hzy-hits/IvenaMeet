import { useMemo, useState } from "react";
import type { JoinResp, MemberItem, MessageItem, Role } from "../lib/types";
import { API_BASE_URL, REQUIRE_INVITE } from "../lib/env";
import { createApi } from "../lib/api";
import { Sidebar } from "./Sidebar";
import { MainStage } from "./MainStage";

export function Layout() {
  const [adminToken, setAdminToken] = useState("");
  const [appSessionToken, setAppSessionToken] = useState("");

  const [roomId, setRoomId] = useState("test");
  const [userName, setUserName] = useState("guest_01");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [role, setRole] = useState<Role>("member");

  const [joined, setJoined] = useState<JoinResp | null>(null);
  const [members, setMembers] = useState<MemberItem[]>([]);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [logs, setLogs] = useState<string[]>([]);

  const api = useMemo(
    () =>
      createApi(API_BASE_URL, {
        getAdminToken: () => adminToken,
        getAppSessionToken: () => appSessionToken,
      }),
    [adminToken, appSessionToken],
  );

  const pushLog = (line: string) => {
    setLogs((prev) => [...prev.slice(-249), `[${new Date().toLocaleTimeString()}] ${line}`]);
  };

  return (
    <div className="min-h-screen bg-bg font-space text-white">
      <div className="mx-auto w-full max-w-[1880px] p-3 lg:p-4">
        <div className="grid gap-3 lg:grid-cols-[360px_1fr]">
          <Sidebar
            requireInvite={REQUIRE_INVITE}
            api={api}
            adminToken={adminToken}
            setAdminToken={setAdminToken}
            roomId={roomId}
            setRoomId={setRoomId}
            userName={userName}
            setUserName={setUserName}
            avatarUrl={avatarUrl}
            setAvatarUrl={setAvatarUrl}
            role={role}
            setRole={setRole}
            joined={joined}
            setJoined={setJoined}
            setAppSessionToken={setAppSessionToken}
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

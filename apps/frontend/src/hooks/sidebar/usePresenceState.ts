import { useEffect, useRef, useState } from "react";

type ConsolePane = "control" | "members" | "ops";

export function usePresenceState(chatPriorityMode: boolean) {
  const [openMembers, setOpenMembers] = useState(true);
  const [openChat, setOpenChat] = useState(true);
  const [openLogs, setOpenLogs] = useState(false);
  const [consolePane, setConsolePane] = useState<ConsolePane>("control");
  const lastChatPriorityModeRef = useRef(chatPriorityMode);

  useEffect(() => {
    const was = lastChatPriorityModeRef.current;
    if (chatPriorityMode && !was) {
      setOpenChat(true);
      setOpenMembers(false);
      setOpenLogs(false);
    }
    lastChatPriorityModeRef.current = chatPriorityMode;
  }, [chatPriorityMode]);

  useEffect(() => {
    if (consolePane === "members") setOpenMembers(true);
    if (consolePane === "ops") setOpenLogs(true);
  }, [consolePane]);

  return {
    openMembers,
    setOpenMembers,
    openChat,
    setOpenChat,
    openLogs,
    setOpenLogs,
    consolePane,
    setConsolePane,
  };
}

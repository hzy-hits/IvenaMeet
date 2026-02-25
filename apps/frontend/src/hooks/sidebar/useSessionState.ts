import { useCallback, useEffect, useRef, useState } from "react";
import {
  SESSION_HEARTBEAT_MS,
  SESSION_REFRESH_BEFORE_SECONDS,
  SESSION_REFRESH_POLL_MS,
} from "../../lib/env";
import type { JoinResp, MessageItem } from "../../lib/types";

type ApiClient = ReturnType<typeof import("../../lib/api").createApi>;

const LS_KEYS = {
  joined: "ivena.meet.joined",
  appSessionToken: "ivena.meet.app_session_token",
} as const;

let bootReconnectAttempted = false;

type Params = {
  api: ApiClient;
  joined: JoinResp | null;
  appSessionToken: string;
  isHost: boolean;
  sessionExpireAt: number;
  hostSessionExpireAt: number;
  setSessionExpireAt: (v: number) => void;
  setHostSessionExpireAt: (v: number) => void;
  setJoined: (v: JoinResp | null) => void;
  clearClientState: (options?: { clearHostTotp?: boolean; clearMessages?: boolean }) => void;
  setMessages: (v: MessageItem[]) => void;
  showActionNotice: (kind: "ok" | "error", text: string) => void;
  pushLog: (s: string) => void;
  enableBootReconnect: boolean;
};

export type SessionConnectionStatus = "connected" | "reconnecting" | "disconnected";

export function useSessionState({
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
  setMessages,
  showActionNotice,
  pushLog,
  enableBootReconnect,
}: Params) {
  const [sessionConnectionStatus, setSessionConnectionStatus] =
    useState<SessionConnectionStatus>("disconnected");
  const [sessionReconnectInSeconds, setSessionReconnectInSeconds] = useState(0);
  const initialReconnectChecked = useRef(false);
  const refreshErrorLoggedRef = useRef(false);
  const heartbeatErrorLoggedRef = useRef(false);
  const reconnectInFlightRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectTickRef = useRef<number | null>(null);
  const joinedSnapshotRef = useRef<JoinResp | null>(joined);
  const sessionConnectionStatusRef = useRef<SessionConnectionStatus>("disconnected");
  const shouldReconnectOnBoot = useRef(
    Boolean(
      enableBootReconnect
      && localStorage.getItem(LS_KEYS.joined)
      && localStorage.getItem(LS_KEYS.appSessionToken),
    ),
  );

  const applySessionConnectionStatus = useCallback((next: SessionConnectionStatus) => {
    sessionConnectionStatusRef.current = next;
    setSessionConnectionStatus(next);
  }, []);

  const clearReconnectTimers = useCallback(() => {
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (reconnectTickRef.current) {
      window.clearInterval(reconnectTickRef.current);
      reconnectTickRef.current = null;
    }
    setSessionReconnectInSeconds(0);
  }, []);

  const rejoinSession = useCallback(() => {
    clearReconnectTimers();
    applySessionConnectionStatus("disconnected");
    clearClientState({ clearHostTotp: isHost, clearMessages: true });
    setMessages([]);
    showActionNotice("error", "会话不可用，请重新加入房间");
  }, [
    applySessionConnectionStatus,
    clearClientState,
    clearReconnectTimers,
    isHost,
    setMessages,
    showActionNotice,
  ]);

  const attemptSessionReconnect = useCallback(
    async (reason: "boot" | "refresh" | "heartbeat" | "manual") => {
      if (!joinedSnapshotRef.current || !appSessionToken || reconnectInFlightRef.current) return;
      reconnectInFlightRef.current = true;
      clearReconnectTimers();
      applySessionConnectionStatus("reconnecting");
      const restored = joinedSnapshotRef.current;
      try {
        const res = await api.reconnectRoom();
        setJoined({ ...restored, ...res });
        refreshErrorLoggedRef.current = false;
        heartbeatErrorLoggedRef.current = false;
        applySessionConnectionStatus("connected");
        if (reason !== "boot") {
          pushLog(`session recovered (${reason})`);
          showActionNotice("ok", "连接已恢复");
        }
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        pushLog(`session reconnect failed: ${detail}`);
        applySessionConnectionStatus("disconnected");
        if (/invalid or expired app session/i.test(detail)) {
          rejoinSession();
          return;
        }
        showActionNotice("error", "连接恢复失败，请重新连接或重新加入");
      } finally {
        reconnectInFlightRef.current = false;
      }
    },
    [
      api,
      appSessionToken,
      applySessionConnectionStatus,
      clearReconnectTimers,
      pushLog,
      rejoinSession,
      setJoined,
      showActionNotice,
    ],
  );

  const scheduleSessionReconnect = useCallback(
    (delaySeconds: number, reason: "refresh" | "heartbeat") => {
      if (!joinedSnapshotRef.current || !appSessionToken || reconnectInFlightRef.current) return;
      if (reconnectTimerRef.current || reconnectTickRef.current) return;
      applySessionConnectionStatus("reconnecting");
      setSessionReconnectInSeconds(delaySeconds);
      reconnectTickRef.current = window.setInterval(() => {
        setSessionReconnectInSeconds((prev) => {
          if (prev <= 1) {
            if (reconnectTickRef.current) {
              window.clearInterval(reconnectTickRef.current);
              reconnectTickRef.current = null;
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        void attemptSessionReconnect(reason);
      }, delaySeconds * 1000);
    },
    [appSessionToken, applySessionConnectionStatus, attemptSessionReconnect],
  );

  const retrySessionRecovery = useCallback(() => {
    clearReconnectTimers();
    void attemptSessionReconnect("manual");
  }, [attemptSessionReconnect, clearReconnectTimers]);

  useEffect(() => {
    joinedSnapshotRef.current = joined;
    if (joined && appSessionToken) {
      if (sessionConnectionStatusRef.current === "disconnected") {
        applySessionConnectionStatus("connected");
      }
      return;
    }
    clearReconnectTimers();
    applySessionConnectionStatus("disconnected");
    refreshErrorLoggedRef.current = false;
    heartbeatErrorLoggedRef.current = false;
  }, [
    appSessionToken,
    applySessionConnectionStatus,
    clearReconnectTimers,
    joined,
  ]);

  useEffect(() => () => clearReconnectTimers(), [clearReconnectTimers]);

  useEffect(() => {
    if (initialReconnectChecked.current) return;
    if (!shouldReconnectOnBoot.current || bootReconnectAttempted) {
      initialReconnectChecked.current = true;
      return;
    }
    if (!joined || reconnectInFlightRef.current) return;
    initialReconnectChecked.current = true;
    reconnectInFlightRef.current = true;
    bootReconnectAttempted = true;
    applySessionConnectionStatus("reconnecting");
    const restored = joined;

    void api
      .reconnectRoom()
      .then((res) => {
        setJoined({ ...restored, ...res });
        applySessionConnectionStatus("connected");
        pushLog("session restored after refresh");
      })
      .catch((e) => {
        applySessionConnectionStatus("disconnected");
        clearClientState({ clearHostTotp: false, clearMessages: true });
        setMessages([]);
        pushLog(`session restore failed: ${String(e)}`);
        showActionNotice("error", "会话已失效，请重新加入房间");
      })
      .finally(() => {
        reconnectInFlightRef.current = false;
      });
  }, [
    api,
    applySessionConnectionStatus,
    clearClientState,
    joined,
    pushLog,
    setJoined,
    setMessages,
    showActionNotice,
  ]);

  useEffect(() => {
    if (!joined || !sessionExpireAt) return;
    const timer = window.setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      if (now >= sessionExpireAt - SESSION_REFRESH_BEFORE_SECONDS) {
        void api
          .refreshSession()
          .then((res) => {
            setSessionExpireAt(now + res.app_session_expires_in_seconds);
            refreshErrorLoggedRef.current = false;
            clearReconnectTimers();
            applySessionConnectionStatus("connected");
            pushLog("app session refreshed");
          })
          .catch((e) => {
            if (!refreshErrorLoggedRef.current) {
              refreshErrorLoggedRef.current = true;
              pushLog(`session refresh failed: ${String(e)}`);
              showActionNotice("error", "会话续期失败，正在重连");
            }
            scheduleSessionReconnect(3, "refresh");
          });
      }
    }, SESSION_REFRESH_POLL_MS);
    return () => window.clearInterval(timer);
  }, [
    api,
    applySessionConnectionStatus,
    clearReconnectTimers,
    joined,
    pushLog,
    scheduleSessionReconnect,
    sessionExpireAt,
    setSessionExpireAt,
    showActionNotice,
  ]);

  useEffect(() => {
    if (!joined || !appSessionToken) return;
    const timer = window.setInterval(() => {
      void api
        .heartbeatSession()
        .then(() => {
          clearReconnectTimers();
          applySessionConnectionStatus("connected");
          heartbeatErrorLoggedRef.current = false;
        })
        .catch((e) => {
          if (heartbeatErrorLoggedRef.current) return;
          heartbeatErrorLoggedRef.current = true;
          pushLog(`session heartbeat failed: ${e instanceof Error ? e.message : String(e)}`);
          showActionNotice("error", "连接异常，正在尝试恢复");
          scheduleSessionReconnect(3, "heartbeat");
        });
    }, SESSION_HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [
    api,
    appSessionToken,
    applySessionConnectionStatus,
    clearReconnectTimers,
    joined,
    pushLog,
    scheduleSessionReconnect,
    showActionNotice,
  ]);

  useEffect(() => {
    if (!joined || !isHost || !hostSessionExpireAt) return;
    const timer = window.setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      if (now >= hostSessionExpireAt - SESSION_REFRESH_BEFORE_SECONDS) {
        void api
          .refreshHostSession()
          .then((res) => {
            setHostSessionExpireAt(now + res.expires_in_seconds);
            pushLog("host session refreshed");
          })
          .catch((e) => {
            clearClientState({ clearHostTotp: true, clearMessages: true });
            setHostSessionExpireAt(0);
            setSessionExpireAt(0);
            applySessionConnectionStatus("disconnected");
            pushLog(`host session refresh failed: ${String(e)}`);
            pushLog("主持权限已过期，请重新输入 TOTP");
            showActionNotice("error", "主持会话已过期，请重新加入并验证");
          });
      }
    }, SESSION_REFRESH_POLL_MS);
    return () => window.clearInterval(timer);
  }, [
    applySessionConnectionStatus,
    joined,
    isHost,
    hostSessionExpireAt,
    api,
    clearClientState,
    setHostSessionExpireAt,
    setSessionExpireAt,
    pushLog,
    showActionNotice,
  ]);

  return {
    sessionConnectionStatus,
    sessionReconnectInSeconds,
    retrySessionRecovery,
    rejoinSession,
  };
}

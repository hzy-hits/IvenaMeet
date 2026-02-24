import { useEffect, useRef } from "react";
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
  const initialReconnectChecked = useRef(false);
  const heartbeatErrorLoggedRef = useRef(false);
  const reconnectInFlightRef = useRef(false);
  const shouldReconnectOnBoot = useRef(
    Boolean(
      enableBootReconnect
      && localStorage.getItem(LS_KEYS.joined)
      && localStorage.getItem(LS_KEYS.appSessionToken),
    ),
  );

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
    const restored = joined;

    void api
      .reconnectRoom()
      .then((res) => {
        setJoined({ ...restored, ...res });
        pushLog("session restored after refresh");
      })
      .catch((e) => {
        clearClientState({ clearHostTotp: false, clearMessages: true });
        setMessages([]);
        pushLog(`session restore failed: ${String(e)}`);
        showActionNotice("error", "会话已失效，请重新加入房间");
      })
      .finally(() => {
        reconnectInFlightRef.current = false;
      });
  }, [joined, api, setJoined, clearClientState, setMessages, pushLog, showActionNotice]);

  useEffect(() => {
    if (!joined || !sessionExpireAt) return;
    const timer = window.setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      if (now >= sessionExpireAt - SESSION_REFRESH_BEFORE_SECONDS) {
        void api
          .refreshSession()
          .then((res) => {
            setSessionExpireAt(now + res.app_session_expires_in_seconds);
            pushLog("app session refreshed");
          })
          .catch((e) => pushLog(`session refresh failed: ${String(e)}`));
      }
    }, SESSION_REFRESH_POLL_MS);
    return () => window.clearInterval(timer);
  }, [joined, sessionExpireAt, api, setSessionExpireAt, pushLog]);

  useEffect(() => {
    if (!joined || !appSessionToken) return;
    const timer = window.setInterval(() => {
      void api
        .heartbeatSession()
        .then(() => {
          heartbeatErrorLoggedRef.current = false;
        })
        .catch((e) => {
          if (heartbeatErrorLoggedRef.current) return;
          heartbeatErrorLoggedRef.current = true;
          pushLog(`session heartbeat failed: ${e instanceof Error ? e.message : String(e)}`);
        });
    }, SESSION_HEARTBEAT_MS);
    return () => window.clearInterval(timer);
  }, [joined, appSessionToken, api, pushLog]);

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
            pushLog(`host session refresh failed: ${String(e)}`);
            pushLog("主持权限已过期，请重新输入 TOTP");
          });
      }
    }, SESSION_REFRESH_POLL_MS);
    return () => window.clearInterval(timer);
  }, [
    joined,
    isHost,
    hostSessionExpireAt,
    api,
    clearClientState,
    setHostSessionExpireAt,
    setSessionExpireAt,
    pushLog,
  ]);
}

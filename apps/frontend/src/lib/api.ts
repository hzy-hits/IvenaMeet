import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import type {
  CurrentBroadcastReq,
  CurrentBroadcastResp,
  CreateInviteReq,
  CreateInviteResp,
  CreateMessageReq,
  ForceReclaimReq,
  ForceReclaimResp,
  HostLoginResp,
  HostLoginTotpReq,
  IssueBroadcastReq,
  IssueBroadcastResp,
  JoinReq,
  JoinResp,
  LeaveResp,
  ListMessagesResp,
  MessageItem,
  MuteAllReq,
  MuteMemberReq,
  MuteResp,
  RedeemInviteReq,
  RedeemInviteResp,
  RefreshSessionResp,
  ReconnectResp,
  SetMemberMediaPermissionReq,
  SetMemberMediaPermissionResp,
  SessionHeartbeatResp,
  StartBroadcastReq,
  StartBroadcastResp,
  StopBroadcastReq,
  UploadAvatarResp,
} from "./types";

type TokenGetters = {
  getControlToken: () => string;
  getAppSessionToken: () => string;
};

type CloseStream = () => void;

function toError(e: unknown): never {
  const ax = e as AxiosError<{ error?: string }>;
  throw new Error(ax.response?.data?.error || ax.message || "request failed");
}

function resolveApiUrl(baseURL: string, path: string): string {
  const base = baseURL.replace(/\/+$/, "");
  return `${base}${path}`;
}

function parseSseFrame(frame: string): { event: string; data: string } | null {
  const lines = frame.split("\n");
  let event = "message";
  const dataLines: string[] = [];
  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (!trimmed || trimmed.startsWith(":")) continue;
    if (trimmed.startsWith("event:")) {
      event = trimmed.slice(6).trim();
      continue;
    }
    if (trimmed.startsWith("data:")) {
      dataLines.push(trimmed.slice(5).trimStart());
    }
  }
  if (!dataLines.length) return null;
  return { event, data: dataLines.join("\n") };
}

export function createApi(baseURL: string, getters: TokenGetters) {
  const raw = axios.create({ baseURL, timeout: 12000 });

  const withControl = axios.create({ baseURL, timeout: 12000 });
  withControl.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    const token = getters.getControlToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  });

  const withAppSession = axios.create({ baseURL, timeout: 12000 });
  withAppSession.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    const token = getters.getAppSessionToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  });

  return {
    async join(payload: JoinReq, authToken?: string): Promise<JoinResp> {
      try {
        const { data } = await raw.post<JoinResp>("/rooms/join", payload, {
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
        });
        return data;
      } catch (e) {
        toError(e);
      }
    },

    async reconnectRoom(): Promise<ReconnectResp> {
      try {
        const { data } = await withAppSession.post<ReconnectResp>("/rooms/reconnect", {});
        return data;
      } catch (e) {
        toError(e);
      }
    },

    async leaveRoom(): Promise<LeaveResp> {
      try {
        const { data } = await withAppSession.post<LeaveResp>("/rooms/leave", {});
        return data;
      } catch (e) {
        toError(e);
      }
    },

    async loginHostWithTotp(payload: HostLoginTotpReq): Promise<HostLoginResp> {
      try {
        const { data } = await raw.post<HostLoginResp>("/host/login/totp", payload);
        return data;
      } catch (e) {
        toError(e);
      }
    },

    async refreshHostSession(): Promise<HostLoginResp> {
      try {
        const { data } = await withControl.post<HostLoginResp>("/host/sessions/refresh", {});
        return data;
      } catch (e) {
        toError(e);
      }
    },

    async redeemInvite(payload: RedeemInviteReq): Promise<RedeemInviteResp> {
      try {
        const { data } = await raw.post<RedeemInviteResp>("/invites/redeem", payload);
        return data;
      } catch (e) {
        toError(e);
      }
    },

    async refreshSession(): Promise<RefreshSessionResp> {
      try {
        const { data } = await withAppSession.post<RefreshSessionResp>("/sessions/refresh", {});
        return data;
      } catch (e) {
        toError(e);
      }
    },

    async heartbeatSession(): Promise<SessionHeartbeatResp> {
      try {
        const { data } = await withAppSession.post<SessionHeartbeatResp>("/sessions/heartbeat", {});
        return data;
      } catch (e) {
        toError(e);
      }
    },

    async forceReclaimHostLock(
      payload: ForceReclaimReq,
      authTokenOverride?: string,
    ): Promise<ForceReclaimResp> {
      try {
        const { data } = await withControl.post<ForceReclaimResp>(
          "/rooms/host/force-reclaim",
          payload,
          authTokenOverride ? { headers: { Authorization: `Bearer ${authTokenOverride}` } } : undefined,
        );
        return data;
      } catch (e) {
        toError(e);
      }
    },

    async issueInvite(payload: CreateInviteReq): Promise<CreateInviteResp> {
      try {
        const { data } = await withControl.post<CreateInviteResp>("/auth/invite", payload);
        return data;
      } catch (e) {
        toError(e);
      }
    },

    async issueBroadcast(payload: IssueBroadcastReq): Promise<IssueBroadcastResp> {
      try {
        const { data } = await withControl.post<IssueBroadcastResp>("/broadcast/issue", payload);
        return data;
      } catch (e) {
        toError(e);
      }
    },

    async startBroadcast(payload: StartBroadcastReq): Promise<StartBroadcastResp> {
      try {
        const { data } = await withControl.post<StartBroadcastResp>("/broadcast/start", payload);
        return data;
      } catch (e) {
        toError(e);
      }
    },

    async stopBroadcast(payload: StopBroadcastReq): Promise<void> {
      try {
        await withControl.post("/broadcast/stop", payload);
      } catch (e) {
        toError(e);
      }
    },

    async currentBroadcast(
      payload: CurrentBroadcastReq,
      authTokenOverride?: string,
    ): Promise<CurrentBroadcastResp> {
      try {
        const { data } = await withControl.get<CurrentBroadcastResp>("/broadcast/current", {
          params: payload,
          headers: authTokenOverride ? { Authorization: `Bearer ${authTokenOverride}` } : undefined,
        });
        return data;
      } catch (e) {
        toError(e);
      }
    },

    async muteMember(payload: MuteMemberReq): Promise<MuteResp> {
      try {
        const { data } = await withControl.post<MuteResp>("/moderation/mute", payload);
        return data;
      } catch (e) {
        toError(e);
      }
    },

    async muteAll(payload: MuteAllReq): Promise<MuteResp> {
      try {
        const { data } = await withControl.post<MuteResp>("/moderation/mute-all", payload);
        return data;
      } catch (e) {
        toError(e);
      }
    },

    async setMemberMediaPermission(
      payload: SetMemberMediaPermissionReq,
    ): Promise<SetMemberMediaPermissionResp> {
      try {
        const { data } = await withControl.post<SetMemberMediaPermissionResp>(
          "/moderation/media-permission",
          payload,
        );
        return data;
      } catch (e) {
        toError(e);
      }
    },

    async listMessages(roomId: string, limit = 80, afterId?: number): Promise<ListMessagesResp> {
      try {
        const params: { limit: number; after_id?: number } = { limit };
        if (afterId && afterId > 0) params.after_id = afterId;
        const { data } = await raw.get<ListMessagesResp>(`/rooms/${encodeURIComponent(roomId)}/messages`, {
          params,
        });
        return data;
      } catch (e) {
        toError(e);
      }
    },

    async createMessage(roomId: string, payload: CreateMessageReq): Promise<MessageItem> {
      try {
        const { data } = await withAppSession.post<MessageItem>(
          `/rooms/${encodeURIComponent(roomId)}/messages`,
          payload,
        );
        return data;
      } catch (e) {
        toError(e);
      }
    },

    streamMessages(
      roomId: string,
      afterId: number | undefined,
      onMessage: (item: MessageItem) => void,
      onLagged: (skipped: number) => void,
      onError: (error: Error) => void,
    ): CloseStream {
      const controller = new AbortController();
      const token = getters.getAppSessionToken();
      const params = new URLSearchParams();
      if (afterId && afterId > 0) params.set("after_id", String(afterId));
      const query = params.toString();
      const path = `/rooms/${encodeURIComponent(roomId)}/messages/stream${query ? `?${query}` : ""}`;
      const url = resolveApiUrl(baseURL, path);

      void (async () => {
        try {
          const res = await fetch(url, {
            method: "GET",
            headers: {
              Accept: "text/event-stream",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            signal: controller.signal,
          });
          if (!res.ok || !res.body) {
            const detail = await res.text().catch(() => "");
            throw new Error(detail || `stream failed (${res.status})`);
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true }).replace(/\r/g, "");

            while (true) {
              const idx = buffer.indexOf("\n\n");
              if (idx < 0) break;
              const frame = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 2);
              const parsed = parseSseFrame(frame);
              if (!parsed) continue;
              if (parsed.event === "message") {
                try {
                  onMessage(JSON.parse(parsed.data) as MessageItem);
                } catch {
                  onError(new Error("invalid message stream payload"));
                }
                continue;
              }
              if (parsed.event === "lagged") {
                const skipped = Number.parseInt(parsed.data, 10);
                onLagged(Number.isFinite(skipped) && skipped > 0 ? skipped : 0);
              }
            }
          }

          if (!controller.signal.aborted) {
            onError(new Error("message stream closed"));
          }
        } catch (e) {
          if (controller.signal.aborted) return;
          onError(e instanceof Error ? e : new Error(String(e)));
        }
      })();

      return () => controller.abort();
    },

    async uploadAvatar(dataUrl: string, appTokenOverride?: string): Promise<UploadAvatarResp> {
      try {
        const headers = appTokenOverride
          ? { Authorization: `Bearer ${appTokenOverride}` }
          : undefined;
        const { data } = await raw.post<UploadAvatarResp>(
          "/users/avatar/upload",
          { data_url: dataUrl },
          { headers },
        );
        return data;
      } catch (e) {
        toError(e);
      }
    },
  };
}

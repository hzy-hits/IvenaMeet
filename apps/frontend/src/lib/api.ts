import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import type {
  CreateInviteReq,
  CreateInviteResp,
  CreateMessageReq,
  HostLoginResp,
  HostLoginTotpReq,
  IssueBroadcastReq,
  IssueBroadcastResp,
  JoinReq,
  JoinResp,
  ListMessagesResp,
  MuteAllReq,
  MuteMemberReq,
  MuteResp,
  RedeemInviteReq,
  RedeemInviteResp,
  RefreshSessionResp,
  StartBroadcastReq,
  StartBroadcastResp,
  StopBroadcastReq,
} from "./types";

type TokenGetters = {
  getControlToken: () => string;
  getAppSessionToken: () => string;
};

function toError(e: unknown): never {
  const ax = e as AxiosError<{ error?: string }>;
  throw new Error(ax.response?.data?.error || ax.message || "request failed");
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

    async listMessages(roomId: string, limit = 80): Promise<ListMessagesResp> {
      try {
        const { data } = await raw.get<ListMessagesResp>(`/rooms/${encodeURIComponent(roomId)}/messages`, {
          params: { limit },
        });
        return data;
      } catch (e) {
        toError(e);
      }
    },

    async createMessage(roomId: string, payload: CreateMessageReq) {
      try {
        const { data } = await withAppSession.post(
          `/rooms/${encodeURIComponent(roomId)}/messages`,
          payload,
        );
        return data;
      } catch (e) {
        toError(e);
      }
    },
  };
}

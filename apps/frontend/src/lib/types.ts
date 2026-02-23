export type Role = "host" | "member";

export interface JoinReq {
  room_id: string;
  user_name: string;
  role?: Role;
  redeem_token?: string;
  nickname?: string;
  avatar_url?: string;
}

export interface HostLoginTotpReq {
  room_id: string;
  host_identity: string;
  totp_code: string;
}

export interface HostLoginResp {
  host_session_token: string;
  expires_in_seconds: number;
}

export interface JoinResp {
  lk_url: string;
  token: string;
  expires_in_seconds: number;
  role: Role;
  app_session_token: string;
  app_session_expires_in_seconds: number;
  host_session_token?: string;
  host_session_expires_in_seconds?: number;
}

export interface ReconnectResp {
  lk_url: string;
  token: string;
  expires_in_seconds: number;
  role: Role;
}

export interface RedeemInviteReq {
  room_id: string;
  user_name: string;
  invite_ticket: string;
  invite_code: string;
}

export interface RedeemInviteResp {
  redeem_token: string;
  expires_in_seconds: number;
}

export interface CreateInviteReq {
  room_id: string;
  host_identity: string;
}

export interface CreateInviteResp {
  invite_code: string;
  invite_ticket: string;
  invite_url: string;
  expires_at: string;
}

export interface IssueBroadcastReq {
  room_id: string;
  host_identity: string;
}

export interface IssueBroadcastResp {
  start_token: string;
  expires_in_seconds: number;
}

export interface StartBroadcastReq {
  room_id: string;
  participant_identity: string;
  participant_name?: string;
  start_token: string;
}

export interface StartBroadcastResp {
  whip_url: string;
  stream_key: string;
  ingress_id: string;
}

export interface StopBroadcastReq {
  ingress_id: string;
}

export interface MuteMemberReq {
  room_id: string;
  host_identity: string;
  target_identity: string;
  muted: boolean;
}

export interface MuteAllReq {
  room_id: string;
  host_identity: string;
  muted: boolean;
}

export interface MuteResp {
  affected_tracks: number;
}

export interface RefreshSessionResp {
  app_session_token: string;
  app_session_expires_in_seconds: number;
}

export interface RefreshHostSessionResp {
  host_session_token: string;
  expires_in_seconds: number;
}

export interface MessageItem {
  id: number;
  room_id: string;
  user_name: string;
  nickname: string;
  avatar_url?: string | null;
  role: Role;
  text: string;
  created_at: number;
}

export interface ListMessagesResp {
  items: MessageItem[];
}

export interface CreateMessageReq {
  text: string;
}

export interface MemberItem {
  identity: string;
  isLocal: boolean;
  speaking: boolean;
  micEnabled: boolean;
}

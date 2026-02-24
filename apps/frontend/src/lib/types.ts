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
  camera_allowed: boolean;
  screen_share_allowed: boolean;
  camera_expires_at?: number | null;
  screen_share_expires_at?: number | null;
  nickname: string;
  avatar_url?: string | null;
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
  camera_allowed: boolean;
  screen_share_allowed: boolean;
  camera_expires_at?: number | null;
  screen_share_expires_at?: number | null;
}

export interface LeaveResp {
  released: boolean;
}

export interface RedeemInviteReq {
  room_id: string;
  user_name: string;
  invite_ticket: string;
  invite_code: string;
}

export interface RedeemInviteResp {
  redeem_token: string;
  ticket_remaining_uses: number;
  expires_in_seconds: number;
}

export interface CreateInviteReq {
  room_id: string;
  host_identity: string;
}

export interface CreateInviteResp {
  invite_code: string;
  invite_ticket: string;
  invite_max_uses: number;
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

export interface SetMemberMediaPermissionReq {
  room_id: string;
  host_identity: string;
  target_identity: string;
  feature: StageFeature;
  enabled: boolean;
}

export interface SetMemberMediaPermissionResp {
  affected_tracks: number;
  camera_allowed: boolean;
  screen_share_allowed: boolean;
  camera_expires_at?: number | null;
  screen_share_expires_at?: number | null;
}

export interface RefreshSessionResp {
  app_session_token: string;
  app_session_expires_in_seconds: number;
}

export interface SessionHeartbeatResp {
  ok: boolean;
  app_session_expires_in_seconds: number;
}

export interface RefreshHostSessionResp {
  host_session_token: string;
  expires_in_seconds: number;
}

export interface ForceReclaimReq {
  room_id: string;
  host_identity: string;
}

export interface ForceReclaimResp {
  reclaimed: boolean;
  reason: string;
  stale_age_seconds: number;
}

export interface MessageItem {
  id: number;
  room_id: string;
  user_name: string;
  nickname: string;
  avatar_url?: string | null;
  role: Role;
  client_id?: string | null;
  text: string;
  created_at: number;
  pending?: boolean;
  failed?: boolean;
}

export interface ListMessagesResp {
  items: MessageItem[];
}

export interface CreateMessageReq {
  text: string;
  client_id?: string;
}

export interface RealtimeChatPayload {
  type: "chat.message";
  room_id: string;
  client_id: string;
  user_name: string;
  nickname: string;
  avatar_url?: string | null;
  role: Role;
  text: string;
  created_at: number;
}

export type StageFeature = "camera" | "screen_share";

export interface StageRequestPayload {
  type: "stage.request";
  room_id: string;
  request_id: string;
  target_user: string;
  feature: StageFeature;
  created_at: number;
}

export interface StageDecisionPayload {
  type: "stage.decision";
  room_id: string;
  request_id: string;
  target_user: string;
  feature: StageFeature;
  approved: boolean;
  decided_by: string;
  created_at: number;
}

export type StageControlPayload = StageRequestPayload | StageDecisionPayload;

export interface UploadAvatarResp {
  avatar_url: string;
}

export interface MemberItem {
  identity: string;
  isLocal: boolean;
  speaking: boolean;
  micEnabled: boolean;
}

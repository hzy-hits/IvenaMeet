import { useEffect, useMemo, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { INVITE_COPY_HINT_MS } from "../../lib/env";
import { saveCachedAvatar } from "../../lib/avatar";
import type { AvatarStatus } from "./useAvatarState";
import type { JoinResp, MessageItem, Role, StageFeature } from "../../lib/types";

type ApiClient = ReturnType<typeof import("../../lib/api").createApi>;

type ActionNotice = { kind: "ok" | "error"; text: string } | null;

type Params = {
  requireInvite: boolean;
  api: ApiClient;
  roomId: string;
  setRoomId: (v: string) => void;
  userName: string;
  role: Role;
  setRole: (v: Role) => void;
  joined: JoinResp | null;
  appSessionToken: string;
  setJoined: (v: JoinResp | null) => void;
  setAppSessionToken: (v: string) => void;
  setHostSessionToken: (v: string) => void;
  setMessages: Dispatch<SetStateAction<MessageItem[]>>;
  pushLog: (s: string) => void;
  avatarPreview: string;
  avatarUploadDataRef: MutableRefObject<string>;
  avatarPreviewBlobRef: MutableRefObject<string>;
  setAvatarPreview: (v: string) => void;
  setAvatarStatus: (v: AvatarStatus) => void;
  syncAvatarFromServer: (name: string, avatarUrl?: string | null) => void;
  onLeaveCleanup: () => void;
};

const LS_KEYS = {
  joined: "ivena.meet.joined",
  appSessionToken: "ivena.meet.app_session_token",
  hostSessionToken: "ivena.meet.host_session_token",
} as const;

function persistableAvatarUrl(raw: string): string | undefined {
  const v = raw.trim();
  if (!v) return undefined;
  if (v.startsWith("https://") || v.startsWith("/api/avatars/") || v.startsWith("/avatars/")) {
    return v;
  }
  return undefined;
}

function parseInviteFromQuery() {
  const q = new URLSearchParams(window.location.search);
  return {
    room: q.get("room") ?? "",
    ticket: q.get("ticket") ?? "",
  };
}

function deriveWhipUrl(whipUrl: string, lkUrl?: string): string {
  const direct = whipUrl.trim();
  if (direct) return direct;
  const base = (lkUrl ?? "").trim().replace(/\/+$/, "");
  if (base.startsWith("wss://")) return `https://${base.slice(6)}/w/`;
  if (base.startsWith("ws://")) return `http://${base.slice(5)}/w/`;
  return "";
}

function deriveObsWhipEndpoint(whipUrl: string, streamKey: string): string {
  const base = whipUrl.trim().replace(/\/+$/, "");
  const key = streamKey.trim();
  if (!base || !key) return "";
  return `${base}/${key}`;
}

function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

function isIdentityInUseError(message: string): boolean {
  return message.toLowerCase().includes("identity already in use");
}

export function useRoomState({
  requireInvite,
  api,
  roomId,
  setRoomId,
  userName,
  role,
  setRole,
  joined,
  appSessionToken,
  setJoined,
  setAppSessionToken,
  setHostSessionToken,
  setMessages,
  pushLog,
  avatarPreview,
  avatarUploadDataRef,
  avatarPreviewBlobRef,
  setAvatarPreview,
  setAvatarStatus,
  syncAvatarFromServer,
  onLeaveCleanup,
}: Params) {
  const [inviteCode, setInviteCode] = useState("");
  const [inviteTicket, setInviteTicket] = useState("");
  const [redeemToken, setRedeemToken] = useState("");
  const [hostTotpCode, setHostTotpCode] = useState("");
  const [inviteCopied, setInviteCopied] = useState(false);
  const [sessionExpireAt, setSessionExpireAt] = useState(0);
  const [hostSessionExpireAt, setHostSessionExpireAt] = useState(0);
  const [ingressId, setIngressId] = useState("");
  const [whipUrl, setWhipUrl] = useState("");
  const [streamKey, setStreamKey] = useState("");
  const [showBroadcastModal, setShowBroadcastModal] = useState(false);
  const [joining, setJoining] = useState(false);
  const [reclaiming, setReclaiming] = useState(false);
  const [showReclaimCta, setShowReclaimCta] = useState(false);
  const [actionNotice, setActionNotice] = useState<ActionNotice>(null);
  const [hostEntryUnlocked, setHostEntryUnlocked] = useState(false);

  const inviteMode = Boolean(inviteTicket);
  const effectiveRole: Role = hostEntryUnlocked ? "host" : inviteMode ? "member" : role;
  const showInviteGate = !joined && !inviteMode && !hostEntryUnlocked;
  const isHost = useMemo(
    () => (joined?.role ?? effectiveRole) === "host",
    [joined?.role, effectiveRole],
  );
  const obsWhipEndpoint = useMemo(
    () => deriveObsWhipEndpoint(whipUrl, streamKey),
    [whipUrl, streamKey],
  );

  const showActionNotice = (kind: "ok" | "error", text: string) => {
    setActionNotice({ kind, text });
    window.setTimeout(() => setActionNotice(null), 2600);
  };

  useEffect(() => {
    if (effectiveRole !== "host" && showReclaimCta) {
      setShowReclaimCta(false);
    }
  }, [effectiveRole, showReclaimCta]);

  useEffect(() => {
    const parsed = parseInviteFromQuery();
    if (parsed.room) setRoomId(parsed.room);
    if (parsed.ticket) {
      setInviteTicket(parsed.ticket);
      setRole("member");
      setHostEntryUnlocked(false);
    }
  }, [setRoomId, setRole]);

  const clearClientState = (options?: { clearHostTotp?: boolean; clearMessages?: boolean }) => {
    setJoined(null);
    setAppSessionToken("");
    setHostSessionToken("");
    if (options?.clearHostTotp ?? true) {
      setHostTotpCode("");
    }
    setHostSessionExpireAt(0);
    setSessionExpireAt(0);
    setShowReclaimCta(false);
    if (options?.clearMessages ?? true) {
      setMessages([]);
    }
    localStorage.removeItem(LS_KEYS.joined);
    localStorage.removeItem(LS_KEYS.appSessionToken);
    localStorage.removeItem(LS_KEYS.hostSessionToken);
  };

  const leaveRoom = async () => {
    const shouldNotifyLeave = Boolean(joined && appSessionToken);
    if (shouldNotifyLeave) {
      try {
        const res = await api.leaveRoom();
        pushLog(res.released ? "left room (presence released)" : "left room (presence already cleared)");
      } catch (e) {
        pushLog(`leave notify failed: ${String(e)}`);
      }
    }

    clearClientState({ clearHostTotp: true, clearMessages: true });
    onLeaveCleanup();
    pushLog("left room");
  };

  const joinRoom = async (options?: { skipAutoReclaim?: boolean }) => {
    if (joining) return;
    if (!userName.trim()) throw new Error("name is required");

    setJoining(true);
    try {
      if (joined) {
        await leaveRoom();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      let token = redeemToken.trim();
      let joinAuthToken: string | undefined;
      if ((requireInvite || inviteMode) && effectiveRole === "member" && !token) {
        if (!inviteCode.trim() || !inviteTicket.trim()) {
          throw new Error("invite_code and invite_ticket required");
        }
        const redeem = await api.redeemInvite({
          room_id: roomId.trim(),
          user_name: userName.trim(),
          invite_code: inviteCode.trim(),
          invite_ticket: inviteTicket.trim(),
        });
        token = redeem.redeem_token;
        setRedeemToken(token);
        pushLog("invite redeemed");
      }
      if (effectiveRole === "host") {
        const verified = await api.loginHostWithTotp({
          room_id: roomId.trim(),
          host_identity: userName.trim(),
          totp_code: hostTotpCode.trim(),
        });
        setHostSessionToken(verified.host_session_token);
        setHostSessionExpireAt(Math.floor(Date.now() / 1000) + verified.expires_in_seconds);
        joinAuthToken = verified.host_session_token;
        pushLog("host login verified");
      }

      const normalizedUserName = userName.trim();
      const joinAvatarUrl = persistableAvatarUrl(avatarPreview);
      const joinPayload = {
        room_id: roomId.trim(),
        user_name: normalizedUserName,
        role: effectiveRole,
        nickname: normalizedUserName,
        redeem_token: token || undefined,
        avatar_url: joinAvatarUrl,
      };

      let res: JoinResp;
      try {
        res = await api.join(joinPayload, joinAuthToken);
      } catch (e) {
        const message = errorText(e);
        const shouldAutoReclaim =
          effectiveRole === "host" &&
          !options?.skipAutoReclaim &&
          isIdentityInUseError(message);
        if (!shouldAutoReclaim) {
          throw e;
        }
        const reclaimed = await api.forceReclaimHostLock(
          {
            room_id: roomId.trim(),
            host_identity: userName.trim(),
          },
          joinAuthToken,
        );
        pushLog(
          `host reclaim(auto): ${reclaimed.reason} (stale_age=${reclaimed.stale_age_seconds}s)`,
        );
        res = await api.join(joinPayload, joinAuthToken);
      }

      setJoined(res);
      setShowReclaimCta(false);
      setAppSessionToken(res.app_session_token);
      setHostSessionToken(res.host_session_token ?? "");
      if (res.host_session_token && res.host_session_expires_in_seconds) {
        setHostSessionExpireAt(Math.floor(Date.now() / 1000) + res.host_session_expires_in_seconds);
      }
      setSessionExpireAt(Math.floor(Date.now() / 1000) + res.app_session_expires_in_seconds);
      pushLog(`joined: ${userName} (${res.role})`);
      const pendingAvatarUpload = Boolean(avatarUploadDataRef.current);
      if (!pendingAvatarUpload) {
        syncAvatarFromServer(normalizedUserName, res.avatar_url);
      }
      if (pendingAvatarUpload) {
        try {
          const uploaded = await api.uploadAvatar(avatarUploadDataRef.current, res.app_session_token);
          setAvatarStatus({ kind: "ok", text: "头像上传成功" });
          setAvatarPreview(uploaded.avatar_url);
          saveCachedAvatar(normalizedUserName, uploaded.avatar_url);
          avatarUploadDataRef.current = "";
          if (avatarPreviewBlobRef.current) {
            URL.revokeObjectURL(avatarPreviewBlobRef.current);
            avatarPreviewBlobRef.current = "";
          }
          setMessages((prev) =>
            prev.map((m) =>
              m.user_name === normalizedUserName ? { ...m, avatar_url: uploaded.avatar_url } : m,
            ),
          );
          pushLog(`avatar uploaded: ${uploaded.avatar_url}`);
        } catch (e) {
          avatarUploadDataRef.current = "";
          if (avatarPreviewBlobRef.current) {
            URL.revokeObjectURL(avatarPreviewBlobRef.current);
            avatarPreviewBlobRef.current = "";
          }
          syncAvatarFromServer(normalizedUserName, res.avatar_url);
          setAvatarStatus({
            kind: "error",
            text: res.avatar_url
              ? "头像上传失败，已回退到已保存头像"
              : "头像上传失败，已使用默认头像",
          });
          pushLog(`avatar upload failed: ${String(e)}`);
        }
      }
    } catch (e) {
      const message = errorText(e);
      if (effectiveRole === "host" && isIdentityInUseError(message)) {
        setShowReclaimCta(true);
        showActionNotice("error", "主持身份被占用，可一键回收后重试");
        pushLog("host identity occupied; use force reclaim and retry");
      }
      throw e;
    } finally {
      setJoining(false);
    }
  };

  const forceReclaimAndRetry = async () => {
    if (reclaiming) return;
    setReclaiming(true);
    try {
      const reclaimed = await api.forceReclaimHostLock({
        room_id: roomId.trim(),
        host_identity: userName.trim(),
      });
      pushLog(
        `host reclaim: ${reclaimed.reason} (stale_age=${reclaimed.stale_age_seconds}s)`,
      );
      showActionNotice("ok", "已回收残留会话，正在重试");
      setShowReclaimCta(false);
      await joinRoom({ skipAutoReclaim: true });
    } finally {
      setReclaiming(false);
    }
  };

  const issueInvite = async () => {
    const payload = await api.issueInvite({
      room_id: roomId.trim(),
      host_identity: userName.trim(),
    });

    const expiresAt = new Date(payload.expires_at).toLocaleString();
    const msg = `房间链接：${payload.invite_url}\n邀请码：${payload.invite_code}\n可使用人数：${payload.invite_max_uses}\n有效期至：${expiresAt}`;
    await navigator.clipboard.writeText(msg);

    setInviteCode(payload.invite_code);
    setInviteTicket(payload.invite_ticket);
    setInviteCopied(true);
    window.setTimeout(() => setInviteCopied(false), INVITE_COPY_HINT_MS);
    const hostRoomUrl = `/?room=${encodeURIComponent(roomId.trim())}`;
    window.history.replaceState({}, "", hostRoomUrl);
    setRole("host");
    pushLog("invite issued and copied");
    pushLog(`switched to host room url: ${hostRoomUrl}`);
    showActionNotice("ok", "已复制微信群邀请文案");
  };

  const startBroadcast = async () => {
    const issue = await api.issueBroadcast({
      room_id: roomId.trim(),
      host_identity: userName.trim(),
    });

    const started = await api.startBroadcast({
      room_id: roomId.trim(),
      participant_identity: userName.trim(),
      participant_name: userName.trim(),
      start_token: issue.start_token,
    });

    setIngressId(started.ingress_id);
    setWhipUrl(deriveWhipUrl(started.whip_url, joined?.lk_url));
    setStreamKey(started.stream_key);
    setShowBroadcastModal(true);
    pushLog("broadcast started");
    pushLog("echo-safe tip: OBS 只推桌面+系统音，麦克风请走房间语音");
    showActionNotice("ok", "推流参数已生成");
  };

  const stopBroadcast = async () => {
    if (!ingressId.trim()) throw new Error("ingress_id required");
    await api.stopBroadcast({ ingress_id: ingressId.trim() });
    pushLog("broadcast stopped");
    showActionNotice("ok", "推流已停止");
  };

  const muteAll = async (muted: boolean) => {
    const res = await api.muteAll({
      room_id: roomId.trim(),
      host_identity: userName.trim(),
      muted,
    });
    pushLog(`${muted ? "mute all" : "unmute all"} applied (${res.affected_tracks})`);
    if (res.affected_tracks === 0) {
      showActionNotice(
        "error",
        muted
          ? "未命中可静音麦克风（可能成员未开麦或未发布麦克风）"
          : "未命中可解除的麦克风（可能当前都未被服务端静音）",
      );
    } else {
      showActionNotice("ok", `${muted ? "全员静音" : "解除全员静音"}已应用（${res.affected_tracks}）`);
    }
  };

  const muteOne = async (targetIdentity: string, muted: boolean) => {
    const res = await api.muteMember({
      room_id: roomId.trim(),
      host_identity: userName.trim(),
      target_identity: targetIdentity,
      muted,
    });
    pushLog(`${muted ? "mute" : "unmute"} ${targetIdentity} (${res.affected_tracks})`);
    if (res.affected_tracks === 0) {
      showActionNotice("error", `未命中 ${targetIdentity} 的麦克风轨道`);
    } else {
      showActionNotice(
        "ok",
        `${muted ? "已静音" : "已解除静音"} ${targetIdentity}（${res.affected_tracks}）`,
      );
    }
  };

  const setMemberMediaPermission = async (
    targetIdentity: string,
    feature: StageFeature,
    enabled: boolean,
  ) => {
    const res = await api.setMemberMediaPermission({
      room_id: roomId.trim(),
      host_identity: userName.trim(),
      target_identity: targetIdentity,
      feature,
      enabled,
    });
    const featureText = feature === "camera" ? "摄像头" : "投屏";
    const expiresAt = feature === "camera" ? res.camera_expires_at : res.screen_share_expires_at;
    const expiresHint = enabled && expiresAt
      ? `（有效至 ${new Date(expiresAt * 1000).toLocaleTimeString()}）`
      : "";
    pushLog(
      `${enabled ? "allow" : "deny"} ${feature} ${targetIdentity} (affected=${res.affected_tracks}${expiresAt ? `, expires_at=${expiresAt}` : ""})`,
    );
    showActionNotice(
      "ok",
      `${enabled ? "已允许" : "已关闭"} ${targetIdentity} 的${featureText}${expiresHint}`,
    );
  };

  const run = (fn: () => Promise<void>) => {
    void fn().catch((e) => {
      const message = errorText(e);
      pushLog(message);
      if (showReclaimCta && isIdentityInUseError(message)) {
        return;
      }
      showActionNotice("error", message);
    });
  };

  return {
    inviteCode,
    setInviteCode,
    inviteTicket,
    setInviteTicket,
    hostTotpCode,
    setHostTotpCode,
    inviteCopied,
    sessionExpireAt,
    setSessionExpireAt,
    hostSessionExpireAt,
    setHostSessionExpireAt,
    ingressId,
    whipUrl,
    streamKey,
    setShowBroadcastModal,
    showBroadcastModal,
    joining,
    reclaiming,
    showReclaimCta,
    setShowReclaimCta,
    actionNotice,
    hostEntryUnlocked,
    setHostEntryUnlocked,
    inviteMode,
    effectiveRole,
    showInviteGate,
    isHost,
    obsWhipEndpoint,
    showActionNotice,
    clearClientState,
    leaveRoom,
    joinRoom,
    forceReclaimAndRetry,
    issueInvite,
    startBroadcast,
    stopBroadcast,
    muteAll,
    muteOne,
    setMemberMediaPermission,
    run,
  };
}

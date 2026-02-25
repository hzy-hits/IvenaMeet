import { useEffect, useMemo, useRef, useState } from "react";
import {
    LiveKitRoom,
    AudioTrack,
    VideoTrack,
    useLocalParticipant,
    useParticipants,
    useRoomContext,
    useTracks,
} from "@livekit/components-react";
import { MuchaHalo } from "./mucha-primitives";
import type { TrackReference, TrackReferenceOrPlaceholder } from "@livekit/components-core";
import {
    RoomEvent,
    Track,
    type AudioCaptureOptions,
    type ScreenShareCaptureOptions,
} from "livekit-client";
import {
    Camera,
    CameraOff,
    Mic,
    MicOff,
    Monitor,
    MonitorOff,
    Pin,
    PinOff,
} from "lucide-react";
import type {
    JoinResp,
    MemberItem,
    RealtimeChatPayload,
    Role,
    StageControlPayload,
    StageDecisionPayload,
    StageFeature,
    StageRequestPayload,
} from "../lib/types";

type Props = {
    joined: JoinResp | null;
    roomId: string;
    userName: string;
    role: Role;
    compact?: boolean;
    immersive?: boolean;
    onLocalScreenShareChange?: (enabled: boolean) => void;
    onMembersChange: (members: MemberItem[]) => void;
    onRealtimeChatMessage: (payload: RealtimeChatPayload) => void;
    onRealtimeChatSenderReady: ((sender: ((payload: RealtimeChatPayload) => Promise<void>) | null) => void);
    onVisualMediaChange?: (hasVisualMedia: boolean) => void;
    onHostStagePermissionChange?: (
        targetIdentity: string,
        feature: StageFeature,
        enabled: boolean,
    ) => Promise<void>;
    onLog: (msg: string) => void;
};

function isIngressIdentity(identity: string): boolean {
    return identity.endsWith("__ingress");
}

function isTrackReference(track: TrackReferenceOrPlaceholder): track is TrackReference {
    return !!track.publication;
}

function isLiveVideoTrack(track: TrackReferenceOrPlaceholder): track is TrackReference {
    if (!isTrackReference(track)) return false;
    if (track.publication.isMuted) return false;
    return Boolean(track.publication.track);
}

const CHAT_TOPIC = "chat.message.v1";
const STAGE_CONTROL_TOPIC = "stage.control.v1";
const MAX_HOST_STAGE_REQUESTS = 12;
const MIC_CAPTURE_OPTIONS: AudioCaptureOptions = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
};
const SCREEN_SHARE_CAPTURE_OPTIONS: ScreenShareCaptureOptions = {
    audio: false,
    systemAudio: "exclude",
};

function parseRealtimeChatPayload(payload: Uint8Array): RealtimeChatPayload | null {
    try {
        const raw = new TextDecoder().decode(payload);
        const parsed = JSON.parse(raw) as RealtimeChatPayload;
        if (parsed?.type !== "chat.message") return null;
        if (!parsed.room_id || !parsed.client_id || !parsed.user_name || !parsed.text) return null;
        return parsed;
    } catch {
        return null;
    }
}

function parseStageControlPayload(payload: Uint8Array): StageControlPayload | null {
    try {
        const raw = new TextDecoder().decode(payload);
        const parsed = JSON.parse(raw) as Partial<StageControlPayload>;
        if (!parsed || typeof parsed !== "object") return null;
        if (parsed.type === "stage.request") {
            if (
                typeof parsed.room_id !== "string" ||
                typeof parsed.request_id !== "string" ||
                typeof parsed.target_user !== "string" ||
                (parsed.feature !== "camera" && parsed.feature !== "screen_share") ||
                typeof parsed.created_at !== "number"
            ) {
                return null;
            }
            return parsed as StageRequestPayload;
        }
        if (parsed.type === "stage.decision") {
            if (
                typeof parsed.room_id !== "string" ||
                typeof parsed.request_id !== "string" ||
                typeof parsed.target_user !== "string" ||
                (parsed.feature !== "camera" && parsed.feature !== "screen_share") ||
                typeof parsed.approved !== "boolean" ||
                typeof parsed.decided_by !== "string" ||
                typeof parsed.created_at !== "number"
            ) {
                return null;
            }
            return parsed as StageDecisionPayload;
        }
        return null;
    } catch {
        return null;
    }
}

function pickTrackRef(tracks: TrackReferenceOrPlaceholder[]): TrackReference | undefined {
    return tracks.find(isTrackReference);
}

function createRequestId(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return crypto.randomUUID().replace(/-/g, "");
    }
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function participantSourceEnabled(
    trackPublications: Map<string, unknown>,
    source: Track.Source,
): boolean {
    for (const pub of trackPublications.values() as Iterable<{ source?: Track.Source; isMuted?: boolean }>) {
        if (pub.source === source) {
            return !pub.isMuted;
        }
    }
    return false;
}

function pickPreferredCameraTrack(
    cameraTrackRefs: TrackReference[],
    participants: ReturnType<typeof useParticipants>,
    pinnedIdentity: string | null,
): TrackReference | undefined {
    if (cameraTrackRefs.length === 0) return undefined;

    if (pinnedIdentity) {
        const pinnedTrack = cameraTrackRefs.find((track) => track.participant.identity === pinnedIdentity);
        if (pinnedTrack) return pinnedTrack;
    }

    const activeSpeaker = participants.find((p) => p.isSpeaking && !isIngressIdentity(p.identity));
    if (activeSpeaker) {
        const activeTrack = cameraTrackRefs.find((track) => track.participant.identity === activeSpeaker.identity);
        if (activeTrack) return activeTrack;
    }

    const firstHumanTrack = cameraTrackRefs.find((track) => !isIngressIdentity(track.participant.identity));
    return firstHumanTrack ?? cameraTrackRefs[0];
}

function StageScene({
    role,
    roomId,
    initialCameraAllowed,
    initialScreenShareAllowed,
    onMembersChange,
    onRealtimeChatMessage,
    onRealtimeChatSenderReady,
    onVisualMediaChange,
    onLocalScreenShareChange,
    onHostStagePermissionChange,
    onLog,
    immersive = false,
}: {
    role: Role;
    roomId: string;
    initialCameraAllowed: boolean;
    initialScreenShareAllowed: boolean;
    onMembersChange: (members: MemberItem[]) => void;
    onRealtimeChatMessage: (payload: RealtimeChatPayload) => void;
    onRealtimeChatSenderReady: ((sender: ((payload: RealtimeChatPayload) => Promise<void>) | null) => void);
    onVisualMediaChange?: (hasVisualMedia: boolean) => void;
    onLocalScreenShareChange?: (enabled: boolean) => void;
    onHostStagePermissionChange?: (
        targetIdentity: string,
        feature: StageFeature,
        enabled: boolean,
    ) => Promise<void>;
    onLog: (msg: string) => void;
    immersive?: boolean;
}) {
    const participants = useParticipants();
    const { localParticipant } = useLocalParticipant();
    const room = useRoomContext();

    const isHost = role === "host";
    const [stageNotice, setStageNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
    const [stagePermission, setStagePermission] = useState<Record<StageFeature, boolean>>(
        isHost
            ? { camera: true, screen_share: true }
            : {
                camera: initialCameraAllowed,
                screen_share: initialScreenShareAllowed,
            },
    );
    const [pendingStageAccess, setPendingStageAccess] = useState<Record<StageFeature, boolean>>({
        camera: false,
        screen_share: false,
    });
    const [hostStageRequests, setHostStageRequests] = useState<StageRequestPayload[]>([]);
    const [pinnedIdentity, setPinnedIdentity] = useState<string | null>(null);

    const screenTracks = useTracks([{ source: Track.Source.ScreenShare, withPlaceholder: false }]);
    const cameraTracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: false }]);
    const audioTracks = useTracks([
        { source: Track.Source.Microphone, withPlaceholder: false },
        { source: Track.Source.ScreenShareAudio, withPlaceholder: false },
        { source: Track.Source.Unknown, withPlaceholder: false },
    ]);

    const screenTrack = pickTrackRef(screenTracks.filter(isLiveVideoTrack));
    const cameraTrackRefs = useMemo(
        () => cameraTracks.filter(isLiveVideoTrack),
        [cameraTracks],
    );
    const heroCameraTrack = useMemo(
        () => pickPreferredCameraTrack(cameraTrackRefs, participants, pinnedIdentity),
        [cameraTrackRefs, participants, pinnedIdentity],
    );
    const heroTrack = screenTrack ?? heroCameraTrack;
    const galleryTracks = useMemo(() => {
        const heroTrackSid = heroCameraTrack?.publication.trackSid;
        return cameraTrackRefs
            .filter(
                (track) =>
                    !isIngressIdentity(track.participant.identity) &&
                    track.publication.trackSid !== heroTrackSid,
            )
            .slice(0, 6);
    }, [cameraTrackRefs, heroCameraTrack]);

    const hasStageMedia = Boolean(screenTrack || heroCameraTrack);
    const hasIngressParticipant = participants.some((p) => isIngressIdentity(p.identity));
    const activeParticipantCount = participants.filter((p) => !isIngressIdentity(p.identity)).length;
    const micOn = !!localParticipant?.isMicrophoneEnabled;
    const camOn = !!localParticipant?.isCameraEnabled;
    const shareOn = !!localParticipant?.isScreenShareEnabled;

    const showStageNotice = (kind: "ok" | "error", text: string) => {
        setStageNotice({ kind, text });
        window.setTimeout(() => setStageNotice(null), 2200);
    };

    useEffect(() => {
        setStagePermission(
            isHost
                ? { camera: true, screen_share: true }
                : {
                    camera: initialCameraAllowed,
                    screen_share: initialScreenShareAllowed,
                },
        );
        setPendingStageAccess({ camera: false, screen_share: false });
        setHostStageRequests([]);
        setPinnedIdentity(null);
    }, [isHost, roomId, initialCameraAllowed, initialScreenShareAllowed]);

    useEffect(() => {
        if (!pinnedIdentity) return;
        const stillExists = cameraTrackRefs.some((track) => track.participant.identity === pinnedIdentity);
        if (!stillExists) {
            setPinnedIdentity(null);
        }
    }, [cameraTrackRefs, pinnedIdentity]);

    useEffect(() => {
        onVisualMediaChange?.(hasStageMedia);
    }, [hasStageMedia, onVisualMediaChange]);

    useEffect(() => {
        onLocalScreenShareChange?.(shareOn);
    }, [shareOn, onLocalScreenShareChange]);

    useEffect(() => {
        // Enter room with mic muted by default; user can enable from control bar.
        if (localParticipant?.isMicrophoneEnabled) {
            void localParticipant.setMicrophoneEnabled(false);
        }
    }, [localParticipant]);

    useEffect(() => {
        onMembersChange(
            participants
                .filter((p) => !isIngressIdentity(p.identity))
                .map((p) => ({
                    identity: p.identity,
                    isLocal: p.isLocal,
                    speaking: p.isSpeaking,
                    micEnabled: participantSourceEnabled(
                        p.trackPublications as unknown as Map<string, unknown>,
                        Track.Source.Microphone,
                    ),
                    cameraEnabled: participantSourceEnabled(
                        p.trackPublications as unknown as Map<string, unknown>,
                        Track.Source.Camera,
                    ),
                    screenShareEnabled: participantSourceEnabled(
                        p.trackPublications as unknown as Map<string, unknown>,
                        Track.Source.ScreenShare,
                    ),
                })),
        );
    }, [participants, onMembersChange]);

    useEffect(() => {
        const onData = (payload: Uint8Array, _participant?: unknown, _kind?: unknown, topic?: string) => {
            if (topic === STAGE_CONTROL_TOPIC) {
                const parsed = parseStageControlPayload(payload);
                if (!parsed || parsed.room_id !== roomId) return;

                if (parsed.type === "stage.request") {
                    if (!isHost) return;
                    setHostStageRequests((prev) => [parsed, ...prev.filter((req) => req.request_id !== parsed.request_id)].slice(0, MAX_HOST_STAGE_REQUESTS));
                    const featureText = parsed.feature === "camera" ? "camera" : "screen share";
                    onLog(`stage request: ${parsed.target_user} requested ${featureText}`);
                    return;
                }

                setHostStageRequests((prev) => prev.filter((req) => req.request_id !== parsed.request_id));

                const localIdentity = localParticipant?.identity ?? "";
                if (parsed.target_user !== localIdentity) return;

                setPendingStageAccess((prev) => ({ ...prev, [parsed.feature]: false }));
                if (parsed.approved) {
                    setStagePermission((prev) => ({ ...prev, [parsed.feature]: true }));
                    const text = parsed.feature === "camera" ? "主持人已批准摄像头" : "主持人已批准共享屏幕";
                    showStageNotice("ok", text);
                    onLog(`stage decision: approved ${parsed.feature} by ${parsed.decided_by}`);
                    return;
                }

                const text = parsed.feature === "camera" ? "主持人拒绝了摄像头申请" : "主持人拒绝了共享屏幕申请";
                showStageNotice("error", text);
                onLog(`stage decision: denied ${parsed.feature} by ${parsed.decided_by}`);
                return;
            }

            if (topic && topic !== CHAT_TOPIC) return;
            const parsed = parseRealtimeChatPayload(payload);
            if (!parsed || parsed.room_id !== roomId) return;
            onRealtimeChatMessage(parsed);
        };

        room.on(RoomEvent.DataReceived, onData);
        return () => {
            room.off(RoomEvent.DataReceived, onData);
        };
    }, [room, roomId, isHost, localParticipant, onLog, onRealtimeChatMessage]);

    useEffect(() => {
        if (!localParticipant) {
            onRealtimeChatSenderReady(null);
            return;
        }
        onRealtimeChatSenderReady(async (payload) => {
            const bytes = new TextEncoder().encode(JSON.stringify(payload));
            await localParticipant.publishData(bytes, { reliable: true, topic: CHAT_TOPIC });
        });
        return () => onRealtimeChatSenderReady(null);
    }, [localParticipant, onRealtimeChatSenderReady]);

    const publishStageControl = async (payload: StageControlPayload) => {
        if (!localParticipant) {
            throw new Error("not connected to room");
        }
        const bytes = new TextEncoder().encode(JSON.stringify(payload));
        await localParticipant.publishData(bytes, { reliable: true, topic: STAGE_CONTROL_TOPIC });
    };

    const requestStageAccess = async (feature: StageFeature): Promise<boolean> => {
        if (isHost) return true;
        const targetUser = localParticipant?.identity ?? "";
        if (!targetUser) {
            showStageNotice("error", "当前尚未建立会话，请稍后重试");
            return false;
        }
        if (pendingStageAccess[feature]) {
            const text = feature === "camera" ? "摄像头申请处理中" : "共享屏幕申请处理中";
            showStageNotice("error", text);
            return false;
        }

        const payload: StageRequestPayload = {
            type: "stage.request",
            room_id: roomId,
            request_id: createRequestId(),
            target_user: targetUser,
            feature,
            created_at: Math.floor(Date.now() / 1000),
        };

        try {
            await publishStageControl(payload);
            setPendingStageAccess((prev) => ({ ...prev, [feature]: true }));
            const text = feature === "camera" ? "已向主持人申请开启摄像头" : "已向主持人申请共享屏幕";
            showStageNotice("ok", text);
            onLog(`stage request sent: ${feature}`);
        } catch (e) {
            const text = `发送申请失败：${e instanceof Error ? e.message : String(e)}`;
            showStageNotice("error", text);
            onLog(text);
        }

        return false;
    };

    const decideStageAccess = async (request: StageRequestPayload, approved: boolean) => {
        const decidedBy = localParticipant?.identity ?? "host";
        const payload: StageDecisionPayload = {
            type: "stage.decision",
            room_id: roomId,
            request_id: request.request_id,
            target_user: request.target_user,
            feature: request.feature,
            approved,
            decided_by: decidedBy,
            created_at: Math.floor(Date.now() / 1000),
        };

        try {
            await onHostStagePermissionChange?.(request.target_user, request.feature, approved);
            await publishStageControl(payload);
            setHostStageRequests((prev) => prev.filter((item) => item.request_id !== request.request_id));
            const text = approved
                ? `已批准 ${request.target_user} 的${request.feature === "camera" ? "摄像头" : "共享屏幕"}`
                : `已拒绝 ${request.target_user} 的${request.feature === "camera" ? "摄像头" : "共享屏幕"}`;
            showStageNotice(approved ? "ok" : "error", text);
            onLog(`stage decision sent: ${request.target_user} ${request.feature} ${approved ? "approved" : "denied"}`);
        } catch (e) {
            const text = `发送审批失败：${e instanceof Error ? e.message : String(e)}`;
            showStageNotice("error", text);
            onLog(text);
        }
    };

    const toggleMic = async () => {
        try {
            await localParticipant?.setMicrophoneEnabled(!micOn, MIC_CAPTURE_OPTIONS);
            const text = !micOn ? "麦克风已开启" : "麦克风已关闭";
            showStageNotice("ok", text);
            onLog(text);
        } catch (e) {
            const text = `麦克风操作失败：${e instanceof Error ? e.message : String(e)}`;
            showStageNotice("error", text);
            onLog(text);
        }
    };

    const toggleCamera = async () => {
        if (!camOn && !isHost && !stagePermission.camera) {
            await requestStageAccess("camera");
            return;
        }

        try {
            await localParticipant?.setCameraEnabled(!camOn);
            const text = !camOn ? "摄像头已开启" : "摄像头已关闭";
            showStageNotice("ok", text);
            onLog(text);
        } catch (e) {
            const text = `摄像头操作失败：${e instanceof Error ? e.message : String(e)}`;
            showStageNotice("error", text);
            onLog(text);
        }
    };

    const toggleShare = async () => {
        if (hasIngressParticipant && !shareOn) {
            const text = "OBS 推流中，请勿开启浏览器共享，避免回声";
            showStageNotice("error", text);
            onLog(text);
            return;
        }
        if (!shareOn && !isHost && !stagePermission.screen_share) {
            await requestStageAccess("screen_share");
            return;
        }
        if (!navigator.mediaDevices || !("getDisplayMedia" in navigator.mediaDevices)) {
            const text = "当前设备/浏览器不支持屏幕共享";
            showStageNotice("error", text);
            onLog(text);
            return;
        }
        try {
            await localParticipant?.setScreenShareEnabled(!shareOn, SCREEN_SHARE_CAPTURE_OPTIONS);
            const text = !shareOn ? "已开始共享屏幕（不含系统音）" : "已停止共享屏幕";
            showStageNotice("ok", text);
            onLog(text);
        } catch (e) {
            const text = `共享屏幕失败：${e instanceof Error ? e.message : String(e)}`;
            showStageNotice("error", text);
            onLog(text);
        }
    };

    return (
        <div
            className={`relative h-full w-full overflow-hidden bg-[#1A1A1A] ${immersive ? "rounded-none border-0" : "rounded-panel border border-ink/10 shadow-mucha"
                }`}
        >
            <div className="absolute inset-0">
                {heroTrack ? (
                    <VideoTrack
                        trackRef={heroTrack}
                        className="absolute inset-0 h-full w-full object-contain"
                    />
                ) : (
                    <div className="grid h-full place-items-center text-center text-white/40">
                        <div>
                            <p className="font-display text-lg font-semibold tracking-wide text-white/70">Main Stage</p>
                            <p className="mt-1 font-body text-sm text-white/45">Waiting for screen share / OBS ingress track...</p>
                        </div>
                    </div>
                )}
            </div>

            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(5,10,14,0.32),rgba(5,10,14,0)_30%,rgba(5,10,14,0.36))]" />

            <div className="absolute left-4 right-4 top-4 z-20 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <div className="inline-flex items-center gap-2 rounded-chip border border-ink/10 bg-white/10 backdrop-blur-sm px-3 py-1 backdrop-blur-sm">
                    <span className={`h-2 w-2 rounded-full ${hasStageMedia ? "bg-gold" : "bg-white/35"}`} />
                    <span className="text-white/75">
                        {hasStageMedia ? "video stage online" : "voice lounge"}
                    </span>
                </div>
                <div className="inline-flex flex-wrap items-center gap-1.5">
                    <span className="rounded-chip border border-ink/10 bg-white/10 backdrop-blur-sm px-2.5 py-1 text-white/65">
                        members {activeParticipantCount}
                    </span>
                    <span
                        className={`rounded-chip border px-2.5 py-1 ${hasIngressParticipant
                            ? "border-gold/55 bg-ink/6 text-ink/70"
                            : "border-ink/10 bg-white/10 backdrop-blur-sm text-white/65"
                            }`}
                    >
                        {hasIngressParticipant ? "obs ingress" : "browser feed"}
                    </span>
                    {pinnedIdentity ? (
                        <button
                            type="button"
                            aria-label="取消固定舞台焦点成员"
                            aria-pressed={Boolean(pinnedIdentity)}
                            onClick={() => setPinnedIdentity(null)}
                            className="inline-flex items-center gap-1 rounded-chip border border-gold/55 bg-ink/6 px-2.5 py-1 text-gold transition-colors ease-mucha"
                            title="取消固定"
                        >
                            <PinOff size={12} />
                            pinned
                        </button>
                    ) : null}
                </div>
            </div>

            {isHost && hostStageRequests.length > 0 ? (
                <div className="absolute right-4 top-12 z-30 w-[300px] rounded-panel border border-ink/10 bg-white/15 backdrop-blur-md p-2 shadow-mucha backdrop-blur-md">
                    <p className="px-2 pb-1 font-display text-[11px] font-mono text-ink/60">stage requests</p>
                    <div className="space-y-1.5">
                        {hostStageRequests.map((request) => (
                            <div key={request.request_id} className="rounded-chip border border-ink/8 mucha-panel p-2">
                                <p className="text-xs text-ink/80">
                                    <span className="font-semibold text-ink/70">{request.target_user}</span>
                                    {request.feature === "camera" ? " requests camera" : " requests screen share"}
                                </p>
                                <div className="mt-2 flex items-center gap-1.5">
                                    <button
                                        type="button"
                                        aria-label="批准该舞台请求"
                                        onClick={() => {
                                            void decideStageAccess(request, true);
                                        }}
                                        className="rounded-chip border border-teal/40 bg-teal/15 px-2 py-1 text-[11px] text-teal hover:bg-teal/25"
                                    >
                                        批准
                                    </button>
                                    <button
                                        type="button"
                                        aria-label="拒绝该舞台请求"
                                        onClick={() => {
                                            void decideStageAccess(request, false);
                                        }}
                                        className="rounded-chip border border-coral/40 bg-coral/15 px-2 py-1 text-[11px] text-coral hover:bg-coral/25"
                                    >
                                        拒绝
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}

            {galleryTracks.length > 0 ? (
                <div className="absolute bottom-20 right-4 z-20 flex max-w-[65vw] items-center gap-2 overflow-x-auto pb-1">
                    {galleryTracks.map((trackRef) => {
                        const identity = trackRef.participant.identity;
                        const pinned = pinnedIdentity === identity;
                        return (
                            <button
                                key={`${identity}:${trackRef.publication.trackSid}`}
                                type="button"
                                aria-label={pinned ? `取消固定 ${identity}` : `固定 ${identity}`}
                                aria-pressed={pinned}
                                onClick={() => {
                                    setPinnedIdentity((current) => (current === identity ? null : identity));
                                }}
                                className={`relative h-20 w-32 shrink-0 overflow-hidden rounded-chip border ${pinned ? "border-gold/65" : "border-ink/10"}`}
                                title={pinned ? "取消固定" : `固定 ${identity}`}
                            >
                                <VideoTrack trackRef={trackRef} className="absolute inset-0 h-full w-full object-cover" />
                                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-ink/50 px-1.5 py-1 text-[10px] text-parchment/90">
                                    <span className="truncate">{identity}</span>
                                    {pinned ? <PinOff size={10} /> : <Pin size={10} />}
                                </div>
                            </button>
                        );
                    })}
                </div>
            ) : null}

            <div className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-panel border border-ink/10 bg-white/12 backdrop-blur-md p-1.5 shadow-mucha backdrop-blur-md">
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        className={`press-feedback rounded-chip p-2 transition-colors ease-mucha ${micOn ? "text-teal bg-teal/15" : "text-white/85 hover:mucha-panel"}`}
                        onClick={() => {
                            void toggleMic();
                        }}
                        aria-label={micOn ? "关闭麦克风" : "开启麦克风"}
                        aria-pressed={micOn}
                        title="麦克风"
                    >
                        {micOn ? <Mic size={18} /> : <MicOff size={18} />}
                    </button>
                    <button
                        type="button"
                        className={`press-feedback rounded-chip p-2 transition-colors ease-mucha ${camOn ? "text-gold bg-ink/8" : "text-white/85 hover:mucha-panel"}`}
                        onClick={() => {
                            void toggleCamera();
                        }}
                        aria-label={
                            !isHost && !stagePermission.camera && !camOn
                                ? "申请开启摄像头"
                                : camOn ? "关闭摄像头" : "开启摄像头"
                        }
                        aria-pressed={camOn}
                        title={
                            !isHost && !stagePermission.camera && !camOn
                                ? "申请开启摄像头"
                                : "摄像头"
                        }
                    >
                        {camOn ? <Camera size={18} /> : <CameraOff size={18} />}
                    </button>
                    <button
                        type="button"
                        className={`press-feedback rounded-chip p-2 transition-colors ease-mucha ${shareOn ? "text-gold bg-ink/8" : "text-white/85 hover:mucha-panel"}`}
                        onClick={() => {
                            void toggleShare();
                        }}
                        aria-label={
                            !isHost && !stagePermission.screen_share && !shareOn
                                ? "申请共享屏幕"
                                : shareOn ? "关闭共享屏幕" : "开启共享屏幕"
                        }
                        aria-pressed={shareOn}
                        title={
                            !isHost && !stagePermission.screen_share && !shareOn
                                ? "申请共享屏幕"
                                : "共享屏幕"
                        }
                    >
                        {shareOn ? <Monitor size={18} /> : <MonitorOff size={18} />}
                    </button>
                </div>
            </div>

            {stageNotice ? (
                <div
                    className={`absolute left-1/2 top-16 z-20 -translate-x-1/2 rounded-chip border px-3 py-2 font-body text-xs ${stageNotice.kind === "ok"
                        ? "border-teal/40 bg-teal/10 text-teal"
                        : "border-coral/40 bg-coral/15 text-coral"
                        }`}
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                >
                    {stageNotice.text}
                </div>
            ) : null}

            {audioTracks.map((trackRef) => {
                if (!isTrackReference(trackRef)) return null;
                const identity = trackRef.participant.identity;
                // Host suppresses ingress playback locally to avoid speaker->mic recapture.
                const muteForLocalEchoControl = role === "host" && isIngressIdentity(identity);
                return (
                    <AudioTrack
                        key={`${identity}:${trackRef.publication.trackSid}`}
                        trackRef={trackRef}
                        muted={muteForLocalEchoControl}
                    />
                );
            })}
        </div>
    );
}

export function MainStage({
    joined,
    roomId,
    userName,
    role,
    compact = false,
    immersive = false,
    onLocalScreenShareChange,
    onMembersChange,
    onRealtimeChatMessage,
    onRealtimeChatSenderReady,
    onVisualMediaChange,
    onHostStagePermissionChange,
    onLog,
}: Props) {
    const onLogRef = useRef(onLog);
    const roomIdRef = useRef(roomId);
    const userNameRef = useRef(userName);

    useEffect(() => {
        onLogRef.current = onLog;
    }, [onLog]);

    useEffect(() => {
        roomIdRef.current = roomId;
    }, [roomId]);

    useEffect(() => {
        userNameRef.current = userName;
    }, [userName]);

    useEffect(() => {
        if (!joined) onVisualMediaChange?.(false);
    }, [joined, onVisualMediaChange]);

    const handleConnected = () => {
        onLogRef.current(`livekit connected: ${roomIdRef.current} as ${userNameRef.current}`);
    };

    const handleDisconnected = () => {
        onLogRef.current("livekit disconnected");
    };

    const handleError = (e: Error) => {
        onLogRef.current(`livekit error: ${e?.message ?? String(e)}`);
    };

    if (!joined) {
        return (
            <main className="relative grid h-full min-h-0 place-items-center rounded-panel border border-ink/10 bg-[#1A1A1A] shadow-mucha overflow-hidden">
                <MuchaHalo className="absolute inset-0 m-auto h-[400px] w-[400px]" />
                <div className="relative z-10 text-center">
                    <p className="font-display text-2xl font-semibold text-white/80 tracking-widest">Ivena Meet</p>
                    <p className="mt-3 font-body text-sm text-white/45">Join a room from the Command Center to enter Main Stage.</p>
                </div>
            </main>
        );
    }

    return (
        <main
            className={`relative h-full min-h-0 bg-[#1A1A1A] ${immersive
                ? "rounded-none border-0 p-0 shadow-none backdrop-blur-none"
                : "rounded-panel border border-ink/10 p-2 shadow-mucha lg:p-3"
                } ${compact && !immersive ? "xl:min-h-[420px]" : ""}`}
        >
            <LiveKitRoom
                key={joined.token}
                token={joined.token}
                serverUrl={joined.lk_url}
                connect
                options={{ adaptiveStream: true, dynacast: true }}
                audio={false}
                video={false}
                onConnected={handleConnected}
                onDisconnected={handleDisconnected}
                onError={handleError}
            >
                <StageScene
                    role={role}
                    roomId={roomId}
                    initialCameraAllowed={joined.camera_allowed}
                    initialScreenShareAllowed={joined.screen_share_allowed}
                    onMembersChange={onMembersChange}
                    onRealtimeChatMessage={onRealtimeChatMessage}
                    onRealtimeChatSenderReady={onRealtimeChatSenderReady}
                    onVisualMediaChange={onVisualMediaChange}
                    onLocalScreenShareChange={onLocalScreenShareChange}
                    onHostStagePermissionChange={onHostStagePermissionChange}
                    onLog={onLogRef.current}
                    immersive={immersive}
                />
            </LiveKitRoom>
        </main>
    );
}

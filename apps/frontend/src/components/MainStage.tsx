import { useEffect, useRef, useState } from "react";
import {
    LiveKitRoom,
    AudioTrack,
    VideoTrack,
    useLocalParticipant,
    useParticipants,
    useRoomContext,
    useTracks,
} from "@livekit/components-react";
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
} from "lucide-react";
import type { JoinResp, MemberItem, RealtimeChatPayload, Role } from "../lib/types";

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
    onLog: (msg: string) => void;
};

function isIngressIdentity(identity: string): boolean {
    return identity.endsWith("__ingress");
}

const CHAT_TOPIC = "chat.message.v1";
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

function pickTrackRef(tracks: TrackReferenceOrPlaceholder[]): TrackReference | undefined {
    return tracks.find((t): t is TrackReference => !!t.publication);
}

function participantMicEnabled(trackPublications: Map<string, unknown>): boolean {
    for (const pub of trackPublications.values() as Iterable<{ source?: Track.Source; isMuted?: boolean }>) {
        if (pub.source === Track.Source.Microphone) {
            return !pub.isMuted;
        }
    }
    return false;
}

function StageScene({
    role,
    roomId,
    onMembersChange,
    onRealtimeChatMessage,
    onRealtimeChatSenderReady,
    onVisualMediaChange,
    onLocalScreenShareChange,
    onLog,
    immersive = false,
}: {
    role: Role;
    roomId: string;
    onMembersChange: (members: MemberItem[]) => void;
    onRealtimeChatMessage: (payload: RealtimeChatPayload) => void;
    onRealtimeChatSenderReady: ((sender: ((payload: RealtimeChatPayload) => Promise<void>) | null) => void);
    onVisualMediaChange?: (hasVisualMedia: boolean) => void;
    onLocalScreenShareChange?: (enabled: boolean) => void;
    onLog: (msg: string) => void;
    immersive?: boolean;
}) {
    const participants = useParticipants();
    const { localParticipant } = useLocalParticipant();
    const room = useRoomContext();
    const [stageNotice, setStageNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

    const screenTracks = useTracks([{ source: Track.Source.ScreenShare, withPlaceholder: false }]);
    const cameraTracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: false }]);
    const audioTracks = useTracks([
        { source: Track.Source.Microphone, withPlaceholder: false },
        { source: Track.Source.ScreenShareAudio, withPlaceholder: false },
        { source: Track.Source.Unknown, withPlaceholder: false },
    ]);

    const screenTrack = pickTrackRef(screenTracks);
    const cameraTrack = pickTrackRef(cameraTracks);
    const heroTrack = screenTrack ?? cameraTrack;
    const hasStageMedia = Boolean(screenTrack || cameraTrack);
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
                    micEnabled: participantMicEnabled(p.trackPublications as unknown as Map<string, unknown>),
                })),
        );
    }, [participants, onMembersChange]);

    useEffect(() => {
        const onData = (payload: Uint8Array, _participant?: unknown, _kind?: unknown, topic?: string) => {
            if (topic && topic !== CHAT_TOPIC) return;
            const parsed = parseRealtimeChatPayload(payload);
            if (!parsed || parsed.room_id !== roomId) return;
            onRealtimeChatMessage(parsed);
        };

        room.on(RoomEvent.DataReceived, onData);
        return () => {
            room.off(RoomEvent.DataReceived, onData);
        };
    }, [room, roomId, onRealtimeChatMessage]);

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
        if (role !== "host") {
            const text = "仅主持人可共享屏幕";
            showStageNotice("error", text);
            onLog(text);
            return;
        }
        if (hasIngressParticipant && !shareOn) {
            const text = "OBS 推流中，请勿开启浏览器共享，避免回声";
            showStageNotice("error", text);
            onLog(text);
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
            className={`relative h-full w-full overflow-hidden bg-[radial-gradient(circle_at_20%_0%,rgba(78,205,196,0.14),rgba(8,17,24,0.96)_42%)] ${
                immersive ? "rounded-none border-0" : "rounded-[26px] border border-white/10"
            }`}
        >
            <div className="absolute inset-0">
                {heroTrack ? (
                    <VideoTrack
                        trackRef={heroTrack}
                        className="absolute inset-0 h-full w-full object-contain"
                    />
                ) : (
                    <div className="grid h-full place-items-center text-center text-white/45">
                        <div>
                            <p className="text-lg font-semibold tracking-wide text-white/80">Main Stage</p>
                            <p className="mt-1 text-sm text-white/55">Waiting for screen share / OBS ingress track...</p>
                        </div>
                    </div>
                )}
            </div>

            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(5,10,14,0.32),rgba(5,10,14,0)_30%,rgba(5,10,14,0.36))]" />

            <div className="absolute left-4 right-4 top-4 z-20 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/35 px-3 py-1 backdrop-blur">
                    <span className={`h-2 w-2 rounded-full ${hasStageMedia ? "bg-accent" : "bg-white/45"}`} />
                    <span className="text-white/80">
                        {hasStageMedia ? "video stage online" : "voice lounge"}
                    </span>
                </div>
                <div className="inline-flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full border border-white/15 bg-black/35 px-2.5 py-1 text-white/75">
                        members {activeParticipantCount}
                    </span>
                    <span
                        className={`rounded-full border px-2.5 py-1 ${hasIngressParticipant
                            ? "border-accent/45 bg-accent/10 text-accent"
                            : "border-white/15 bg-black/35 text-white/75"
                            }`}
                    >
                        {hasIngressParticipant ? "obs ingress" : "browser feed"}
                    </span>
                </div>
            </div>

            <div className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-2xl border border-white/10 bg-bg-panel/80 p-1.5 backdrop-blur-md">
                <div className="flex items-center gap-1">
                    <button
                        className={`rounded-xl p-2 transition-colors ${micOn ? "text-ok bg-ok/15" : "text-white/75 hover:bg-white/10"}`}
                        onClick={() => {
                            void toggleMic();
                        }}
                        title="麦克风"
                    >
                        {micOn ? <Mic size={18} /> : <MicOff size={18} />}
                    </button>
                    <button
                        className={`rounded-xl p-2 transition-colors ${camOn ? "text-accent bg-accent/15" : "text-white/75 hover:bg-white/10"}`}
                        onClick={() => {
                            void toggleCamera();
                        }}
                        title="摄像头"
                    >
                        {camOn ? <Camera size={18} /> : <CameraOff size={18} />}
                    </button>
                    <button
                        className={`rounded-xl p-2 transition-colors ${shareOn ? "text-accent bg-accent/15" : "text-white/75 hover:bg-white/10"}`}
                        onClick={() => {
                            void toggleShare();
                        }}
                        title="共享屏幕"
                    >
                        {shareOn ? <Monitor size={18} /> : <MonitorOff size={18} />}
                    </button>
                </div>
            </div>

            {stageNotice ? (
                <div
                    className={`absolute left-1/2 top-16 z-20 -translate-x-1/2 rounded-xl border px-3 py-2 text-xs ${stageNotice.kind === "ok"
                        ? "border-ok/40 bg-ok/10 text-ok"
                        : "border-red-300/40 bg-red-500/20 text-red-100"
                        }`}
                >
                    {stageNotice.text}
                </div>
            ) : null}

            {audioTracks.map((trackRef) => {
                if (!("publication" in trackRef) || !trackRef.publication) return null;
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
            <main className="grid h-full min-h-0 place-items-center rounded-[26px] border border-white/10 bg-[linear-gradient(180deg,rgba(14,26,35,0.92),rgba(8,17,24,0.92))]">
                <div className="text-center">
                    <p className="text-xl font-semibold">Ivena Meet</p>
                    <p className="mt-2 text-sm text-white/55">Join a room from the Command Center to enter Main Stage.</p>
                </div>
            </main>
        );
    }

    return (
        <main
            className={`relative h-full min-h-0 bg-[linear-gradient(180deg,rgba(14,26,35,0.92),rgba(8,17,24,0.92))] ${
                immersive
                    ? "rounded-none border-0 p-0 shadow-none backdrop-blur-none"
                    : "rounded-[26px] border border-white/10 p-2 shadow-[0_20px_70px_rgba(0,0,0,0.38)] backdrop-blur-md lg:p-3"
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
                    onMembersChange={onMembersChange}
                    onRealtimeChatMessage={onRealtimeChatMessage}
                    onRealtimeChatSenderReady={onRealtimeChatSenderReady}
                    onVisualMediaChange={onVisualMediaChange}
                    onLocalScreenShareChange={onLocalScreenShareChange}
                    onLog={onLogRef.current}
                    immersive={immersive}
                />
            </LiveKitRoom>
        </main>
    );
}

import { useEffect, useRef } from "react";
import {
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
} from "livekit-client";
import type { JoinResp, MemberItem, RealtimeChatPayload, Role } from "../lib/types";

type Props = {
    joined: JoinResp | null;
    roomId: string;
    userName: string;
    role: Role;
    compact?: boolean;
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
}: {
    role: Role;
    roomId: string;
    onMembersChange: (members: MemberItem[]) => void;
    onRealtimeChatMessage: (payload: RealtimeChatPayload) => void;
    onRealtimeChatSenderReady: ((sender: ((payload: RealtimeChatPayload) => Promise<void>) | null) => void);
    onVisualMediaChange?: (hasVisualMedia: boolean) => void;
}) {
    const participants = useParticipants();
    const { localParticipant } = useLocalParticipant();
    const room = useRoomContext();

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
    const hasStageMedia = Boolean(
        screenTrack || (cameraTrack && isIngressIdentity(cameraTrack.participant.identity)),
    );
    const hasIngressParticipant = participants.some((p) => isIngressIdentity(p.identity));
    const activeParticipantCount = participants.filter((p) => !isIngressIdentity(p.identity)).length;

    useEffect(() => {
        onVisualMediaChange?.(hasStageMedia);
    }, [hasStageMedia, onVisualMediaChange]);

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

    return (
        <div className="relative h-full w-full overflow-hidden rounded-[26px] border border-white/10 bg-[radial-gradient(circle_at_20%_0%,rgba(78,205,196,0.14),rgba(8,17,24,0.96)_42%)]">
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

    useEffect(() => {
        if (!joined) onVisualMediaChange?.(false);
    }, [joined, onVisualMediaChange]);

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
            className={`relative h-full min-h-0 rounded-[26px] border border-white/10 bg-[linear-gradient(180deg,rgba(14,26,35,0.92),rgba(8,17,24,0.92))] p-2 shadow-[0_20px_70px_rgba(0,0,0,0.38)] backdrop-blur-md lg:p-3 ${compact ? "xl:min-h-[420px]" : ""
                }`}
        >
            <StageScene
                role={role}
                roomId={roomId}
                onMembersChange={onMembersChange}
                onRealtimeChatMessage={onRealtimeChatMessage}
                onRealtimeChatSenderReady={onRealtimeChatSenderReady}
                onVisualMediaChange={onVisualMediaChange}
            />
        </main>
    );
}

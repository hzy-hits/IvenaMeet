import { useCallback, useEffect, useRef, useState } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  VideoTrack,
  useLocalParticipant,
  useParticipants,
  useTracks,
} from "@livekit/components-react";
import type { TrackReference, TrackReferenceOrPlaceholder } from "@livekit/components-core";
import { Track } from "livekit-client";
import {
  Camera,
  CameraOff,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
} from "lucide-react";
import type { JoinResp, MemberItem, Role } from "../lib/types";

type Props = {
  joined: JoinResp | null;
  roomId: string;
  userName: string;
  role: Role;
  onMembersChange: (members: MemberItem[]) => void;
  onLog: (msg: string) => void;
};

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

function StageScene({ role, onMembersChange }: { role: Role; onMembersChange: (members: MemberItem[]) => void }) {
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const [stageNotice, setStageNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const showStageNotice = (kind: "ok" | "error", text: string) => {
    setStageNotice({ kind, text });
    window.setTimeout(() => setStageNotice(null), 2400);
  };

  const screenTracks = useTracks([{ source: Track.Source.ScreenShare, withPlaceholder: false }]);
  const cameraTracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: false }]);

  const heroTrack = pickTrackRef(screenTracks) ?? pickTrackRef(cameraTracks);

  useEffect(() => {
    // Enter room with mic muted by default; user can enable from control bar.
    if (localParticipant?.isMicrophoneEnabled) {
      void localParticipant.setMicrophoneEnabled(false);
    }
  }, [localParticipant]);

  useEffect(() => {
    onMembersChange(
      participants.map((p) => ({
        identity: p.identity,
        isLocal: p.isLocal,
        speaking: p.isSpeaking,
        micEnabled: participantMicEnabled(p.trackPublications as unknown as Map<string, unknown>),
      })),
    );
  }, [participants, onMembersChange]);

  const micOn = !!localParticipant?.isMicrophoneEnabled;
  const camOn = !!localParticipant?.isCameraEnabled;
  const shareOn = !!localParticipant?.isScreenShareEnabled;

  const toggleMic = async () => {
    try {
      await localParticipant?.setMicrophoneEnabled(!micOn);
      showStageNotice("ok", !micOn ? "麦克风已开启" : "麦克风已关闭");
    } catch (e) {
      showStageNotice("error", `麦克风操作失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const toggleCamera = async () => {
    try {
      await localParticipant?.setCameraEnabled(!camOn);
      showStageNotice("ok", !camOn ? "摄像头已开启" : "摄像头已关闭");
    } catch (e) {
      showStageNotice("error", `摄像头操作失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const toggleShare = async () => {
    if (role !== "host") {
      showStageNotice("error", "仅主持人可共享屏幕");
      return;
    }
    if (!navigator.mediaDevices || !("getDisplayMedia" in navigator.mediaDevices)) {
      showStageNotice("error", "当前设备/浏览器不支持屏幕共享");
      return;
    }
    try {
      await localParticipant?.setScreenShareEnabled(!shareOn);
      showStageNotice("ok", !shareOn ? "已开始共享屏幕" : "已停止共享屏幕");
    } catch (e) {
      showStageNotice("error", `共享屏幕失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl bg-bg">
      <div className="absolute inset-0">
        {heroTrack ? (
          <VideoTrack
            trackRef={heroTrack}
            className="absolute inset-0 h-full w-full object-contain"
          />
        ) : (
          <div className="grid h-full place-items-center text-center text-white/45">
            <div>
              <p className="text-lg font-semibold">Main Stage</p>
              <p className="text-sm">Waiting for screen share / OBS ingress track...</p>
            </div>
          </div>
        )}
      </div>

      <div className="absolute bottom-5 left-1/2 z-20 -translate-x-1/2 rounded-2xl border border-white/10 bg-card/80 p-2 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <button
            className={`rounded-xl p-2 ${micOn ? "text-accent" : "text-white"}`}
            onClick={() => {
              void toggleMic();
            }}
            title="Mic"
          >
            {micOn ? <Mic size={18} /> : <MicOff size={18} />}
          </button>
          <button
            className={`rounded-xl p-2 ${camOn ? "text-accent" : "text-white"}`}
            onClick={() => {
              void toggleCamera();
            }}
            title="Camera"
          >
            {camOn ? <Camera size={18} /> : <CameraOff size={18} />}
          </button>
          <button
            className={`rounded-xl p-2 ${shareOn ? "text-accent" : "text-white"}`}
            onClick={() => {
              void toggleShare();
            }}
            title="Share"
          >
            {shareOn ? <Monitor size={18} /> : <MonitorOff size={18} />}
          </button>
        </div>
      </div>

      {stageNotice ? (
        <div
          className={`absolute left-1/2 top-5 z-20 -translate-x-1/2 rounded-xl border px-3 py-2 text-xs ${
            stageNotice.kind === "ok"
              ? "border-ok/40 bg-ok/10 text-ok"
              : "border-red-300/40 bg-red-500/20 text-red-100"
          }`}
        >
          {stageNotice.text}
        </div>
      ) : null}

      <RoomAudioRenderer />
    </div>
  );
}

export function MainStage({ joined, roomId, userName, role, onMembersChange, onLog }: Props) {
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

  const handleConnected = useCallback(() => {
    onLogRef.current(`livekit connected: ${roomIdRef.current} as ${userNameRef.current}`);
  }, []);

  const handleDisconnected = useCallback(() => {
    onLogRef.current("livekit disconnected");
  }, []);

  const handleError = useCallback((e: Error) => {
    onLogRef.current(`livekit error: ${e?.message ?? String(e)}`);
  }, []);

  if (!joined) {
    return (
      <main className="grid min-h-[calc(100vh-1.5rem)] place-items-center rounded-2xl bg-bg">
        <div className="text-center">
          <p className="text-xl font-semibold">Ivena Meet</p>
          <p className="mt-2 text-sm text-white/55">Join a room from the Command Center to enter Main Stage.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-[calc(100vh-1.5rem)] rounded-2xl bg-bg p-2 lg:p-3">
      <LiveKitRoom
        key={joined.token}
        token={joined.token}
        serverUrl={joined.lk_url}
        connect
        audio={false}
        video={false}
        onConnected={handleConnected}
        onDisconnected={handleDisconnected}
        onError={handleError}
      >
        <StageScene role={role} onMembersChange={onMembersChange} />
      </LiveKitRoom>
    </main>
  );
}

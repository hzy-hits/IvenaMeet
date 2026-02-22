import { useEffect } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  VideoTrack,
  useLocalParticipant,
  useParticipants,
  useTracks,
} from "@livekit/components-react";
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

function StageScene({ role, onMembersChange }: { role: Role; onMembersChange: (members: MemberItem[]) => void }) {
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();

  const screenTracks = useTracks([{ source: Track.Source.ScreenShare, withPlaceholder: false }]);
  const cameraTracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: false }]);

  const heroTrack = screenTracks[0] ?? cameraTracks[0];

  useEffect(() => {
    onMembersChange(
      participants.map((p) => ({
        identity: p.identity,
        isLocal: p.isLocal,
        speaking: p.isSpeaking,
      })),
    );
  }, [participants]);

  const micOn = !!localParticipant?.isMicrophoneEnabled;
  const camOn = !!localParticipant?.isCameraEnabled;
  const shareOn = !!localParticipant?.isScreenShareEnabled;

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
            onClick={() => localParticipant?.setMicrophoneEnabled(!micOn)}
            title="Mic"
          >
            {micOn ? <Mic size={18} /> : <MicOff size={18} />}
          </button>
          <button
            className={`rounded-xl p-2 ${camOn ? "text-accent" : "text-white"}`}
            onClick={() => localParticipant?.setCameraEnabled(!camOn)}
            title="Camera"
          >
            {camOn ? <Camera size={18} /> : <CameraOff size={18} />}
          </button>
          <button
            className={`rounded-xl p-2 ${shareOn ? "text-accent" : "text-white"}`}
            onClick={() => {
              if (role !== "host") return;
              void localParticipant?.setScreenShareEnabled(!shareOn);
            }}
            title="Share"
          >
            {shareOn ? <Monitor size={18} /> : <MonitorOff size={18} />}
          </button>
        </div>
      </div>

      <RoomAudioRenderer />
    </div>
  );
}

export function MainStage({ joined, roomId, userName, role, onMembersChange, onLog }: Props) {
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
        token={joined.token}
        serverUrl={joined.lk_url}
        connect
        audio
        video={false}
        onConnected={() => onLog(`livekit connected: ${roomId} as ${userName}`)}
        onDisconnected={() => onLog("livekit disconnected")}
      >
        <StageScene role={role} onMembersChange={onMembersChange} />
      </LiveKitRoom>
    </main>
  );
}

import type { MessageItem } from "../../lib/types";
import { formatChatTime } from "../../lib/chat";
import { resolveAvatarSrc, resolveMessageAvatar } from "../../lib/avatar";

type Variant = "panel" | "sidebar";

type Props = {
  message: MessageItem;
  currentUserName: string;
  variant?: Variant;
};

const VARIANT_BUBBLE: Record<Variant, { mine: string; peer: string }> = {
  panel: {
    mine: "border-accent/50 bg-accent/18 shadow-[0_8px_20px_rgba(78,205,196,0.12)]",
    peer: "border-white/12 bg-black/22",
  },
  sidebar: {
    mine: "border-accent/50 bg-accent/15",
    peer: "border-white/10 bg-black/20",
  },
};

export function ChatMessageRow({
  message,
  currentUserName,
  variant = "panel",
}: Props) {
  const isMine = message.user_name === currentUserName.trim();
  const messageAvatar = resolveMessageAvatar(message.avatar_url, message.user_name);
  const bubbleClass = isMine ? VARIANT_BUBBLE[variant].mine : VARIANT_BUBBLE[variant].peer;

  return (
    <div className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
      <div className={`flex max-w-[90%] items-end gap-2 ${isMine ? "flex-row-reverse" : ""}`}>
        <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full border border-white/15 bg-black/40">
          <div className="grid h-full w-full place-items-center text-[11px] text-white/60">
            {message.nickname.slice(0, 1).toUpperCase()}
          </div>
          {messageAvatar ? (
            <img
              src={resolveAvatarSrc(messageAvatar)}
              alt={message.nickname}
              className="absolute inset-0 h-full w-full object-cover"
              onError={(e) => {
                e.currentTarget.onerror = null;
                e.currentTarget.style.display = "none";
              }}
            />
          ) : null}
        </div>
        <div className={`min-w-0 rounded-2xl border px-3 py-2 ${bubbleClass}`}>
          <div className="mb-1 flex items-center gap-2 text-[11px] text-white/65">
            <span className="max-w-[8rem] truncate font-medium text-white/80">
              {message.nickname}
            </span>
            <span className="rounded bg-white/10 px-1.5 py-0.5 uppercase tracking-wide">
              {message.role}
            </span>
            <span>{formatChatTime(message.created_at)}</span>
            {message.failed ? (
              <span className="text-red-300">发送失败</span>
            ) : message.pending ? (
              <span className="text-accent">发送中</span>
            ) : null}
          </div>
          <p className="whitespace-pre-wrap break-words text-sm leading-5">
            {message.text}
          </p>
        </div>
      </div>
    </div>
  );
}

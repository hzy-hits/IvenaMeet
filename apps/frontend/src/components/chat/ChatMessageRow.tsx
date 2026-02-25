import type { MessageItem } from "../../lib/types";
import { formatChatTime } from "../../lib/chat";
import { resolveAvatarSrc, resolveMessageAvatar } from "../../lib/avatar";

type Variant = "panel" | "sidebar";

type Props = {
    message: MessageItem;
    currentUserName: string;
    variant?: Variant;
    onRetry?: () => void;
    retrying?: boolean;
};

const VARIANT_BUBBLE: Record<Variant, { mine: string; peer: string }> = {
    panel: {
        mine: "border-ink/15 bg-teal/8 shadow-mucha",
        peer: "border-ink/12 bg-parchment/40",
    },
    sidebar: {
        mine: "border-ink/12 bg-teal/6",
        peer: "border-ink/10 bg-rail/30",
    },
};

export function ChatMessageRow({
    message,
    currentUserName,
    variant = "panel",
    onRetry,
    retrying = false,
}: Props) {
    const isMine = message.user_name === currentUserName.trim();
    const messageAvatar = resolveMessageAvatar(message.avatar_url, message.user_name);
    const bubbleClass = isMine ? VARIANT_BUBBLE[variant].mine : VARIANT_BUBBLE[variant].peer;

    return (
        <div className={`flex ${isMine ? "justify-end" : "justify-start"} ${isMine ? "animate-bubble-mine" : "animate-bubble-peer"}`}>
            <div className={`flex max-w-[90%] items-end gap-2 ${isMine ? "flex-row-reverse" : ""}`}>
                {/* Avatar */}
                <div className="relative h-8 w-8 shrink-0 overflow-hidden rounded-full border border-ink/10 bg-parchment/60">
                    <div className="grid h-full w-full place-items-center font-display text-[11px] text-ink/55">
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
                {/* Bubble */}
                <div className={`min-w-0 rounded-panel border px-3 py-2 ${bubbleClass}`}>
                    <div className="mb-1 flex items-center gap-2 text-[11px] text-ink/55">
                        <span className="max-w-[8rem] truncate font-semibold text-indigo">
                            {message.nickname}
                        </span>
                        <span className="rounded-chip bg-ink/8 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-ink/70">
                            {message.role}
                        </span>
                        <span>{formatChatTime(message.created_at)}</span>
                        {message.failed ? (
                            <>
                                <span className="text-coral">发送失败</span>
                                {onRetry ? (
                                    <button
                                        type="button"
                                        onClick={onRetry}
                                        disabled={retrying}
                                        aria-label={retrying ? "正在重发消息" : "重发失败消息"}
                                        className="rounded-chip border border-coral/35 bg-coral/12 px-1.5 py-0.5 text-[10px] text-coral transition-colors hover:bg-coral/18 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {retrying ? "重发中" : "重发"}
                                    </button>
                                ) : null}
                            </>
                        ) : message.pending ? (
                            <span className="text-teal">发送中</span>
                        ) : null}
                    </div>
                    <p className="whitespace-pre-wrap break-words font-body text-sm font-medium leading-5 text-ink">
                        {message.text}
                    </p>
                </div>
            </div>
        </div>
    );
}

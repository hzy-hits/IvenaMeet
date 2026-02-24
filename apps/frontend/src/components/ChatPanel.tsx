import { useEffect, useRef, useState } from "react";
import { MessageCircle, Send } from "lucide-react";
import type { JoinResp, MessageItem } from "../lib/types";
import { messageTailKey } from "../lib/chat";
import { ChatMessageRow } from "./chat/ChatMessageRow";
import { PaperSurface, OrnateDivider } from "./mucha-primitives";

type Props = {
    className?: string;
    joined: JoinResp | null;
    roomId: string;
    userName: string;
    onlineCount: number;
    messages: MessageItem[];
    onSend: (text: string) => Promise<void>;
};

function errorText(e: unknown): string {
    if (e instanceof Error) return e.message;
    return String(e);
}

export function ChatPanel({
    className,
    joined,
    roomId,
    userName,
    onlineCount,
    messages,
    onSend,
}: Props) {
    const [chatText, setChatText] = useState("");
    const [sending, setSending] = useState(false);
    const [actionError, setActionError] = useState("");
    const [pendingHints, setPendingHints] = useState(0);

    const chatScrollRef = useRef<HTMLDivElement>(null);
    const autoScrollRef = useRef(true);
    const tailRef = useRef("empty");

    const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
        const box = chatScrollRef.current;
        if (!box) return;
        box.scrollTo({ top: box.scrollHeight, behavior });
        autoScrollRef.current = true;
        setPendingHints(0);
    };

    const onScroll = () => {
        const box = chatScrollRef.current;
        if (!box) return;
        const distanceToBottom = box.scrollHeight - box.scrollTop - box.clientHeight;
        const isNearBottom = distanceToBottom <= 56;
        autoScrollRef.current = isNearBottom;
        if (isNearBottom && pendingHints) setPendingHints(0);
    };

    useEffect(() => {
        if (!joined) {
            tailRef.current = "empty";
            setPendingHints(0);
            return;
        }
        const box = chatScrollRef.current;
        if (!box) return;
        const nextTail = messageTailKey(messages);
        if (nextTail === tailRef.current) return;
        tailRef.current = nextTail;

        const distanceToBottom = box.scrollHeight - box.scrollTop - box.clientHeight;
        const isNearBottom = distanceToBottom <= 56;
        if (autoScrollRef.current || isNearBottom) {
            scrollToBottom("smooth");
            return;
        }
        setPendingHints((n) => Math.min(n + 1, 99));
    }, [messages, joined]);

    useEffect(() => {
        if (joined) scrollToBottom("auto");
    }, [joined, roomId]);

    const send = async () => {
        const text = chatText.trim();
        if (!joined || !text || sending) return;
        setSending(true);
        setActionError("");
        setChatText("");
        autoScrollRef.current = true;
        setPendingHints(0);
        try {
            await onSend(text);
        } catch (e) {
            setActionError(errorText(e));
            setChatText(text);
        } finally {
            setSending(false);
        }
    };

    return (
        <PaperSurface
            tone="parchment"
            as="section"
            className={`hidden h-full min-h-0 flex-col overflow-hidden rounded-panel p-3 xl:flex xl:p-4 ${className ?? ""}`}
        >
            {/* Header */}
            <div className="mb-3 pb-3">
                <div className="flex items-center justify-between gap-2">
                    <div>
                        <p className="font-display text-[10px] uppercase tracking-[0.14em] text-ink/40">Text Channel</p>
                        <h2 className="mt-1 inline-flex items-center gap-2 font-display text-sm font-semibold tracking-wide text-ink/90">
                            <MessageCircle size={14} /> # room-chat
                        </h2>
                        <p className="mt-1 font-mono text-xs text-ink/45">
                            room: {roomId}
                        </p>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px]">
                        <span className="rounded-chip border border-ink/10 bg-ink/6 px-2.5 py-1 text-ink/65">
                            online {onlineCount}
                        </span>
                        <span className="rounded-chip border border-ink/10 bg-ink/6 px-2.5 py-1 text-ink/65">
                            msgs {messages.length}
                        </span>
                    </div>
                </div>
                <OrnateDivider className="mt-3 mb-0" />
            </div>

            {!joined ? (
                <div className="grid flex-1 place-items-center rounded-panel border border-dashed border-ink/10 mucha-panel text-center font-body text-sm text-ink/45">
                    先加入房间，再开始聊天
                </div>
            ) : (
                <>
                    <div className="relative min-h-0 flex-1">
                        <div
                            ref={chatScrollRef}
                            onScroll={onScroll}
                            className="h-full min-h-0 space-y-2 overflow-y-auto pr-1"
                        >
                            {!messages.length ? (
                                <div className="grid h-full place-items-center rounded-panel border border-dashed border-ink/10 mucha-panel px-3 font-body text-sm text-ink/45">
                                    暂无消息，发送第一条开始聊天
                                </div>
                            ) : (
                                messages.map((m) => (
                                    <ChatMessageRow
                                        key={m.client_id ?? m.id}
                                        message={m}
                                        currentUserName={userName}
                                        variant="panel"
                                    />
                                ))
                            )}
                        </div>
                        {pendingHints > 0 ? (
                            <button
                                type="button"
                                onClick={() => scrollToBottom("smooth")}
                                className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-chip border border-gold/50 bg-parchment/90 px-3 py-1 font-body text-xs font-medium text-gold shadow-gold-glow backdrop-blur-md"
                            >
                                {pendingHints > 1 ? `${pendingHints} 条新消息` : "1 条新消息"}，点击查看
                            </button>
                        ) : null}
                    </div>

                    {/* Input Console */}
                    <div className="mt-2 flex items-center gap-2 rounded-panel border border-ink/10 bg-parchment p-1.5">
                        <input
                            value={chatText}
                            onChange={(e) => setChatText(e.target.value)}
                            placeholder="输入消息，按 Enter 发送"
                            onKeyDown={(e) => {
                                if (e.key === "Enter") void send();
                            }}
                            className="min-w-0 flex-1 bg-transparent px-2 py-2 font-body text-sm text-ink outline-none placeholder:text-ink/35 focus:ring-1 focus:ring-gold/50 focus:rounded-chip"
                        />
                        <button
                            onClick={() => void send()}
                            disabled={sending || !chatText.trim()}
                            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-chip bg-gold leading-none text-canvas font-semibold disabled:cursor-not-allowed disabled:opacity-40 transition-all ease-mucha hover:bg-gold/85 hover:shadow-gold-glow press-feedback"
                        >
                            <Send size={16} />
                        </button>
                    </div>
                    {actionError ? (
                        <p className="mt-1 font-mono text-xs text-coral">{actionError}</p>
                    ) : null}
                </>
            )}
        </PaperSurface>
    );
}

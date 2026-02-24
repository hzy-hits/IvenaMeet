import { useEffect, useRef, useState } from "react";
import { MessageCircle, Send } from "lucide-react";
import type { JoinResp, MessageItem } from "../lib/types";
import { messageTailKey } from "../lib/chat";
import { ChatMessageRow } from "./chat/ChatMessageRow";

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
    <section
      className={`hidden h-full min-h-0 flex-col overflow-hidden rounded-[26px] border border-white/10 bg-[linear-gradient(180deg,rgba(18,35,48,0.9),rgba(10,20,28,0.88))] p-3 shadow-[0_20px_70px_rgba(0,0,0,0.35)] backdrop-blur-md xl:flex xl:p-4 ${className ?? ""}`}
    >
      <div className="mb-3 border-b border-white/10 pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[10px] uppercase tracking-[0.14em] text-white/45">Text Channel</p>
            <h2 className="mt-1 inline-flex items-center gap-2 text-sm font-semibold tracking-wide text-white/95">
              <MessageCircle size={14} /> # room-chat
            </h2>
            <p className="mt-1 text-xs text-white/55">
              room: {roomId}
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="rounded-full border border-white/15 bg-black/25 px-2.5 py-1 text-white/70">
              online {onlineCount}
            </span>
            <span className="rounded-full border border-white/15 bg-black/25 px-2.5 py-1 text-white/70">
              msgs {messages.length}
            </span>
          </div>
        </div>
      </div>

      {!joined ? (
        <div className="grid flex-1 place-items-center rounded-2xl border border-dashed border-white/15 bg-black/20 text-center text-sm text-white/50">
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
                <div className="grid h-full place-items-center rounded-xl border border-dashed border-white/15 bg-black/20 px-3 text-sm text-white/50">
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
                className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full border border-accent/50 bg-card/90 px-3 py-1 text-xs font-medium text-accent shadow-[0_6px_20px_rgba(0,0,0,0.35)] backdrop-blur-md"
              >
                {pendingHints > 1 ? `${pendingHints} 条新消息` : "1 条新消息"}，点击查看
              </button>
            ) : null}
          </div>

          <div className="mt-2 flex items-center gap-2 rounded-xl border border-white/10 bg-black/25 p-1.5">
            <input
              value={chatText}
              onChange={(e) => setChatText(e.target.value)}
              placeholder="输入消息，按 Enter 发送"
              onKeyDown={(e) => {
                if (e.key === "Enter") void send();
              }}
              className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm outline-none placeholder:text-white/45"
            />
            <button
              onClick={() => void send()}
              disabled={sending || !chatText.trim()}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent leading-none text-[#06211f] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send size={16} />
            </button>
          </div>
          {actionError ? (
            <p className="mt-1 text-xs text-red-300">{actionError}</p>
          ) : null}
        </>
      )}
    </section>
  );
}

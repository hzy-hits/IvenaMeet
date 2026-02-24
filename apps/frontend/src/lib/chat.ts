import type { MessageItem } from "./types";

export function formatChatTime(epochSeconds: number): string {
  if (!epochSeconds) return "";
  return new Date(epochSeconds * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function messageTailKey(items: MessageItem[]): string {
  if (!items.length) return "empty";
  const m = items[items.length - 1];
  return `${m.id}:${m.client_id ?? ""}:${m.created_at}:${m.pending ? "1" : "0"}:${m.failed ? "1" : "0"}`;
}

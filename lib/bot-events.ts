import type { Channel, Database } from "./types";
import { hashToken } from "./security";
import { enqueue } from "./domain";

type Obj = Record<string, any>;
const obj = (value: unknown): Obj =>
  value && typeof value === "object" ? (value as Obj) : {};

export function botEventId(channel: Channel, event: unknown) {
  const updateId = obj(event).update_id;
  return channel === "telegram" &&
    Number.isSafeInteger(updateId) &&
    updateId >= 0
    ? `bot-telegram-${hashToken(process.env.TELEGRAM_BOT_TOKEN || "").slice(0, 24)}-update-${updateId}`
    : `bot-${channel}-${hashToken(JSON.stringify(event))}`;
}

export function enqueueBotEvent(d: Database, channel: Channel, event: unknown) {
  const e = obj(event);
  if (channel === "telegram") {
    const message = e.callback_query
      ? obj(e.callback_query).message
      : e.message;
    if (obj(obj(message).chat).type !== "private") return false;
  } else {
    const chatType = obj(obj(e.message).recipient).chat_type;
    if (chatType && chatType !== "dialog") return false;
  }
  const key = botEventId(channel, event);
  if (d.jobs.some((j) => j.id === key) || d.receipts.some((r) => r.id === key))
    return false;
  enqueue(d, { id: key, tutorId: "system", kind: "bot", channel, event });
  return true;
}

import { setTimeout as delay } from "node:timers/promises";
import { telegram } from "./providers";
import { transaction, pool, demoMode } from "./db";
import { hashToken, assert } from "./security";
import { telegramUpdateMode } from "./bot-config";
import { enqueueBotEvent } from "./bot-events";
import { now } from "./domain";

// The system receipt acknowledges only updates already committed to the outbox.
// Its token-specific ID prevents reuse of another bot's offset after token changes.
export function telegramPollCursorId() {
  assert(process.env.TELEGRAM_BOT_TOKEN, "Telegram не подключен", 503);
  return `telegram-poll-${hashToken(process.env.TELEGRAM_BOT_TOKEN).slice(0, 24)}`;
}

export async function pollTelegramUpdates(signal?: AbortSignal) {
  if (
    demoMode() ||
    !process.env.TELEGRAM_BOT_TOKEN ||
    telegramUpdateMode() !== "polling"
  )
    return 0;
  const cursorId = telegramPollCursorId();
  const client = await pool().connect();
  let locked = false;
  try {
    const lock = await client.query(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked",
      [cursorId],
    );
    locked = lock.rows[0].locked;
    if (!locked) return 0;
    const offset = await transaction(
      (d) => d.receipts.find((r) => r.id === cursorId)?.telegramOffset || 0,
      "system",
    );
    const updates: unknown = await telegram(
      "getUpdates",
      {
        offset,
        limit: 100,
        timeout: 20,
        allowed_updates: ["message", "callback_query"],
      },
      signal,
    );
    assert(Array.isArray(updates), "Telegram: некорректный список обновлений");
    return await transaction((d) => {
      let nextOffset = offset,
        added = 0;
      for (const update of updates) {
        const updateId = update?.update_id;
        assert(
          Number.isSafeInteger(updateId) && updateId >= 0,
          "Telegram: некорректный update_id",
        );
        if (updateId < offset) continue;
        if (enqueueBotEvent(d, "telegram", update)) added++;
        nextOffset = Math.max(nextOffset, updateId + 1);
      }
      const checkpoint = d.receipts.find((r) => r.id === cursorId);
      const state = {
        id: cursorId,
        tutorId: "system",
        expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
        telegramOffset: nextOffset,
        telegramPolledAt: now(),
      };
      if (checkpoint) Object.assign(checkpoint, state);
      else d.receipts.push(state);
      return added;
    }, "system");
  } finally {
    try {
      if (locked)
        await client.query(
          "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
          [cursorId],
        );
    } finally {
      // Closing the polling connection also releases its session lock if unlock failed.
      client.release(true);
    }
  }
}

export async function runTelegramPolling(
  signal: AbortSignal,
  onUpdates: () => Promise<void>,
) {
  while (!signal.aborted) {
    let pause = 1000;
    try {
      const count = await pollTelegramUpdates(signal);
      if (signal.aborted) break;
      if (count) await onUpdates();
    } catch (error) {
      if (signal.aborted) break;
      console.error(
        "Telegram polling:",
        error instanceof Error
          ? error.message
          : "Не удалось получить обновления",
      );
      pause = 5000;
    }
    // Back off on errors or when another worker owns the PostgreSQL lock.
    try {
      await delay(pause, undefined, { signal });
    } catch {
      break;
    }
  }
}

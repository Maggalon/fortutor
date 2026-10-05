import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { telegram, maxRequest } from "../lib/providers";
import {
  botWebhookUrl,
  telegramUsername,
  botCommands,
  telegramUpdateMode,
} from "../lib/bot-config";
import { pool } from "../lib/db";
import { telegramPollCursorId } from "../lib/telegram-polling";

console.log(
  process.env.TELEGRAM_PROXY_URL?.trim()
    ? "Telegram: транспорт — HTTP-прокси (TELEGRAM_PROXY_URL задан в этом процессе)"
    : "Telegram: транспорт — прямое подключение (TELEGRAM_PROXY_URL отсутствует в этом процессе)",
);

function safe(message: string) {
  for (const name of [
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_WEBHOOK_SECRET",
    "TELEGRAM_PROXY_URL",
    "MAX_BOT_TOKEN",
    "MAX_WEBHOOK_SECRET",
    "DATABASE_URL",
    "REDIS_URL",
  ]) {
    const value = process.env[name];
    if (value) message = message.replaceAll(value, "[hidden]");
  }
  return message
    .replace(/bot\d+:[\w-]+/g, "bot[hidden]")
    .replace(/https?:\/\/[^\s]+/g, "[URL hidden]")
    .slice(0, 300);
}
function check(ok: boolean, message: string) {
  console.log(`${ok ? "OK" : "FAIL"}: ${safe(message)}`);
  if (!ok) process.exitCode = 1;
}

if (process.env.TELEGRAM_BOT_TOKEN) {
  try {
    const bot = await telegram("getMe", {});
    check(
      bot.username?.toLowerCase() === telegramUsername().toLowerCase(),
      "Telegram: username соответствует токену",
    );
    const info = await telegram("getWebhookInfo", {});
    const mode = telegramUpdateMode();
    console.log(`Telegram: получение сообщений — ${mode}`);
    if (mode === "polling") {
      check(!info.url, "Telegram: webhook отключен для polling");
      if (process.env.DATABASE_URL) {
        const cursor = await pool().query(
          "SELECT data->>'telegramPolledAt' AS polled_at FROM ft_receipts WHERE id=$1",
          [telegramPollCursorId()],
        );
        const polledAt = cursor.rows[0]?.polled_at;
        check(
          !!polledAt && Date.parse(polledAt) > Date.now() - 120000,
          "Telegram: worker успешно опрашивал API за последние две минуты",
        );
        if (polledAt)
          console.log(`Telegram: последний успешный polling=${polledAt}`);
      } else
        check(
          false,
          "Telegram: DATABASE_URL отсутствует; состояние polling недоступно",
        );
    } else {
      check(
        info.url === botWebhookUrl("telegram"),
        "Telegram: webhook соответствует APP_URL",
      );
      check(
        !!process.env.TELEGRAM_WEBHOOK_SECRET,
        "Telegram: секрет webhook задан",
      );
      check(
        ["message", "callback_query"].every(
          (type) =>
            !info.allowed_updates || info.allowed_updates.includes(type),
        ),
        "Telegram: подписка на сообщения и кнопки",
      );
    }
    console.log(
      `Telegram: pending_update_count=${Number(info.pending_update_count || 0)}`,
    );
    if (info.last_error_message)
      console.log(
        `Telegram: последняя ошибка доставки (${new Date(info.last_error_date * 1000).toISOString()}): ${safe(info.last_error_message)}`,
      );
    const commands = await telegram("getMyCommands", {});
    check(
      botCommands.every((c) =>
        commands.some((x: { command: string }) => x.command === c.command),
      ),
      "Telegram: команды актуальны; иначе выполните bots:setup",
    );
  } catch (error) {
    check(
      false,
      `Telegram: ${error instanceof Error ? error.message : "API недоступен"}`,
    );
  }
} else console.log("Telegram: токен не задан");

if (process.env.MAX_BOT_TOKEN) {
  try {
    const bot = await maxRequest("GET", "/me");
    check(!!bot.is_bot, "MAX: токен действителен");
    const result = await maxRequest("GET", "/subscriptions");
    const sub = result.subscriptions?.find(
      (s: { url: string }) => s.url === botWebhookUrl("max"),
    );
    check(
      !!sub,
      "MAX: webhook соответствует APP_URL; иначе выполните bots:setup",
    );
    check(!!process.env.MAX_WEBHOOK_SECRET, "MAX: секрет webhook задан");
    check(
      !!sub &&
        (!sub.update_types ||
          ["bot_started", "message_created", "message_callback"].every((type) =>
            sub.update_types.includes(type),
          )),
      "MAX: подписка на запуск, сообщения и кнопки",
    );
    check(
      botCommands.every((c) =>
        bot.commands?.some((x: { name: string }) => x.name === c.command),
      ),
      "MAX: команды актуальны; иначе выполните bots:setup",
    );
  } catch (error) {
    check(
      false,
      `MAX: ${error instanceof Error ? error.message : "API недоступен"}`,
    );
  }
} else console.log("MAX: токен не задан");

try {
  const heartbeat = Number(
    await readFile(path.join(tmpdir(), "fortutor-worker-heartbeat"), "utf8"),
  );
  check(
    Number.isFinite(heartbeat) && heartbeat > Date.now() - 120000,
    "Worker: heartbeat не старше двух минут (запускайте диагностику внутри worker)",
  );
} catch {
  check(
    false,
    "Worker: heartbeat отсутствует (запускайте диагностику внутри worker)",
  );
}

if (process.env.DATABASE_URL) {
  try {
    const jobs = await pool().query(`
      SELECT COALESCE(j.data->>'channel', b.data->>'channel', 'unknown') AS channel,
        j.data->>'kind' AS kind, j.data->>'status' AS status, count(*)::int AS count,
        min(j.data->>'createdAt') AS oldest
      FROM ft_jobs j LEFT JOIN ft_bindings b ON b.id=j.data->>'bindingId'
      WHERE j.data->>'status' IN ('pending', 'processing', 'failed')
      GROUP BY 1,2,3 ORDER BY 1,2,3
    `);
    console.log(
      "Очередь (без сообщений и идентификаторов пользователей):",
      JSON.stringify(jobs.rows),
    );
    const errors = await pool().query(
      "SELECT data->>'channel' AS channel, data->>'kind' AS kind, data->>'error' AS error FROM ft_jobs WHERE data->>'error' IS NOT NULL AND data->>'status' IN ('pending','failed') ORDER BY data->>'createdAt' DESC LIMIT 10",
    );
    for (const row of errors.rows)
      console.log(
        `${row.channel || "notification"}/${row.kind}: ${safe(row.error)}`,
      );
  } catch {
    check(
      false,
      "PostgreSQL: не удалось прочитать очередь; проверьте доступ и миграции",
    );
  } finally {
    await pool().end();
  }
}

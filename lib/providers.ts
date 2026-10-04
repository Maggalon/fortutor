import type { Channel, Job } from "./types";
import { assert } from "./security";
import { telegramFetch } from "./telegram-transport";
export async function telegram(method: string, body: unknown) {
  assert(process.env.TELEGRAM_BOT_TOKEN, "Telegram не подключен", 503);
  const response = await telegramFetch(
    `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    },
  );
  const result = await response.json();
  if (!response.ok || !result.ok)
    throw new Error(
      `Telegram: ${response.status}; ${result.error_code || "API rejected request"}`,
    );
  return result.result;
}
export async function maxRequest(
  method: string,
  route: string,
  body?: unknown,
) {
  assert(process.env.MAX_BOT_TOKEN, "MAX не подключен", 503);
  const response = await fetch(
    `${process.env.MAX_API_URL || "https://platform-api2.max.ru"}${route}`,
    {
      method,
      headers: {
        Authorization: process.env.MAX_BOT_TOKEN,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(25000),
    },
  );
  const result = await response.json();
  if (!response.ok || result.success === false || result.error)
    throw new Error(`MAX: ${response.status}; API rejected request`);
  return result;
}
export async function sendMessage(
  channel: Channel,
  chatId: string,
  text: string,
  buttons: Job["buttons"] = [],
  attachments: Job["attachments"] = [],
) {
  const message = text.slice(0, 3900);
  if (channel === "telegram") {
    await telegram("sendMessage", {
      chat_id: chatId,
      text: message,
      reply_markup: buttons.length
        ? {
            inline_keyboard: buttons.map((b) => [
              { text: b.text, callback_data: b.data },
            ]),
          }
        : undefined,
    });
    for (const a of attachments)
      await telegram(a.type === "image" ? "sendPhoto" : "sendDocument", {
        chat_id: chatId,
        [a.type === "image" ? "photo" : "document"]: a.token,
      });
  } else
    await maxRequest(
      "POST",
      `/messages?chat_id=${encodeURIComponent(chatId)}`,
      {
        text: message,
        attachments: [
          ...attachments.map((a) => ({
            type: a.type,
            payload: { token: a.token },
          })),
          ...(buttons.length
            ? [
                {
                  type: "inline_keyboard",
                  payload: {
                    buttons: buttons.map((b) => [
                      { type: "callback", text: b.text, payload: b.data },
                    ]),
                  },
                },
              ]
            : []),
        ],
      },
    );
}
export async function readMedia(url: string) {
  const u = new URL(url);
  assert(
    u.protocol === "https:" &&
      ["api.telegram.org", "oneme.ru", "okcdn.ru", "max.ru"].some(
        (host) => u.hostname === host || u.hostname.endsWith(`.${host}`),
      ),
    "Недопустимый адрес медиа",
  );
  const response = await (
    u.hostname === "api.telegram.org" ? telegramFetch : fetch
  )(url, {
    redirect: "error",
    signal: AbortSignal.timeout(25000),
  });
  assert(response.ok && response.body, "Не удалось скачать вложение");
  assert(
    Number(response.headers.get("content-length") || 0) <= 20 * 1024 * 1024,
    "Файл больше 20 МБ",
  );
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 20 * 1024 * 1024) {
      await reader.cancel();
      throw new Error("Файл больше 20 МБ");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

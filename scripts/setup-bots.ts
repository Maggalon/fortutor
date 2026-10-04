import { telegram, maxRequest } from "../lib/providers";
import { assert } from "../lib/security";
assert(
  process.env.APP_URL?.startsWith("https://"),
  "APP_URL должен использовать HTTPS",
);
if (process.env.TELEGRAM_BOT_TOKEN) {
  assert(
    process.env.TELEGRAM_WEBHOOK_SECRET,
    "TELEGRAM_WEBHOOK_SECRET required",
  );
  await telegram("setWebhook", {
    url: `${process.env.APP_URL}/api/webhooks/telegram`,
    secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message", "callback_query"],
  });
  await telegram("setMyCommands", {
    commands: [
      { command: "homework", description: "Сдать домашнее задание" },
      { command: "balance", description: "Баланс занятий" },
      { command: "unlink", description: "Отключить уведомления" },
    ],
  });
  console.log("Telegram webhook configured");
}
if (process.env.MAX_BOT_TOKEN) {
  assert(process.env.MAX_WEBHOOK_SECRET, "MAX_WEBHOOK_SECRET required");
  await maxRequest("POST", "/subscriptions", {
    url: `${process.env.APP_URL}/api/webhooks/max`,
    secret: process.env.MAX_WEBHOOK_SECRET,
    update_types: ["bot_started", "message_created", "message_callback"],
  });
  console.log("MAX webhook configured");
}

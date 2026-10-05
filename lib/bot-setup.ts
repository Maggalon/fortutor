import { telegram, maxRequest } from "./providers";
import { assert } from "./security";
import {
  botCommands,
  botWebhookUrl,
  telegramUsername,
  telegramUpdateMode,
} from "./bot-config";

export async function setupTelegram() {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const mode = telegramUpdateMode();
  if (mode === "webhook")
    assert(
      secret && /^[a-z\d_-]{1,256}$/i.test(secret),
      "Проверьте TELEGRAM_WEBHOOK_SECRET: допустимы A-Z, a-z, 0-9, _ и -",
    );
  const url = mode === "webhook" ? botWebhookUrl("telegram") : "";
  const bot = await telegram("getMe", {});
  assert(
    bot.username?.toLowerCase() === telegramUsername().toLowerCase(),
    "TELEGRAM_BOT_USERNAME не соответствует боту из TELEGRAM_BOT_TOKEN. Исправьте username и пересоздайте web и worker.",
  );
  if (mode === "polling")
    await telegram("deleteWebhook", { drop_pending_updates: false });
  else
    await telegram("setWebhook", {
      url,
      secret_token: secret,
      allowed_updates: ["message", "callback_query"],
    });
  await telegram("setMyCommands", { commands: botCommands });
  await telegram("setChatMenuButton", { menu_button: { type: "commands" } });
  const webhook = await telegram("getWebhookInfo", {});
  assert(
    webhook.url === url,
    mode === "polling"
      ? "Telegram webhook не удален: polling недоступен"
      : "Telegram webhook установлен на другой адрес",
  );
}

export async function setupMax() {
  assert(process.env.MAX_WEBHOOK_SECRET, "MAX_WEBHOOK_SECRET required");
  const url = botWebhookUrl("max");
  await maxRequest("POST", "/subscriptions", {
    url,
    secret: process.env.MAX_WEBHOOK_SECRET,
    update_types: ["bot_started", "message_created", "message_callback"],
  });
  await maxRequest("PATCH", "/me/commands", {
    commands: botCommands.map(({ command, description }) => ({
      name: command,
      description,
    })),
  });
  const result = await maxRequest("GET", "/subscriptions");
  const subscription = result.subscriptions?.find(
    (s: { url: string }) => s.url === url,
  );
  assert(subscription, "MAX webhook не найден после настройки");
  assert(
    !subscription.update_types ||
      ["bot_started", "message_created", "message_callback"].every((type) =>
        subscription.update_types.includes(type),
      ),
    "MAX webhook подписан не на все нужные события",
  );
}

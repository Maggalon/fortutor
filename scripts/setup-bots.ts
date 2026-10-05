import { setupTelegram, setupMax } from "../lib/bot-setup";
import { telegramUpdateMode } from "../lib/bot-config";

for (const [channel, enabled, setup] of [
  ["Telegram", !!process.env.TELEGRAM_BOT_TOKEN, setupTelegram],
  ["MAX", !!process.env.MAX_BOT_TOKEN, setupMax],
] as const) {
  if (!enabled) continue;
  try {
    if (channel === "Telegram")
      console.log(
        process.env.TELEGRAM_PROXY_URL?.trim()
          ? "Telegram setup: HTTP proxy enabled"
          : "Telegram setup: direct connection; TELEGRAM_PROXY_URL is not set",
      );
    await setup();
    console.log(
      `${channel}: ${channel === "Telegram" ? telegramUpdateMode() : "webhook"} and commands configured`,
    );
  } catch (error) {
    console.error(
      `${channel}: ${error instanceof Error ? error.message : "Setup failed"}`,
    );
    process.exitCode = 1;
  }
}

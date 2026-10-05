import { setupTelegram, setupMax } from "../lib/bot-setup";

for (const [channel, enabled, setup] of [
  ["Telegram", !!process.env.TELEGRAM_BOT_TOKEN, setupTelegram],
  ["MAX", !!process.env.MAX_BOT_TOKEN, setupMax],
] as const) {
  if (!enabled) continue;
  try {
    await setup();
    console.log(`${channel}: webhook and commands configured`);
  } catch (error) {
    console.error(
      `${channel}: ${error instanceof Error ? error.message : "Setup failed"}`,
    );
    process.exitCode = 1;
  }
}

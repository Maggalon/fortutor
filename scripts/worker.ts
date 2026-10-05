import { Queue, Worker } from "bullmq";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { demoMode, pool } from "../lib/db";
import { redisConnection, processOutbox } from "../lib/queue";
import { assert } from "../lib/security";
import { billingTick } from "../lib/billing";
import { telegramUpdateMode } from "../lib/bot-config";
import { runTelegramPolling } from "../lib/telegram-polling";
assert(!demoMode(), "Worker требует PostgreSQL и DEMO_MODE=false");
assert(process.env.REDIS_URL, "REDIS_URL required");
const connection = redisConnection(process.env.REDIS_URL);
const heartbeat = path.join(tmpdir(), "fortutor-worker-heartbeat");
const schema = await pool().query(
  "SELECT version FROM ft_schema WHERE version=2",
);
assert(schema.rows.length, "Выполните миграцию v2 перед запуском worker");
const queue = new Queue("for-tutor", { connection });
await queue.upsertJobScheduler(
  "outbox-tick",
  { every: 15000 },
  { name: "tick", data: {}, opts: { removeOnComplete: 20, removeOnFail: 50 } },
);
const worker = new Worker(
  "for-tutor",
  async () => {
    await billingTick();
    await processOutbox();
    await writeFile(heartbeat, String(Date.now()));
  },
  {
    connection,
    concurrency: 1,
  },
);
await writeFile(heartbeat, String(Date.now()));
worker.on("failed", (_job, error) =>
  console.error("Worker tick failed:", error.message),
);
worker.on("error", (error) =>
  console.error("Worker connection error:", error.message),
);
console.log("For Tutor worker online; scheduler every 15 seconds");
const pollingAbort = new AbortController();
const polling =
  process.env.TELEGRAM_BOT_TOKEN && telegramUpdateMode() === "polling"
    ? runTelegramPolling(pollingAbort.signal, async () => {
        await queue.add(
          "tick",
          {},
          {
            jobId: "telegram-outbox",
            removeOnComplete: true,
            removeOnFail: true,
          },
        );
      })
    : Promise.resolve();
if (process.env.TELEGRAM_BOT_TOKEN)
  console.log(
    `Telegram updates: ${telegramUpdateMode()}; transport: ${process.env.TELEGRAM_PROXY_URL?.trim() ? "HTTP proxy" : "direct"}`,
  );
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    pollingAbort.abort();
    await polling;
    await worker.close();
    await queue.close();
    await pool().end();
    process.exit(0);
  });

import { Queue, Worker } from "bullmq";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { demoMode, pool } from "../lib/db";
import { redisConnection, processOutbox } from "../lib/queue";
import { assert } from "../lib/security";
import { billingTick } from "../lib/billing";
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
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, async () => {
    await worker.close();
    await queue.close();
    await pool().end();
    process.exit(0);
  });

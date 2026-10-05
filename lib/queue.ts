import { transaction, demoMode, pool } from "./db";
import { subscriptionView } from "./subscription";
import { schedule, now } from "./domain";
import { processBot } from "./bots";
import { generateReport } from "./reports";
import { sendMessage } from "./providers";

export function redisConnection(raw: string) {
  const url = new URL(raw);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: decodeURIComponent(url.username) || undefined,
    password: decodeURIComponent(url.password) || undefined,
    db: Number(url.pathname.slice(1) || 0),
    tls: url.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

export async function processOutbox(batchSize = 10, pauseMs = 1100) {
  if (demoMode()) await transaction((d) => schedule(d));
  else {
    const tenants = await pool().query(
      "SELECT id FROM ft_accounts WHERE data->>'role'='teacher'",
    );
    for (const t of tenants.rows) await transaction((d) => schedule(d), t.id);
    await transaction((d) => schedule(d), "system");
  }
  for (let i = 0; i < batchSize; i++) {
    const candidate = demoMode()
      ? null
      : (
          await pool().query(
            "SELECT id,tutor_id FROM ft_jobs WHERE (data->>'status'='pending' AND data->>'nextAt'<=$1) OR (data->>'status'='processing' AND COALESCE(data->>'leaseAt',data->>'createdAt')<$2) ORDER BY data->>'nextAt' LIMIT 1",
            [now(), new Date(Date.now() - 300000).toISOString()],
          )
        ).rows[0];
    if (!demoMode() && !candidate) break;
    const job = await transaction((d) => {
      const stamp = now();
      const j = d.jobs.find(
        (j) =>
          (!candidate || j.id === candidate.id) &&
          ((j.status === "pending" && j.nextAt <= stamp) ||
            (j.status === "processing" &&
              Date.now() - Date.parse(j.leaseAt || j.createdAt) > 300000)),
      );
      if (!j) return null;
      if (j.tutorId !== "system" && !subscriptionView(d, j.tutorId).canWrite) {
        j.status = "done";
        j.error = "Пропущено: подписка закончилась";
        return null;
      }
      j.status = "processing";
      j.leaseAt = stamp;
      j.attempts++;
      return structuredClone(j);
    }, candidate?.tutor_id);
    if (!job) continue;
    try {
      if (job.kind === "bot") await processBot(job);
      else if (job.kind === "report")
        await generateReport(job.reportId!, job.tutorId);
      else {
        const binding = job.bindingId
          ? await transaction(
              (d) => d.bindings.find((b) => b.id === job.bindingId),
              job.tutorId,
            )
          : undefined;
        if (binding)
          await sendMessage(
            binding.channel,
            binding.chatId,
            job.text!,
            job.buttons,
            job.attachments,
          );
        else if (!job.bindingId && job.channel && job.chatId)
          await sendMessage(
            job.channel,
            job.chatId,
            job.text!,
            job.buttons,
            job.attachments,
          );
      }
      await transaction((d) => {
        const j = d.jobs.find((x) => x.id === job.id);
        if (!j || j.status !== "processing" || j.leaseAt !== job.leaseAt)
          return;
        j.status = "done";
        j.error = undefined;
      }, job.tutorId);
    } catch (e) {
      await transaction((d) => {
        const j = d.jobs.find((x) => x.id === job.id);
        if (!j || j.status !== "processing" || j.leaseAt !== job.leaseAt)
          return;
        j.error = (e instanceof Error ? e.message : "Ошибка доставки")
          .replace(/bot\d+:[\w-]+/g, "bot[redacted]")
          .slice(0, 250);
        j.status = j.attempts >= 5 ? "failed" : "pending";
        j.nextAt = new Date(
          Date.now() + Math.min(3600000, 30000 * 2 ** j.attempts),
        ).toISOString();
        if (j.kind === "report" && j.status === "failed") {
          const r = d.reports.find((x) => x.id === j.reportId);
          if (r) {
            r.status = "failed";
            r.error = j.error;
          }
        }
      }, job.tutorId);
    }
    if (pauseMs) await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }
}

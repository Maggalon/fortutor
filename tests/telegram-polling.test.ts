import test from "node:test";
import strict from "node:assert/strict";
import { ProxyAgent } from "undici";
import { setupTelegram } from "../lib/bot-setup";
import { telegramUpdateMode } from "../lib/bot-config";
import {
  pollTelegramUpdates,
  telegramPollCursorId,
  runTelegramPolling,
} from "../lib/telegram-polling";
import { enqueueBotEvent, botEventId } from "../lib/bot-events";
import { transaction, migrate, pool } from "../lib/db";
import { seed, empty } from "../lib/seed";
import { id } from "../lib/security";
import { act } from "../lib/domain";
import { processBot } from "../lib/bots";

test("Polling is the default; setup removes webhook through the proxy without deleting pending messages", async () => {
  const env = { ...process.env },
    original = globalThis.fetch;
  delete process.env.TELEGRAM_UPDATE_MODE;
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_BOT_USERNAME = "test_bot";
  process.env.TELEGRAM_PROXY_URL =
    "http://test-user:test-password@127.0.0.1:12345";
  const calls: { method: string; body: any }[] = [];
  globalThis.fetch = async (input, init) => {
    strict.ok(
      (init as RequestInit & { dispatcher?: unknown }).dispatcher instanceof
        ProxyAgent,
    );
    const method = new URL(String(input)).pathname.split("/").at(-1)!;
    calls.push({ method, body: JSON.parse(String(init?.body || "{}")) });
    return Response.json({
      ok: true,
      result:
        method === "getMe"
          ? { username: "test_bot" }
          : method === "getWebhookInfo"
            ? { url: "", pending_update_count: 8 }
            : true,
    });
  };
  try {
    strict.equal(telegramUpdateMode(), "polling");
    await setupTelegram();
    strict.deepEqual(calls.find((c) => c.method === "deleteWebhook")?.body, {
      drop_pending_updates: false,
    });
    strict.equal(
      calls.some((c) => c.method === "setWebhook" || c.method === "getUpdates"),
      false,
    );
    process.env.TELEGRAM_UPDATE_MODE = "invalid";
    strict.throws(telegramUpdateMode, /polling или webhook/);
  } finally {
    process.env = env;
    globalThis.fetch = original;
  }
});

test("Both delivery modes share deduplication and private-chat boundaries", () => {
  const d = empty();
  const message = {
    update_id: 123,
    message: {
      chat: { type: "private", id: 1 },
      from: { id: 1 },
      text: "/help",
    },
  };
  strict.equal(enqueueBotEvent(d, "telegram", message), true);
  strict.equal(
    enqueueBotEvent(d, "telegram", { ...message, transport: "polling" }),
    false,
  );
  strict.equal(d.jobs.length, 1);
  strict.equal(
    enqueueBotEvent(d, "telegram", {
      update_id: 124,
      message: { chat: { type: "group" } },
    }),
    false,
  );
  strict.equal(
    enqueueBotEvent(d, "telegram", {
      update_id: 125,
      callback_query: { message: { chat: { type: "group" } } },
    }),
    false,
  );
  strict.equal(
    enqueueBotEvent(d, "max", {
      message: { recipient: { chat_type: "chat" } },
    }),
    false,
  );
});

test(
  "PostgreSQL polling persists updates before acknowledging, resumes safely, locks across workers and binds through the outbox",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const env = { ...process.env },
      original = globalThis.fetch;
    const uid = `polling-test-${id()}`;
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.DEMO_MODE = "false";
    process.env.TELEGRAM_UPDATE_MODE = "polling";
    process.env.TELEGRAM_BOT_TOKEN = uid;
    process.env.TELEGRAM_BOT_USERNAME = "test_bot";
    process.env.TELEGRAM_PROXY_URL =
      "http://test-user:test-password@127.0.0.1:12345";
    await migrate();
    const cursorId = telegramPollCursorId();
    const updateBase = parseInt(id().slice(0, 7), 16);
    const message = (n: number, text: string, type = "private") => ({
      update_id: updateBase + n,
      marker: uid,
      message: {
        chat: { id: updateBase, type },
        from: { id: updateBase },
        text,
      },
    });
    let updates: any[] = [],
      fail = false;
    let waitForFetch: (() => void) | undefined,
      releaseFetch: (() => void) | undefined;
    let blockFetch = false;
    const offsets: number[] = [];
    globalThis.fetch = async (input, init) => {
      strict.ok(
        (init as RequestInit & { dispatcher?: unknown }).dispatcher instanceof
          ProxyAgent,
      );
      if (String(input).endsWith("/getUpdates")) {
        const body = JSON.parse(String(init?.body));
        strict.deepEqual(body.allowed_updates, ["message", "callback_query"]);
        strict.equal(body.timeout, 20);
        offsets.push(body.offset);
        if (blockFetch)
          await new Promise<void>((resolve) => {
            releaseFetch = resolve;
            waitForFetch?.();
          });
        if (fail)
          return Response.json({ ok: false, error_code: 503 }, { status: 503 });
        return Response.json({ ok: true, result: updates });
      }
      return Response.json({ ok: true, result: true });
    };
    try {
      const fixtures = seed();
      const teacher = {
        ...fixtures.accounts[0],
        id: uid,
        tutorId: uid,
        email: `${uid}@test.invalid`,
      };
      const student = {
        ...fixtures.accounts[1],
        id: `${uid}-account`,
        tutorId: uid,
        studentId: `${uid}-student`,
        email: `${uid}-student@test.invalid`,
      };
      const pupil = {
        ...fixtures.students[0],
        id: student.studentId,
        tutorId: uid,
        parentCode: uid.toUpperCase(),
      };
      const link = await transaction((d) => {
        d.accounts.push(teacher, student);
        d.students.push(pupil);
        return act(d, student, { action: "bot.link", channel: "telegram" }) as {
          code: string;
        };
      });
      updates = [
        message(0, `/start ${link.code}`),
        message(1, "/help"),
        message(2, "ignored", "group"),
        {
          update_id: updateBase + 3,
          marker: uid,
          callback_query: {
            id: "test-callback",
            data: "balance",
            from: { id: updateBase },
            message: {
              chat: { id: updateBase, type: "private" },
              text: "Баланс занятий",
            },
          },
        },
      ];
      strict.equal(await pollTelegramUpdates(), 3);
      const stored = await transaction((d) => ({
        cursor: d.receipts.find((r) => r.id === cursorId)!,
        jobs: d.jobs.filter((j) => (j.event as any)?.marker === uid),
      }));
      strict.equal(stored.cursor.telegramOffset, updateBase + 4);
      strict.ok(stored.cursor.telegramPolledAt);
      strict.equal(stored.jobs.length, 3);
      for (const job of stored.jobs) await processBot(job);
      strict.equal(
        await transaction((d) =>
          d.bindings.some((b) => b.tutorId === uid && b.channel === "telegram"),
        ),
        true,
      );
      const replies = await transaction((d) =>
        d.jobs.filter((j) =>
          stored.jobs.some((event) => j.id.startsWith(`reply-${event.id}-`)),
        ),
      );
      strict.equal(replies.length, 3);
      strict.match(replies[0].text!, /Привязка подтверждена/);
      // A repeated response (including after a restart) uses the persisted offset.
      strict.equal(await pollTelegramUpdates(), 0);
      strict.deepEqual(offsets, [0, updateBase + 4]);
      strict.equal(
        await transaction(
          (d) => d.jobs.filter((j) => (j.event as any)?.marker === uid).length,
        ),
        3,
      );
      // Any malformed update rolls back the whole batch, including the cursor.
      updates = [message(4, "/help"), { marker: uid, update_id: "invalid" }];
      await strict.rejects(pollTelegramUpdates(), /update_id/);
      strict.equal(
        await transaction(
          (d) => d.receipts.find((r) => r.id === cursorId)?.telegramOffset,
        ),
        updateBase + 4,
      );
      strict.equal(
        await transaction((d) =>
          d.jobs.some((j) => j.id === botEventId("telegram", updates[0])),
        ),
        false,
      );
      updates = [message(4, "/help")];
      strict.equal(await pollTelegramUpdates(), 1);
      fail = true;
      await strict.rejects(pollTelegramUpdates(), /503/);
      strict.equal(
        await transaction(
          (d) => d.receipts.find((r) => r.id === cursorId)?.telegramOffset,
        ),
        updateBase + 5,
      );
      fail = false;
      updates = [];
      // A second worker must not call getUpdates while the first holds its lock.
      blockFetch = true;
      const fetchStarted = new Promise<void>((resolve) => {
        waitForFetch = resolve;
      });
      const first = pollTelegramUpdates();
      await fetchStarted;
      const callCount = offsets.length;
      strict.equal(await pollTelegramUpdates(), 0);
      strict.equal(offsets.length, callCount);
      releaseFetch!();
      strict.equal(await first, 0);
      blockFetch = false;
      const abort = new AbortController();
      let notified = false;
      updates = [message(5, "/help")];
      await runTelegramPolling(abort.signal, async () => {
        notified = true;
        abort.abort();
      });
      strict.equal(notified, true);
      strict.equal(
        await transaction(
          (d) => d.receipts.find((r) => r.id === cursorId)?.telegramOffset,
        ),
        updateBase + 6,
      );
      process.env.TELEGRAM_UPDATE_MODE = "webhook";
      const before = offsets.length;
      strict.equal(await pollTelegramUpdates(), 0);
      strict.equal(offsets.length, before);
    } finally {
      releaseFetch?.();
      await transaction((d) => {
        const jobIds = d.jobs
          .filter((j) => (j.event as any)?.marker === uid)
          .map((j) => j.id);
        for (const key of Object.keys(empty()) as (keyof typeof d)[]) {
          const rows = d[key] as { tutorId: string; id: string }[];
          rows.splice(
            0,
            rows.length,
            ...rows.filter(
              (row) =>
                row.tutorId !== uid &&
                row.id !== cursorId &&
                !jobIds.some(
                  (j) => row.id === j || row.id.startsWith(`reply-${j}-`),
                ),
            ),
          );
        }
      });
      await pool().query("DELETE FROM ft_tenants WHERE id=$1", [uid]);
      await pool().end();
      process.env = env;
      globalThis.fetch = original;
    }
  },
);

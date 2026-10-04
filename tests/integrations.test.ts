import test from "node:test";
import strict from "node:assert/strict";
import { Queue, QueueEvents, Worker } from "bullmq";
import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { transaction, migrate, pool } from "../lib/db";
import { empty } from "../lib/seed";
import { act, enqueue, now } from "../lib/domain";
import { authenticate, currentUser } from "../lib/auth";
import { id, hashPassword } from "../lib/security";
import { processBot } from "../lib/bots";
import { generateReport } from "../lib/reports";
import { prepareUpload, verifyUpload } from "../lib/storage";
import { redisConnection, processOutbox } from "../lib/queue";
import type { Account, Channel, Job } from "../lib/types";

test(
  "Integrated bot, files, AI and durable queue scenarios",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.DEMO_MODE = "false";
    process.env.TELEGRAM_BOT_TOKEN = "test-not-a-real-token";
    process.env.TELEGRAM_BOT_USERNAME = "fortutor_test_bot";
    process.env.MAX_BOT_TOKEN = "test-not-a-real-token";
    process.env.MAX_BOT_URL = "https://max.ru/fortutor-test";
    process.env.DEEPSEEK_API_KEY = "test-not-a-real-key";
    process.env.S3_BUCKET = "test-only";
    process.env.S3_ACCESS_KEY_ID = "test-only";
    process.env.S3_SECRET_ACCESS_KEY = "test-only";
    await migrate();
    const uid = `integration-${id()}`;
    const teacher: Account = {
      id: uid,
      tutorId: uid,
      role: "teacher",
      name: "Тестовый преподаватель",
      email: `${uid}@test.invalid`,
      passwordHash: hashPassword("IntegrationPassword!"),
      createdAt: now(),
      paymentDetails: "СБП: тестовые реквизиты",
      timezone: "Europe/Moscow",
      reportDays: 0,
    };
    const fetchOriginal = globalThis.fetch;
    const s3Original = S3Client.prototype.send;
    const sent: { url: string; body: Record<string, any> }[] = [];
    let aiCalls = 0,
      failDelivery = false;
    const pdf = Buffer.from("%PDF-1.7\nTest-only attachment");
    let headSize = pdf.length;
    const s3Commands: unknown[] = [];
    (S3Client.prototype.send as any) = async function (command: any) {
      s3Commands.push(command);
      if (command instanceof HeadObjectCommand)
        return { ContentLength: headSize, ContentType: "application/pdf" };
      if (command instanceof GetObjectCommand)
        return {
          Body: { transformToByteArray: async () => pdf.subarray(0, 8) },
        };
      return {};
    };
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body || "{}"));
      if (url.includes("/file/bot") || url.includes("okcdn.ru"))
        return new Response(pdf, {
          headers: { "Content-Type": "application/pdf" },
        });
      if (url.endsWith("/getFile"))
        return Response.json({
          ok: true,
          result: { file_path: "documents/test.pdf" },
        });
      if (url.endsWith("/chat/completions")) {
        aiCalls++;
        strict.equal(
          JSON.parse(body.messages[1].content).checkedAssignments[0].score,
          8,
        );
        return Response.json({
          choices: [
            {
              message: {
                content:
                  "Как прошли занятия\nОдно занятие проведено.\nЧто получается\nУченик получил 8 из 10.\nНад чем поработать\nНужно проверить знаки.\nСледующий шаг\nПовторить решение уравнений.",
              },
            },
          ],
        });
      }
      sent.push({ url, body });
      if (
        failDelivery &&
        (url.endsWith("/sendMessage") || url.includes("/messages?"))
      )
        return Response.json(
          { ok: false, success: false, error_code: 503 },
          { status: 503 },
        );
      return Response.json({ ok: true, result: true, success: true });
    };
    let student: Account, sid: string, aid: string;
    const botIds: string[] = [];
    async function event(
      channel: Channel,
      text = "",
      callback = "",
      media = false,
    ) {
      const studentEvent = !text.startsWith("PARENT:");
      if (!studentEvent) text = text.slice(7);
      const who = studentEvent ? "101" : "202";
      const j: Job = {
        id: `${uid}-${id()}`,
        tutorId: uid,
        kind: "bot",
        status: "pending",
        channel,
        attempts: 0,
        nextAt: now(),
        createdAt: now(),
        event:
          channel === "telegram"
            ? callback
              ? {
                  callback_query: {
                    id: id(),
                    data: callback,
                    from: { id: who },
                    message: { chat: { id: who, type: "private" } },
                  },
                }
              : {
                  message: {
                    from: { id: who },
                    chat: { id: who, type: "private" },
                    text,
                    ...(media
                      ? {
                          document: {
                            file_id: "test-file",
                            file_name: "answer.pdf",
                            mime_type: "application/pdf",
                          },
                        }
                      : {}),
                  },
                }
            : {
                update_type: callback ? "message_callback" : "message_created",
                callback: callback
                  ? {
                      callback_id: id(),
                      payload: callback,
                      user: { user_id: who },
                    }
                  : undefined,
                message: {
                  sender: { user_id: who },
                  recipient: { chat_id: who, chat_type: "dialog" },
                  body: {
                    text,
                    attachments: media
                      ? [
                          {
                            type: "file",
                            payload: {
                              url: "https://test.okcdn.ru/answer.pdf",
                              filename: "answer.pdf",
                              mime_type: "application/pdf",
                            },
                          },
                        ]
                      : [],
                  },
                },
              },
      };
      botIds.push(j.id);
      await processBot(j);
      return j;
    }
    try {
      await transaction((d) => {
        d.accounts.push(teacher);
        sid = (
          act(d, teacher, {
            action: "student.create",
            name: "Тестовый ученик",
            email: "",
            subject: "Математика",
            grade: "10 класс",
            billing: "lesson",
            rate: 1800,
            packageSize: 8,
            initialBalance: 0,
            note: "",
          }) as { id: string }
        ).id;
        const invite = act(d, teacher, {
          action: "student.invite",
          id: sid,
        }) as { url: string };
        const raw = authenticate(
          d,
          {
            email: `${uid}-student@test.invalid`,
            name: "Тестовый ученик",
            password: "IntegrationPassword!",
            invite: new URL(invite.url).searchParams.get("invite"),
            termsAccepted: true,
            personalDataConsent: true,
          },
          "join",
        );
        student = currentUser(d, raw);
        act(d, teacher, {
          action: "assignment.create",
          title: "Уравнения",
          subject: "Математика",
          text: "Решить и объяснить",
          links: [],
          fileIds: [],
          studentIds: [sid],
          deadline: new Date(Date.now() + 3 * 86400000).toISOString(),
          maxScore: 10,
        });
        aid = d.assignments.at(-1)!.id;
      });
      await t.test(
        "Telegram and MAX bind students and parents; homework file dialog submits once",
        async () => {
          for (const channel of ["telegram", "max"] as const) {
            const link = await transaction(
              (d) =>
                act(d, student, { action: "bot.link", channel }) as {
                  url: string;
                },
            );
            const code = new URL(link.url).searchParams.get("start")!;
            await event(channel, `/start ${code}`);
            const parentCode = await transaction(
              (d) => d.students.find((s) => s.id === sid)!.parentCode,
            );
            await event(channel, `PARENT:${parentCode}`);
            strict.notEqual(
              await transaction(
                (d) => d.students.find((s) => s.id === sid)!.parentCode,
              ),
              parentCode,
            );
            await event(channel, "/homework");
            await event(channel, "", "subject:0");
            await event(channel, "", `task:${aid}`);
            await event(channel, "Ответ с объяснением", "", true);
            const confirmation = await event(channel, "", "confirm");
            await processBot(confirmation);
            const work = await transaction((d) =>
              d.submissions.find(
                (x) => x.studentId === sid && x.assignmentId === aid,
              )!,
            );
            strict.equal(work.fileIds.length, 1);
            strict.equal(work.text, "Ответ с объяснением");
            strict.equal(
              await transaction(
                (d) => d.submissions.filter((x) => x.studentId === sid).length,
              ),
              1,
            );
            await transaction((d) =>
              act(d, teacher, {
                action: "submission.review",
                id: work.id,
                status: channel === "telegram" ? "revision" : "reviewed",
                score: channel === "telegram" ? undefined : 8,
                comment: "Нужно проверить знаки",
              }),
            );
          }
          strict.equal(
            await transaction(
              (d) => d.bindings.filter((x) => x.tutorId === uid).length,
            ),
            4,
          );
        },
      );
      await t.test(
        "Completed lesson queues payment details; DeepSeek saves a factual report and delivers in both channels",
        async () => {
          const reportId = await transaction((d) => {
            const start = new Date(Date.now() - 2 * 3600000).toISOString();
            act(d, teacher, {
              action: "lesson.create",
              title: "Уравнения",
              subject: "Математика",
              studentIds: [sid],
              start,
              duration: 60,
              location: "Онлайн",
              weeks: 1,
            });
            act(d, teacher, {
              action: "lesson.status",
              id: d.lessons.at(-1)!.id,
              status: "completed",
              attendance: {},
            });
            strict.equal(
              d.jobs.filter(
                (j) =>
                  j.tutorId === uid && j.text?.includes(teacher.paymentDetails),
              ).length,
              2,
            );
            return (
              act(d, teacher, {
                action: "report.create",
                studentId: sid,
                from: new Date(Date.now() - 86400000).toISOString(),
                to: now(),
              }) as { id: string }
            ).id;
          });
          await generateReport(reportId);
          await generateReport(reportId);
          strict.equal(aiCalls, 1);
          await processOutbox(100, 0);
          const report = await transaction((d) =>
            d.reports.find((r) => r.id === reportId)!,
          );
          strict.equal(report.status, "ready");
          strict.ok(
            sent.some(
              (x) =>
                x.url.includes("telegram.org") && x.body.text === report.text,
            ),
          );
          strict.ok(
            sent.some(
              (x) => x.url.includes("max.ru") && x.body.text === report.text,
            ),
          );
        },
      );
      await t.test(
        "Direct S3 upload verifies bytes and size, freezes a distinct final object, rejects tampering",
        async () => {
          const upload = await prepareUpload(
            student,
            "answer.pdf",
            "application/pdf",
            pdf.length,
          );
          strict.equal(upload.file.pending, true);
          strict.ok(upload.url.includes("X-Amz-Signature"));
          const finalKey = await verifyUpload(upload.file);
          strict.ok(!finalKey.startsWith("staging/"));
          strict.notEqual(finalKey, upload.file.key);
          strict.notEqual(await verifyUpload(upload.file), finalKey);
          headSize++;
          await strict.rejects(verifyUpload(upload.file), /Размер или тип/);
          strict.ok(s3Commands.length >= 7);
        },
      );
      await t.test(
        "Redis BullMQ runs the outbox; delivery failures retry durably and exhaust at five attempts",
        { skip: !process.env.TEST_REDIS_URL },
        async () => {
          const name = `test-${uid}`,
            connection = redisConnection(process.env.TEST_REDIS_URL!);
          const queue = new Queue(name, { connection }),
            events = new QueueEvents(name, { connection });
          const worker = new Worker(name, () => processOutbox(1, 0), {
            connection,
            concurrency: 1,
          });
          const jid = `${uid}-retry`;
          try {
            await events.waitUntilReady();
            await transaction((d) =>
              enqueue(d, {
                id: jid,
                tutorId: uid,
                kind: "message",
                channel: "telegram",
                chatId: "202",
                text: "Тест повторной доставки",
              }),
            );
            failDelivery = true;
            await (
              await queue.add("tick", {})
            ).waitUntilFinished(events, 10000);
            let j = await transaction((d) => d.jobs.find((j) => j.id === jid)!);
            strict.equal(j.status, "pending");
            strict.equal(j.attempts, 1);
            strict.ok(j.nextAt > now());
            await transaction((d) => {
              const j = d.jobs.find((j) => j.id === jid)!;
              j.nextAt = now();
              j.attempts = 4;
            });
            await (
              await queue.add("tick", {})
            ).waitUntilFinished(events, 10000);
            j = await transaction((d) => d.jobs.find((j) => j.id === jid)!);
            strict.equal(j.status, "failed");
            await transaction((d) =>
              act(d, teacher, { action: "job.retry", id: jid }),
            );
            failDelivery = false;
            await (
              await queue.add("tick", {})
            ).waitUntilFinished(events, 10000);
            j = await transaction((d) => d.jobs.find((j) => j.id === jid)!);
            strict.equal(j.status, "done");
            strict.equal(j.error, undefined);
          } finally {
            await worker.close();
            await events.close();
            await queue.obliterate({ force: true });
            await queue.close();
          }
        },
      );
    } finally {
      globalThis.fetch = fetchOriginal;
      S3Client.prototype.send = s3Original;
      await transaction((d) => {
        for (const key of Object.keys(empty()) as (keyof typeof d)[]) {
          const rows = d[key] as { tutorId: string; id: string }[];
          rows.splice(
            0,
            rows.length,
            ...rows.filter((x) => x.tutorId !== uid && !botIds.includes(x.id)),
          );
        }
      });
      await pool().query("DELETE FROM ft_tenants WHERE id=$1", [uid]);
      await pool().end();
    }
  },
);

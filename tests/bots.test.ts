import test from "node:test";
import strict from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  botLink,
  botWebhookUrl,
  botCommands,
  telegramUsername,
} from "../lib/bot-config";
import { setupTelegram, setupMax } from "../lib/bot-setup";
import { normalize, parseBotCommand, processBot } from "../lib/bots";
import { transaction } from "../lib/db";
import { act, now } from "../lib/domain";
import { seed } from "../lib/seed";
import { hashToken, id } from "../lib/security";
import type { Channel, Job } from "../lib/types";

test("Commands accept whitespace, mentions and arguments without mistaking /starter for /start", () => {
  strict.deepEqual(parseBotCommand("  /HOMEWORK@Test_bot  \n"), {
    name: "homework",
    argument: "",
  });
  strict.deepEqual(parseBotCommand("/start@Test_bot token_123"), {
    name: "start",
    argument: "token_123",
  });
  strict.equal(parseBotCommand("/starter token")?.name, "starter");
  strict.equal(parseBotCommand("ответ /balance"), null);
});

test("Callbacks do not reuse text and attachments of the original bot message", () => {
  for (const channel of ["telegram", "max"] as const) {
    const e = normalize(
      channel,
      channel === "telegram"
        ? {
            callback_query: {
              id: "cb",
              from: { id: 1 },
              data: "help",
              message: {
                chat: { id: 2 },
                text: "/start stale",
                document: { file_id: "stale" },
              },
            },
          }
        : {
            update_type: "message_callback",
            callback: {
              callback_id: "cb",
              user: { user_id: 1 },
              payload: "help",
            },
            message: {
              recipient: { chat_id: 2 },
              body: {
                text: "/start stale",
                attachments: [
                  { type: "file", payload: { url: "https://max.ru/stale" } },
                ],
              },
            },
          },
    );
    strict.equal(e.chatId, "2");
    strict.equal(e.userId, "1");
    strict.equal(e.text, "");
    strict.deepEqual(e.media, []);
    strict.equal(e.callback, "help");
  }
});

test("Bot setup verifies identity, configures commands in both messengers and preserves pending updates", async () => {
  const env = { ...process.env };
  const original = globalThis.fetch;
  process.env.APP_URL = "https://for-tutor.ru/";
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_BOT_USERNAME = " @test_bot ";
  process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret";
  process.env.MAX_BOT_TOKEN = "test-token";
  process.env.MAX_WEBHOOK_SECRET = "test-secret-max";
  process.env.MAX_BOT_URL = "https://max.ru/test_bot?other=1&start=old";
  const requests: { url: string; method?: string; body: any }[] = [];
  let username = "test_bot";
  globalThis.fetch = async (input, init) => {
    const url = String(input),
      body = JSON.parse(String(init?.body || "{}"));
    requests.push({ url, method: init?.method, body });
    if (url.endsWith("/getMe"))
      return Response.json({ ok: true, result: { username } });
    if (url.endsWith("/getWebhookInfo"))
      return Response.json({
        ok: true,
        result: { url: botWebhookUrl("telegram") },
      });
    if (url.endsWith("/subscriptions") && init?.method === "GET")
      return Response.json({
        subscriptions: [
          {
            url: botWebhookUrl("max"),
            update_types: [
              "bot_started",
              "message_created",
              "message_callback",
            ],
          },
        ],
      });
    return Response.json({ ok: true, result: true, success: true });
  };
  try {
    strict.equal(telegramUsername(), "test_bot");
    strict.equal(telegramUsername("https://t.me/test_bot/"), "test_bot");
    const link = botLink("telegram", "code");
    strict.equal(link.url, "https://t.me/test_bot?start=code");
    strict.equal(link.appUrl, "tg://resolve?domain=test_bot&start=code");
    strict.throws(() => telegramUsername("test_bot?start=bad"));
    const maxLink = new URL(botLink("max", "code").url);
    strict.equal(maxLink.searchParams.get("start"), "code");
    strict.equal(maxLink.searchParams.getAll("start").length, 1);
    strict.equal(maxLink.searchParams.get("other"), "1");
    await setupTelegram();
    await setupMax();
    const webhook = requests.find((x) => x.url.endsWith("/setWebhook"))!;
    strict.equal(
      webhook.body.url,
      "https://for-tutor.ru/api/webhooks/telegram",
    );
    strict.deepEqual(webhook.body.allowed_updates, [
      "message",
      "callback_query",
    ]);
    strict.equal(webhook.body.drop_pending_updates, undefined);
    strict.deepEqual(
      requests.find((x) => x.url.endsWith("/setMyCommands"))!.body.commands,
      botCommands,
    );
    strict.deepEqual(
      requests.find((x) => x.url.endsWith("/me/commands"))!.body.commands,
      botCommands.map(({ command, description }) => ({
        name: command,
        description,
      })),
    );
    username = "another_bot";
    const count = requests.filter((x) => x.url.endsWith("/setWebhook")).length;
    await strict.rejects(setupTelegram(), /не соответствует/);
    strict.equal(
      requests.filter((x) => x.url.endsWith("/setWebhook")).length,
      count,
    );
  } finally {
    globalThis.fetch = original;
    process.env = env;
  }
});

test("Telegram and MAX: real bot processing links accounts, handles commands during homework and unlinks cleanly", async (t) => {
  const cwd = process.cwd(),
    env = { ...process.env };
  const original = globalThis.fetch;
  const dir = await mkdtemp(path.join(tmpdir(), "fortutor-bots-test-"));
  await mkdir(path.join(dir, "certs"));
  await copyFile(
    path.join(cwd, "certs", "max-ca.pem"),
    path.join(dir, "certs", "max-ca.pem"),
  );
  await mkdir(path.join(dir, ".data"));
  await writeFile(
    path.join(dir, ".data", "database.json"),
    JSON.stringify(seed()),
  );
  process.env.DEMO_MODE = "true";
  process.env = { ...process.env, NODE_ENV: "test" };
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_BOT_USERNAME = "@test_bot";
  process.env.MAX_BOT_TOKEN = "test-token";
  process.env.MAX_BOT_URL = "https://max.ru/test_bot";
  globalThis.fetch = async () =>
    Response.json({ ok: true, result: true, success: true });
  process.chdir(dir);
  try {
    for (const channel of ["telegram", "max"] as const) {
      await t.test(channel, async () => {
        const student = await transaction((d) => d.accounts[1]);
        const chatId = channel === "max" ? "-12345" : "101";
        async function event(
          text = "",
          callback = "",
          who = "101",
          started = false,
        ) {
          const chat = who === "101" ? chatId : who;
          const j: Job = {
            id: id(),
            tutorId: "system",
            kind: "bot",
            channel,
            status: "pending",
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
                        message: {
                          chat: { id: chat, type: "private" },
                          text: "Подтвердить отправку",
                        },
                      },
                    }
                  : {
                      message: {
                        from: { id: who },
                        chat: { id: chat, type: "private" },
                        text,
                      },
                    }
                : started
                  ? {
                      update_type: "bot_started",
                      chat_id: chat,
                      user: { user_id: who },
                      payload: text,
                    }
                  : {
                      update_type: callback
                        ? "message_callback"
                        : "message_created",
                      ...(callback
                        ? {
                            callback: {
                              callback_id: id(),
                              user: { user_id: who },
                              payload: callback,
                            },
                          }
                        : {}),
                      message: {
                        sender: { user_id: who },
                        recipient: { chat_id: chat, chat_type: "dialog" },
                        body: {
                          text: callback ? "Подтвердить отправку" : text,
                        },
                      },
                    },
          };
          await processBot(j);
          const reply = await transaction((d) =>
            d.jobs.find((x) => x.id.startsWith(`reply-${j.id}-`)),
          );
          strict.ok(reply, `No reply for ${text || callback}`);
          return { reply, job: j };
        }
        const link = await transaction(
          (d) =>
            act(d, student, { action: "bot.link", channel }) as {
              url: string;
              code: string;
            },
        );
        strict.equal(new URL(link.url).searchParams.get("start"), link.code);
        strict.equal(
          await transaction((d) =>
            d.linkTokens.some((x) => x.tokenHash === hashToken(link.code)),
          ),
          true,
        );
        const linked = await event(
          channel === "max" ? link.code : `/start@test_bot ${link.code}`,
          "",
          "101",
          channel === "max",
        );
        strict.match(linked.reply.text!, /Привязка подтверждена/);
        await processBot(linked.job);
        strict.equal(
          await transaction(
            (d) =>
              d.bindings.filter(
                (b) => b.channel === channel && b.role === "student",
              ).length,
          ),
          1,
        );
        for (const command of ["/start", " /HELP@test_bot \n"])
          strict.match((await event(command)).reply.text!, /\/homework/);
        strict.match((await event("/balance")).reply.text!, /занятий/);
        strict.match((await event("", "balance")).reply.text!, /занятий/);
        strict.match(
          (await event("/HOMEWORK@test_bot")).reply.text!,
          /Выберите предмет/,
        );
        const subject = (await event("", "subject:0")).reply.buttons![0].data;
        await event("", subject);
        await event("Мой ответ");
        for (const command of ["/balance", "/help", "/start", "/unknown"])
          await event(command);
        strict.equal(
          await transaction(
            (d) =>
              d.flows.find((f) =>
                d.bindings.some(
                  (b) => b.id === f.bindingId && b.channel === channel,
                ),
              )?.text,
          ),
          "Мой ответ",
        );
        await event("/cancel");
        strict.equal(
          await transaction(
            (d) =>
              d.flows.filter((f) =>
                d.bindings.some(
                  (b) => b.id === f.bindingId && b.channel === channel,
                ),
              ).length,
          ),
          0,
        );
        await event("", subject);
        await event("Новый ответ");
        const submitted = await event("", "confirm");
        strict.match(submitted.reply.text!, /Работа отправлена/);
        await processBot(submitted.job);
        strict.equal(
          await transaction(
            (d) => d.submissions.filter((s) => s.text === "Новый ответ").length,
          ),
          1,
        );
        // Make the same task available for the second channel.
        await transaction((d) => {
          d.submissions
            .filter((s) => s.assignmentId === subject.slice(5))
            .forEach((s) => {
              s.status = "revision";
            });
        });
        const parentCode = await transaction(
          (d) => d.students.find((s) => s.id === student.studentId)!.parentCode,
        );
        strict.match(
          (await event(parentCode, "", "202")).reply.text!,
          /Привязка подтверждена/,
        );
        strict.match(
          (await event("/balance@test_bot", "", "202")).reply.text!,
          /занятий/,
        );
        strict.match(
          (await event("/start old-code", "", "303")).reply.text!,
          /недействительна/,
        );
        await event("", subject);
        await event("/unlink@test_bot");
        strict.equal(
          await transaction((d) =>
            d.bindings.some(
              (b) => b.channel === channel && b.role === "student",
            ),
          ),
          false,
        );
        strict.equal(
          await transaction(
            (d) =>
              d.flows.filter(
                (f) => !d.bindings.some((b) => b.id === f.bindingId),
              ).length,
          ),
          0,
        );
      });
    }
  } finally {
    process.chdir(cwd);
    process.env = env;
    globalThis.fetch = original;
    strict.equal(path.dirname(path.resolve(dir)), path.resolve(tmpdir()));
    await rm(dir, { recursive: true, force: true });
  }
});

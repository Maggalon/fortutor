import type { Channel, Database, Job, Account, StoredFile } from "./types";
import { transaction } from "./db";
import { enqueue, now, submit, finance } from "./domain";
import { id, hashToken, assert, AppError } from "./security";
import { limit } from "./auth";
import { telegram, maxRequest, readMedia } from "./providers";
import { storeFile } from "./storage";
import { assertSubscription, subscriptionView } from "./subscription";
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown) =>
  typeof v === "string" || typeof v === "number" ? String(v) : "";
export interface BotEvent {
  chatId: string;
  userId: string;
  text: string;
  callback: string;
  callbackId: string;
  media: { fileId?: string; url?: string; name: string; mime: string }[];
}
export function normalize(channel: Channel, event: unknown): BotEvent {
  const e = obj(event);
  if (channel === "telegram") {
    const cb = obj(e.callback_query),
      message = obj(e.message || cb.message),
      from = obj(cb.from || message.from),
      chat = obj(message.chat),
      doc = obj(message.document);
    const photos = Array.isArray(message.photo) ? message.photo : [];
    const photo = obj(photos[photos.length - 1]);
    return {
      chatId: str(chat.id),
      userId: str(from.id),
      text: e.callback_query ? "" : str(message.text || message.caption),
      callback: str(cb.data),
      callbackId: str(cb.id),
      media: e.callback_query
        ? []
        : doc.file_id
          ? [
              {
                fileId: str(doc.file_id),
                name: str(doc.file_name) || "работа.pdf",
                mime: str(doc.mime_type),
              },
            ]
          : photo.file_id
            ? [
                {
                  fileId: str(photo.file_id),
                  name: "фото.jpg",
                  mime: "image/jpeg",
                },
              ]
            : [],
    };
  }
  const cb = obj(e.callback),
    message = obj(e.message),
    body = obj(message.body),
    recipient = obj(message.recipient),
    user = obj(cb.user || message.sender || e.user);
  const attachments = Array.isArray(body.attachments) ? body.attachments : [];
  return {
    chatId: str(recipient.chat_id ?? e.chat_id),
    userId: str(user.user_id),
    text:
      (e.callback ? "" : str(body.text)) ||
      (e.update_type === "bot_started" ? `/start ${str(e.payload)}` : ""),
    callback: str(cb.payload),
    callbackId: str(cb.callback_id),
    media: (e.callback ? [] : attachments)
      .filter((a) => ["image", "file"].includes(str(obj(a).type)))
      .map((a) => {
        const item = obj(a),
          p = obj(item.payload);
        return {
          url: str(p.url),
          name:
            str(p.filename || p.file_name) ||
            (item.type === "image" ? "фото.jpg" : "работа.pdf"),
          mime:
            item.type === "image"
              ? "image/jpeg"
              : str(p.mime_type) || "application/pdf",
        };
      }),
  };
}
export function parseBotCommand(text: string) {
  const match = text
    .trim()
    .match(/^\/([a-z\d_]+)(?:@[a-z\d_]+)?(?:\s+([\s\S]*))?$/i);
  return match
    ? { name: match[1].toLowerCase(), argument: (match[2] || "").trim() }
    : null;
}
const studentButtons = [
  { text: "Сдать ДЗ", data: "homework" },
  { text: "Баланс занятий", data: "balance" },
  { text: "Помощь", data: "help" },
];
const parentButtons = [
  { text: "Баланс детей", data: "balance" },
  { text: "Помощь", data: "help" },
];
function reply(
  d: Database,
  j: Job,
  e: BotEvent,
  text: string,
  buttons: Job["buttons"] = [],
) {
  enqueue(d, {
    id: `reply-${j.id}-${hashToken(text).slice(0, 10)}`,
    tutorId: j.tutorId,
    kind: "message",
    channel: j.channel,
    chatId: e.chatId,
    text,
    buttons,
  });
}
function studentAccount(
  d: Database,
  tutorId: string,
  studentId: string,
): Account {
  const a = d.accounts.find(
    (x) => x.studentId === studentId && x.tutorId === tutorId,
  );
  assert(a, "Ученик сначала должен зарегистрироваться на сайте");
  return a;
}
export async function processBot(j: Job) {
  try {
    await processBotEvent(j);
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    const e = normalize(j.channel!, j.event);
    if (!e.chatId) return;
    await transaction((d) => {
      reply(d, j, e, error.message);
      if (!d.receipts.some((x) => x.id === j.id))
        d.receipts.push({
          id: j.id,
          tutorId: "system",
          expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
        });
    });
  }
}
async function processBotEvent(j: Job) {
  const e = normalize(j.channel!, j.event);
  if (!e.chatId || !e.userId) return;
  const command = parseBotCommand(e.text);
  const action = e.callback || command?.name || "";
  if (e.callbackId) {
    try {
      if (j.channel === "telegram")
        await telegram("answerCallbackQuery", {
          callback_query_id: e.callbackId,
        });
      else
        await maxRequest(
          "POST",
          `/answers?callback_id=${encodeURIComponent(e.callbackId)}`,
          { notification: "Принято" },
        );
    } catch {
      /* Callback acknowledgments can expire while queued; processing still proceeds. */
    }
  }
  const prep = await transaction((d) => {
    if (d.receipts.some((x) => x.id === j.id)) return null;
    const linked = d.bindings.filter(
      (x) =>
        x.channel === j.channel &&
        x.userId === e.userId &&
        x.chatId === e.chatId,
    );
    const b = linked.find((x) => x.role === "student");
    return b
      ? {
          binding: b,
          account: studentAccount(d, b.tutorId, b.studentId),
          flow: d.flows.find(
            (x) => x.bindingId === b.id && x.expiresAt > now(),
          ),
        }
      : null;
  });
  const uploaded: StoredFile[] = [];
  if (
    prep?.flow &&
    !action &&
    e.media.length &&
    (await transaction(
      (d) => subscriptionView(d, prep.binding.tutorId).canWrite,
      prep.binding.tutorId,
    ))
  ) {
    for (const media of e.media.slice(0, 10)) {
      let url = media.url;
      if (media.fileId) {
        const f = await telegram("getFile", { file_id: media.fileId });
        assert(
          f.file_path && !String(f.file_path).includes(".."),
          "Некорректное вложение",
        );
        url = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${f.file_path}`;
      }
      assert(url, "Вложение недоступно");
      const bytes = await readMedia(url);
      let mime = media.mime;
      if (bytes[0] === 137) mime = "image/png";
      else if (bytes[0] === 255) mime = "image/jpeg";
      uploaded.push(await storeFile(prep.account, media.name, mime, bytes));
    }
  }
  try {
    await transaction((d) => {
      if (d.receipts.some((x) => x.id === j.id)) return;
      const code =
        command?.name === "start"
          ? command.argument
          : command
            ? ""
            : e.text.trim();
      if (code && !e.callback && !e.media.length) {
        const lt = d.linkTokens.find(
          (x) =>
            x.channel === j.channel &&
            x.tokenHash === hashToken(code) &&
            x.expiresAt > now(),
        );
        const s = d.students.find((x) => x.parentCode === code.toUpperCase());
        if (lt || s) {
          const studentId = lt?.studentId || s!.id,
            tutorId = lt?.tutorId || s!.tutorId,
            role = lt ? ("student" as const) : ("parent" as const);
          assertSubscription(d, tutorId);
          const conflict = d.bindings.find(
            (b) =>
              b.channel === j.channel &&
              b.userId === e.userId &&
              b.role === "student",
          );
          assert(
            !conflict || role === "parent" || conflict.studentId === studentId,
            "Этот мессенджер уже привязан к другому ученику",
          );
          const existing = d.bindings.find(
            (b) =>
              b.tutorId === tutorId &&
              b.studentId === studentId &&
              b.channel === j.channel &&
              b.userId === e.userId &&
              b.role === role,
          );
          if (existing) existing.chatId = e.chatId;
          else
            d.bindings.push({
              id: id(),
              tutorId,
              studentId,
              role,
              channel: j.channel!,
              chatId: e.chatId,
              userId: e.userId,
              createdAt: now(),
            });
          if (lt) d.linkTokens = d.linkTokens.filter((x) => x.id !== lt.id);
          reply(
            d,
            j,
            e,
            `Привязка подтверждена. ${role === "parent" ? "Вы будете получать уведомления об оплате и отчеты. Код действует один раз; для второго родителя запросите новый." : "Нажмите «Сдать ДЗ», чтобы отправить работу. /balance — баланс занятий, /help — помощь."}`,
            role === "student" ? studentButtons : parentButtons,
          );
          if (s) s.parentCode = tokenCode();
          d.receipts.push({
            id: j.id,
            tutorId: "system",
            expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
          });
          return;
        }
        if (
          command?.name === "start" &&
          !limit(d, `bot-code:${j.channel}:${e.userId}`, 10, 15)
        ) {
          reply(d, j, e, "Слишком много попыток. Подождите 15 минут.");
          d.receipts.push({
            id: j.id,
            tutorId: "system",
            expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
          });
          return;
        }
        if (command?.name === "start") {
          reply(
            d,
            j,
            e,
            "Ссылка подключения недействительна или уже использована. Получите новую в настройках кабинета ученика. Родителю нужен актуальный код от преподавателя.",
          );
          d.receipts.push({
            id: j.id,
            tutorId: "system",
            expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
          });
          return;
        }
      }
      const bindings = d.bindings.filter(
          (x) =>
            x.channel === j.channel &&
            x.chatId === e.chatId &&
            x.userId === e.userId,
        ),
        b = bindings.find((x) => x.role === "student");
      if (!bindings.length) {
        if (!limit(d, `bot-code:${j.channel}:${e.userId}`, 10, 15)) {
          reply(d, j, e, "Слишком много попыток. Подождите 15 минут.");
        } else
          reply(
            d,
            j,
            e,
            "Здравствуйте! Родителю: отправьте код привязки от преподавателя. Ученику: откройте ссылку подключения в кабинете.",
          );
      } else if (action === "unlink") {
        d.flows = d.flows.filter(
          (x) => !bindings.some((b) => b.id === x.bindingId),
        );
        d.bindings = d.bindings.filter(
          (x) => !bindings.some((b) => b.id === x.id),
        );
        reply(
          d,
          j,
          e,
          "Привязка удалена. Для подключения понадобится новая ссылка или код.",
        );
      } else if (action === "balance") {
        reply(
          d,
          j,
          e,
          (b ? [b] : bindings)
            .map((b) => {
              const s = d.students.find(
                (x) => x.id === b.studentId && x.tutorId === b.tutorId,
              )!;
              const f = finance(d, s);
              return `${s.name}: ${s.billing === "package" ? `${f.balance} занятий` : `долг ${f.debt} ₽`}`;
            })
            .join("\n"),
          b ? studentButtons : parentButtons,
        );
      } else if (action === "start" || action === "help") {
        reply(
          d,
          j,
          e,
          b
            ? "Ваш аккаунт подключен.\n/homework — сдать ДЗ\n/balance — баланс занятий\n/cancel — отменить отправку ДЗ\n/unlink — отключить бота\n/help — помощь\nНапоминания о занятиях и результаты проверки приходят автоматически."
            : "Уведомления об оплате и отчеты придут автоматически.\n/balance — баланс детей\n/unlink — отключить уведомления\n/help — помощь",
          b ? studentButtons : parentButtons,
        );
      } else if (!b) {
        reply(
          d,
          j,
          e,
          "Уведомления и отчеты придут автоматически. /balance: баланс детей. /unlink: отключить уведомления.",
          parentButtons,
        );
      } else if (action === "cancel") {
        d.flows = d.flows.filter((x) => x.bindingId !== b.id);
        reply(d, j, e, "Отправка отменена.", studentButtons);
      } else if (command && !["homework", "confirm"].includes(action)) {
        reply(
          d,
          j,
          e,
          "Неизвестная команда. /help — список команд.",
          studentButtons,
        );
      } else {
        const studentId = b.studentId,
          u = studentAccount(d, b.tutorId, studentId);
        assertSubscription(d, b.tutorId);
        const active = d.assignments.filter(
          (a) =>
            a.tutorId === b.tutorId &&
            a.studentIds.includes(studentId) &&
            !a.archived &&
            !d.submissions.some(
              (s) =>
                s.assignmentId === a.id &&
                s.studentId === studentId &&
                s.status !== "revision",
            ),
        );
        if (
          action === "homework" ||
          e.text.trim().toLowerCase() === "сдать дз"
        ) {
          d.flows = d.flows.filter((x) => x.bindingId !== b.id);
          const subjects = [...new Set(active.map((a) => a.subject))];
          reply(
            d,
            j,
            e,
            subjects.length
              ? "Выберите предмет:"
              : "Все работы отправлены. Новых заданий пока нет.",
            subjects
              .slice(0, 25)
              .map((s, i) => ({ text: s, data: `subject:${i}` })),
          );
        } else if (e.callback.startsWith("subject:")) {
          const subjects = [...new Set(active.map((a) => a.subject))],
            subject = subjects[Number(e.callback.slice(8))];
          const items = active.filter((a) => a.subject === subject);
          reply(
            d,
            j,
            e,
            "Выберите задание:",
            items
              .slice(0, 25)
              .map((a) => ({ text: a.title, data: `task:${a.id}` })),
          );
        } else if (e.callback.startsWith("task:")) {
          const a = active.find((x) => x.id === e.callback.slice(5));
          assert(a, "Задание уже недоступно. Нажмите «Сдать ДЗ» снова.");
          d.flows = d.flows.filter((x) => x.bindingId !== b.id);
          d.flows.push({
            id: id(),
            tutorId: b.tutorId,
            bindingId: b.id,
            assignmentId: a.id,
            fileIds: [],
            text: "",
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
          });
          reply(
            d,
            j,
            e,
            `${a.title}\nОтправьте JPG, PNG или PDF до 20 МБ. Можно добавить текст. Затем подтвердите отправку.`,
            [{ text: "Отменить", data: "cancel" }],
          );
        } else {
          const flow = d.flows.find(
            (x) => x.bindingId === b.id && x.expiresAt > now(),
          );
          if (action === "confirm") {
            assert(flow, "Сначала выберите задание");
            submit(
              d,
              b.tutorId,
              studentId,
              flow.assignmentId,
              flow.text,
              flow.fileIds,
              u,
            );
            d.flows = d.flows.filter((x) => x.id !== flow.id);
            reply(d, j, e, "Работа отправлена преподавателю.", [
              { text: "Сдать другое ДЗ", data: "homework" },
            ]);
          } else if (flow && !action) {
            assert(
              flow.fileIds.length + uploaded.length <= 10,
              "Можно прикрепить максимум 10 файлов",
            );
            d.files.push(...uploaded);
            flow.fileIds.push(...uploaded.map((x) => x.id));
            if (e.text)
              flow.text = (flow.text + "\n" + e.text).trim().slice(0, 20000);
            reply(
              d,
              j,
              e,
              `Добавлено файлов: ${flow.fileIds.length}. ${flow.text ? "Текст сохранен." : ""} Можно отправить еще файл или подтвердить.`,
              [
                { text: "Подтвердить отправку", data: "confirm" },
                { text: "Отменить", data: "cancel" },
              ],
            );
          } else
            reply(
              d,
              j,
              e,
              "Выберите действие. /help — список команд.",
              studentButtons,
            );
        }
      }
      d.receipts.push({
        id: j.id,
        tutorId: "system",
        expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      });
    });
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    await transaction((d) => {
      reply(d, j, e, error.message, [{ text: "Сдать ДЗ", data: "homework" }]);
      d.receipts.push({
        id: j.id,
        tutorId: "system",
        expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      });
    });
  }
}
function tokenCode() {
  return id().slice(0, 16).toUpperCase();
}

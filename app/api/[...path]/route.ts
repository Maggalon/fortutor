import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { ZodError } from "zod";
import { transaction, demoMode, pool } from "@/lib/db";
import { act, snapshot, enqueue, now, canReadFile } from "@/lib/domain";
import {
  authenticate,
  currentUser,
  sessionToken,
  setSession,
  makeSession,
  limit,
  userTransaction,
} from "@/lib/auth";
import {
  checkout,
  cancelAutoRenew,
  billingWebhook,
  paymentHistory,
  processPayment,
} from "@/lib/billing";
import { assertSubscription, subscriptionView } from "@/lib/subscription";
import { AppError, assert, hashToken, safeEqual } from "@/lib/security";
import {
  storeFile,
  downloadFile,
  prepareUpload,
  verifyUpload,
} from "@/lib/storage";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
type Context = { params: Promise<{ path: string[] }> };
function failure(e: unknown) {
  if (e instanceof ZodError)
    return Response.json(
      {
        error: "Проверьте поля формы",
        details: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      },
      { status: 400 },
    );
  if (e instanceof AppError)
    return Response.json({ error: e.message }, { status: e.status });
  console.error("API error", e instanceof Error ? e.message : "unknown");
  return Response.json(
    { error: "Не удалось выполнить запрос. Попробуйте еще раз." },
    { status: 500 },
  );
}
async function json(req: Request) {
  const body = await req.text();
  assert(Buffer.byteLength(body) <= 256 * 1024, "Запрос слишком большой", 413);
  try {
    return JSON.parse(body);
  } catch {
    throw new AppError("Некорректный JSON");
  }
}
export async function GET(req: NextRequest, ctx: Context) {
  try {
    const p = (await ctx.params).path.join("/");
    if (p === "health") {
      if (!demoMode()) await pool().query("SELECT 1");
      return Response.json({
        ok: true,
        service: "for-tutor",
        demo: demoMode(),
      });
    }
    const raw = await sessionToken();
    if (p === "state")
      return Response.json(
        await userTransaction(raw, (d, u) => snapshot(d, u)),
        { headers: { "Cache-Control": "private, no-store" } },
      );
    if (p === "billing")
      return Response.json(
        await userTransaction(raw, (d, u) => {
          assert(
            u.role === "teacher",
            "Подпиской управляет преподаватель",
            403,
          );
          return {
            subscription: subscriptionView(d, u.tutorId),
            payments: paymentHistory(d, u.tutorId),
          };
        }),
        { headers: { "Cache-Control": "private, no-store" } },
      );
    if (p === "export") {
      const data = await userTransaction(raw, (d, u) => {
        assert(u.role === "teacher", "Экспорт доступен преподавателю", 403);
        return {
          exportedAt: new Date().toISOString(),
          ...snapshot(d, u),
          subscriptionPayments: paymentHistory(d, u.tutorId),
        };
      });
      return Response.json(data, {
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Disposition": 'attachment; filename="fortutor-export.json"',
        },
      });
    }
    if (p.startsWith("files/")) {
      const fid = p.slice(6);
      const f = await userTransaction(raw, (d, u) => {
        assert(canReadFile(d, u, fid), "Файл не найден", 404);
        return d.files.find((x) => x.id === fid)!;
      });
      return downloadFile(f);
    }
    throw new AppError("Не найдено", 404);
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: NextRequest, ctx: Context) {
  try {
    const p = (await ctx.params).path.join("/");
    if (p === "webhooks/yookassa") {
      assert(!demoMode(), "Оплата требует PostgreSQL", 503);
      await billingWebhook(await json(req));
      return Response.json({ ok: true });
    }
    if (p.startsWith("webhooks/")) {
      assert(!demoMode(), "Боты доступны только с PostgreSQL", 503);
      const channel = p.split("/")[1];
      assert(
        channel === "telegram" || channel === "max",
        "Неизвестный канал",
        404,
      );
      const secret =
        channel === "telegram"
          ? process.env.TELEGRAM_WEBHOOK_SECRET
          : process.env.MAX_WEBHOOK_SECRET;
      const supplied =
        req.headers.get(
          channel === "telegram"
            ? "x-telegram-bot-api-secret-token"
            : "x-max-bot-api-secret",
        ) || "";
      assert(
        secret && safeEqual(secret, supplied),
        "Недействительная подпись",
        403,
      );
      const event = await json(req);
      if (
        channel === "telegram" &&
        event.message?.chat?.type !== "private" &&
        !event.callback_query
      )
        return Response.json({ ok: true });
      if (
        channel === "telegram" &&
        event.callback_query?.message?.chat?.type !== "private" &&
        event.callback_query
      )
        return Response.json({ ok: true });
      if (
        channel === "max" &&
        event.message?.recipient?.chat_type &&
        event.message.recipient.chat_type !== "dialog"
      )
        return Response.json({ ok: true });
      const key = `bot-${channel}-${hashToken(JSON.stringify(event))}`;
      await transaction((d) =>
        enqueue(d, { id: key, tutorId: "system", kind: "bot", channel, event }),
      );
      return Response.json({ ok: true });
    }
    assert(
      process.env.NODE_ENV !== "production" || process.env.APP_URL,
      "APP_URL обязателен в production",
      503,
    );
    const expectedOrigin = process.env.APP_URL
      ? new URL(process.env.APP_URL).origin
      : new URL(`http://${req.headers.get("host") || "localhost:3000"}`).origin;
    assert(
      req.headers.get("origin") === expectedOrigin,
      "Запрос с чужого сайта запрещен",
      403,
    );
    if (p.startsWith("auth/")) {
      const mode = p.split("/")[1];
      if (mode === "logout") {
        const raw = await sessionToken();
        await transaction((d) => {
          d.sessions = d.sessions.filter((s) => s.id !== hashToken(raw || ""));
        });
        (await cookies()).delete("ft_session");
        return Response.json({ ok: true });
      }
      const input = await json(req);
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0] || "local";
      const allowed = await transaction(
        (d) =>
          limit(
            d,
            `auth:${ip}:${String(input.email || "").toLowerCase()}`,
            10,
            15,
          ) && limit(d, `auth-ip:${ip}`, 40, 15),
      );
      assert(allowed, "Слишком много попыток. Попробуйте через 15 минут.", 429);
      let raw: string;
      if (mode === "demo") {
        assert(demoMode(), "Демонстрация отключена", 404);
        raw = await transaction((d) =>
          makeSession(
            d,
            d.accounts.find(
              (x) =>
                x.id ===
                (input.role === "student" ? "demo-student" : "demo-teacher"),
            )!,
          ),
        );
      } else {
        assert(
          ["login", "register", "join"].includes(mode),
          "Неизвестный метод",
          404,
        );
        raw = await transaction((d) =>
          authenticate(d, input, mode as "login" | "register" | "join"),
        );
      }
      await setSession(raw);
      return Response.json({ ok: true });
    }
    const raw = await sessionToken();
    if (p === "billing/checkout") {
      const u = await userTransaction(raw, (d, u) => {
        assert(u.role === "teacher", "Подпиской управляет преподаватель", 403);
        assert(
          limit(d, `billing-checkout:${u.id}`, 5, 1, u.tutorId),
          "Подождите минуту перед повторной оплатой",
          429,
        );
        return u;
      });
      return Response.json(await checkout(u, await json(req)));
    }
    if (p === "billing/cancel") {
      await userTransaction(raw, (d, u) => {
        assert(u.role === "teacher", "Подпиской управляет преподаватель", 403);
        cancelAutoRenew(d, u.tutorId);
      });
      return Response.json({ ok: true });
    }
    if (p === "billing/check") {
      const input = await json(req);
      const pending = await userTransaction(raw, (d, u) => {
        assert(u.role === "teacher", "Подпиской управляет преподаватель", 403);
        assert(
          limit(d, `billing-check:${u.id}`, 5, 1, u.tutorId),
          "Подождите минуту перед повторной проверкой",
          429,
        );
        const rows = d.subscriptionPayments.filter(
          (p) =>
            p.tutorId === u.tutorId &&
            ["creating", "pending"].includes(p.status) &&
            (!input.id || p.id === input.id),
        );
        return rows.slice(0, 3).map((p) => ({ id: p.id, tutorId: p.tutorId }));
      });
      for (const p of pending) await processPayment(p.id, p.tutorId);
      return Response.json({ ok: true });
    }
    if (p === "action") {
      const input = await json(req);
      return Response.json(
        await userTransaction(raw, (d, u) => act(d, u, input)),
      );
    }
    if (p === "files/presign") {
      assert(!demoMode(), "В демонстрации используется локальная загрузка");
      const a = await json(req);
      assert(
        typeof a.name === "string" &&
          typeof a.mime === "string" &&
          Number.isInteger(a.size),
        "Некорректные параметры файла",
      );
      const u = await userTransaction(raw, (d, u) => {
        assertSubscription(d, u.tutorId);
        return u;
      });
      const result = await prepareUpload(u, a.name, a.mime, a.size);
      await userTransaction(raw, (d, u) => {
        assertSubscription(d, u.tutorId);
        d.files.push(result.file);
      });
      return Response.json({
        id: result.file.id,
        name: result.file.name,
        url: result.url,
      });
    }
    if (p === "files/complete") {
      const a = await json(req);
      const f = await userTransaction(raw, (d, u) => {
        assertSubscription(d, u.tutorId);
        const f = d.files.find(
          (x) =>
            x.id === a.id &&
            x.tutorId === u.tutorId &&
            x.ownerId === (u.studentId || u.id),
        );
        assert(f && f.pending, "Загрузка не найдена", 404);
        assert(
          Date.now() - Date.parse(f.createdAt) < 15 * 60000,
          "Загрузка истекла",
          410,
        );
        return f;
      });
      const key = await verifyUpload(f);
      await userTransaction(raw, (d, u) => {
        assertSubscription(d, u.tutorId);
        const stored = d.files.find((x) => x.id === f.id)!;
        assert(stored.pending, "Файл уже подтвержден", 409);
        stored.pending = false;
        stored.key = key;
      });
      return Response.json({ id: f.id, name: f.name });
    }
    if (p === "files") {
      assert(demoMode(), "Используйте прямую загрузку в S3", 400);
      assert(
        Number(req.headers.get("content-length") || 0) < 21 * 1024 * 1024,
        "Файл слишком большой",
        413,
      );
      const u = await userTransaction(raw, (d, u) => {
        assertSubscription(d, u.tutorId);
        return u;
      });
      const form = await req.formData();
      const f = form.get("file");
      assert(
        f instanceof File && f.size <= 20 * 1024 * 1024,
        "Выберите файл до 20 МБ",
      );
      const file = await storeFile(
        u,
        f.name,
        f.type,
        new Uint8Array(await f.arrayBuffer()),
      );
      await userTransaction(raw, (d, u) => {
        assertSubscription(d, u.tutorId);
        d.files.push(file);
      });
      return Response.json({ id: file.id, name: file.name });
    }
    throw new AppError("Не найдено", 404);
  } catch (e) {
    return failure(e);
  }
}

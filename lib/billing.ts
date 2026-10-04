import { z } from "zod";
import { transaction, demoMode, pool } from "./db";
import type { Account, Database, SubscriptionPayment } from "./types";
import { assert, id, AppError } from "./security";
import {
  ensureSubscription,
  addCalendarMonth,
  PRICE_KOPECKS,
  CONSENT_VERSION,
  GRACE_DAYS,
} from "./subscription";

const DAY = 86400000;
const liveStatuses = ["creating", "pending", "review"];
export const checkoutSchema = z.object({
  autoRenew: z.boolean(),
  consent: z.boolean(),
});
const providerSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["pending", "waiting_for_capture", "succeeded", "canceled"]),
  paid: z.boolean().optional(),
  test: z.boolean(),
  amount: z.object({ value: z.string(), currency: z.string() }),
  recipient: z.object({ account_id: z.string() }),
  metadata: z.object({ orderId: z.string(), tutorId: z.string() }),
  confirmation: z.object({ confirmation_url: z.url().optional() }).optional(),
  payment_method: z
    .object({ id: z.string(), saved: z.boolean().optional() })
    .optional(),
});

export function billingConfigured() {
  return (
    !demoMode() &&
    !!process.env.YOOKASSA_SHOP_ID &&
    !!process.env.YOOKASSA_SECRET_KEY
  );
}

async function api(path: string, body?: Record<string, unknown>, key?: string) {
  assert(billingConfigured(), "Оплата пока не настроена", 503);
  const response = await fetch(`https://api.yookassa.ru/v3/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.YOOKASSA_SHOP_ID}:${process.env.YOOKASSA_SECRET_KEY}`).toString("base64")}`,
      "Content-Type": "application/json",
      ...(key ? { "Idempotence-Key": key } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
    cache: "no-store",
  });
  // Never include the provider response in client errors or logs (payment details).
  if (!response.ok)
    throw new AppError(
      `ЮKassa: запрос не выполнен (HTTP ${response.status}). Статус оплаты будет проверен автоматически.`,
      502,
    );
  return providerSchema.parse(await response.json());
}

function receipt(email: string) {
  if (process.env.YOOKASSA_RECEIPTS !== "true") return undefined;
  const vat = Number(process.env.YOOKASSA_VAT_CODE);
  assert(
    Number.isInteger(vat) && vat >= 1 && vat <= 12,
    "Настройте YOOKASSA_VAT_CODE",
    503,
  );
  const tax = process.env.YOOKASSA_TAX_SYSTEM_CODE
    ? Number(process.env.YOOKASSA_TAX_SYSTEM_CODE)
    : undefined;
  assert(
    tax === undefined || (Number.isInteger(tax) && tax >= 1 && tax <= 6),
    "Некорректный YOOKASSA_TAX_SYSTEM_CODE",
    503,
  );
  return {
    customer: { email },
    ...(tax ? { tax_system_code: tax } : {}),
    items: [
      {
        description: "Доступ к For Tutor на 1 месяц",
        quantity: "1.00",
        amount: { value: "1190.00", currency: "RUB" },
        vat_code: vat,
        payment_mode: "full_payment",
        payment_subject: "service",
      },
    ],
  };
}

export function reservePayment(
  d: Database,
  u: Account,
  autoRenew: boolean,
  kind: "checkout" | "renewal",
  time = new Date(),
) {
  assert(u.role === "teacher", "Подпиской управляет преподаватель", 403);
  const s = ensureSubscription(d, u.tutorId, time);
  const existing = d.subscriptionPayments.find(
    (p) => p.tutorId === u.tutorId && liveStatuses.includes(p.status),
  );
  if (existing) return existing;
  // A second tab may reach this transaction just after the first payment succeeds.
  if (kind === "checkout") {
    const recent = d.subscriptionPayments.find(
      (p) =>
        p.tutorId === u.tutorId &&
        p.kind === "checkout" &&
        p.status === "succeeded" &&
        time.getTime() - Date.parse(p.createdAt) < 5 * 60000,
    );
    if (recent) return recent;
  }
  const pid = id();
  const check = receipt(u.email);
  const request: Record<string, unknown> = {
    amount: { value: "1190.00", currency: "RUB" },
    capture: true,
    description: "For Tutor — подписка на 1 месяц",
    metadata: { orderId: pid, tutorId: u.tutorId },
    ...(check ? { receipt: check } : {}),
  };
  if (kind === "renewal") {
    assert(s.autoRenew && s.paymentMethodId, "Автопродление отключено");
    request.payment_method_id = s.paymentMethodId;
  } else {
    assert(process.env.APP_URL, "APP_URL обязателен", 503);
    request.confirmation = {
      type: "redirect",
      return_url: `${process.env.APP_URL.replace(/\/$/, "")}/?billing=return#subscription`,
    };
    request.save_payment_method = autoRenew;
    s.renewalVersion++;
    s.autoRenew = autoRenew;
    if (!autoRenew) s.paymentMethodId = undefined;
    if (autoRenew) {
      s.consentAt = time.toISOString();
      s.consentVersion = CONSENT_VERSION;
      d.billingEvents.push({
        id: id(),
        tutorId: u.tutorId,
        kind: "consent",
        createdAt: time.toISOString(),
        note: CONSENT_VERSION,
      });
    }
  }
  const payment: SubscriptionPayment = {
    id: pid,
    tutorId: u.tutorId,
    status: "creating",
    kind,
    amountKopecks: PRICE_KOPECKS,
    autoRenew,
    renewalVersion: s.renewalVersion,
    request,
    createdAt: time.toISOString(),
  };
  d.subscriptionPayments.push(payment);
  return payment;
}

export function applyProviderPayment(
  d: Database,
  orderId: string,
  value: unknown,
  time = new Date(),
) {
  const remote = providerSchema.parse(value);
  const p = d.subscriptionPayments.find((p) => p.id === orderId);
  assert(p, "Платеж не найден", 404);
  assert(
    remote.metadata.orderId === p.id &&
      remote.metadata.tutorId === p.tutorId &&
      remote.recipient.account_id === process.env.YOOKASSA_SHOP_ID,
    "Платеж не соответствует заказу",
    409,
  );
  assert(
    remote.amount.value === (p.amountKopecks / 100).toFixed(2) &&
      remote.amount.currency === "RUB",
    "Сумма платежа не соответствует заказу",
    409,
  );
  assert(
    remote.test === (process.env.YOOKASSA_TEST_MODE === "true"),
    "Тестовый режим платежа не соответствует настройкам",
    409,
  );
  assert(
    !p.providerId || p.providerId === remote.id,
    "Идентификатор платежа изменился",
    409,
  );
  p.providerId = remote.id;
  p.checkedAt = time.toISOString();
  if (p.appliedAt || (p.status === "canceled" && remote.status !== "succeeded"))
    return;
  if (remote.confirmation?.confirmation_url) {
    const url = new URL(remote.confirmation.confirmation_url);
    assert(url.protocol === "https:", "Некорректный адрес оплаты", 502);
    p.confirmationUrl = url.toString();
  }
  const s = ensureSubscription(d, p.tutorId, time);
  if (remote.status === "succeeded") {
    assert(remote.paid, "Платеж не оплачен", 409);
    const start = new Date(
      Math.max(
        time.getTime(),
        Date.parse(s.trialEndsAt),
        Date.parse(s.paidUntil || s.trialEndsAt),
      ),
    ).toISOString();
    p.periodStart = start;
    p.periodEnd = addCalendarMonth(start);
    s.paidUntil = p.periodEnd;
    s.failedAttempts = 0;
    s.nextAttemptAt = undefined;
    s.lastError = undefined;
    // A delayed webhook must not undo the user's cancellation of automatic renewal.
    if (p.autoRenew && p.renewalVersion === s.renewalVersion && s.autoRenew) {
      s.paymentMethodId = remote.payment_method?.saved
        ? remote.payment_method.id
        : undefined;
      if (!s.paymentMethodId) s.autoRenew = false;
    }
    p.status = "succeeded";
    p.appliedAt = time.toISOString();
    p.error = undefined;
  } else if (remote.status === "canceled") {
    p.status = "canceled";
    p.error = "Платеж отменен или отклонен. Можно оплатить подписку вручную.";
    if (p.kind === "renewal") {
      s.failedAttempts++;
      s.nextAttemptAt = new Date(time.getTime() + DAY).toISOString();
      s.lastError = p.error;
    } else if (
      p.autoRenew &&
      p.renewalVersion === s.renewalVersion &&
      !s.paymentMethodId
    ) {
      s.autoRenew = false;
    }
  } else p.status = "pending";
  const eid = `${p.id}:${p.status}`;
  if (!d.billingEvents.some((e) => e.id === eid))
    d.billingEvents.push({
      id: eid,
      tutorId: p.tutorId,
      paymentId: p.id,
      kind: p.status,
      createdAt: time.toISOString(),
    });
}

export function cancelAutoRenew(d: Database, tutorId: string) {
  const s = ensureSubscription(d, tutorId);
  s.autoRenew = false;
  s.paymentMethodId = undefined;
  s.nextAttemptAt = undefined;
  s.renewalVersion++;
  d.billingEvents.push({
    id: id(),
    tutorId,
    kind: "cancel-auto-renew",
    createdAt: new Date().toISOString(),
  });
}

export async function processPayment(orderId: string, tutorId: string) {
  const p = await transaction((d) => {
    const p = d.subscriptionPayments.find((x) => x.id === orderId);
    assert(p, "Платеж не найден", 404);
    if (p.appliedAt || p.status === "canceled" || p.status === "review")
      return null;
    // Renewals reserved before cancellation but not sent yet must never be charged.
    const s = ensureSubscription(d, p.tutorId);
    if (
      p.kind === "renewal" &&
      !p.firstSentAt &&
      (!s.autoRenew || s.renewalVersion !== p.renewalVersion)
    ) {
      p.status = "canceled";
      return null;
    }
    if (
      !p.providerId &&
      p.firstSentAt &&
      Date.now() - Date.parse(p.firstSentAt) > 23 * 3600000
    ) {
      p.status = "review";
      p.error =
        "Нужно проверить платеж: ответ ЮKassa не получен. Обратитесь в поддержку.";
      s.lastError = p.error;
      return null;
    }
    p.firstSentAt ||= new Date().toISOString();
    p.checkedAt = new Date().toISOString();
    return structuredClone(p);
  }, tutorId);
  if (!p) return;
  try {
    const remote = p.providerId
      ? await api(`payments/${encodeURIComponent(p.providerId)}`)
      : await api("payments", p.request, p.id);
    await transaction((d) => applyProviderPayment(d, orderId, remote), tutorId);
  } catch (e) {
    await transaction((d) => {
      const stored = d.subscriptionPayments.find((x) => x.id === orderId)!;
      if (!stored.appliedAt && stored.status !== "canceled")
        stored.error =
          "Не удалось проверить оплату. Проверка повторится автоматически.";
    }, tutorId);
    throw e;
  }
}

export async function checkout(u: Account, input: unknown) {
  assert(billingConfigured(), "Оплата пока не настроена", 503);
  const a = checkoutSchema.parse(input);
  assert(!a.autoRenew || a.consent, "Подтвердите согласие на автопродление");
  const p = await transaction(
    (d) => reservePayment(d, u, a.autoRenew, "checkout"),
    u.tutorId,
  );
  await processPayment(p.id, p.tutorId);
  return transaction((d) => {
    const payment = d.subscriptionPayments.find((x) => x.id === p.id)!;
    assert(
      payment.status !== "review",
      payment.error || "Нужна проверка платежа",
      409,
    );
    return {
      id: payment.id,
      status: payment.status,
      url: payment.confirmationUrl,
    };
  }, u.tutorId);
}

export async function billingWebhook(input: unknown) {
  const a = z
    .object({
      type: z.literal("notification"),
      event: z.enum([
        "payment.succeeded",
        "payment.canceled",
        "payment.waiting_for_capture",
      ]),
      object: z.object({
        id: z.string().regex(/^[a-zA-Z0-9-]{1,100}$/),
        metadata: z.object({ orderId: z.string().optional() }).optional(),
      }),
    })
    .parse(input);
  const order = await pool().query(
    "SELECT data FROM ft_subscriptionPayments WHERE data->>'providerId'=$1 OR id=$2 LIMIT 1",
    [a.object.id, a.object.metadata?.orderId || ""],
  );
  const local = order.rows[0]?.data as SubscriptionPayment | undefined;
  if (!local) return; // Other payments in the same shop do not grant access.
  const remote = await api(`payments/${encodeURIComponent(a.object.id)}`);
  assert(remote.id === a.object.id, "Идентификатор платежа не совпадает", 409);
  await transaction(
    (d) => applyProviderPayment(d, local.id, remote),
    local.tutorId,
  );
}

// An operator can recover an unknown response using the verified provider ID.
export async function reconcilePayment(tutorId: string, providerId: string) {
  const remote = await api(`payments/${encodeURIComponent(providerId)}`);
  assert(
    remote.metadata.tutorId === tutorId,
    "Платеж другого преподавателя",
    403,
  );
  await transaction(
    (d) => applyProviderPayment(d, remote.metadata.orderId, remote),
    tutorId,
  );
}

export async function billingTick(batchSize = 10) {
  if (!billingConfigured()) return;
  const time = new Date();
  const due = await pool().query(
    "SELECT tutor_id FROM ft_subscriptions WHERE data->>'autoRenew'='true' AND data->>'paymentMethodId' IS NOT NULL AND (data->>'failedAttempts')::integer<3 AND data->>'paidUntil'<=$1 AND data->>'paidUntil'>$3 AND (data->>'nextAttemptAt' IS NULL OR data->>'nextAttemptAt'<=$1) ORDER BY data->>'nextAttemptAt' NULLS FIRST,data->>'paidUntil' LIMIT $2",
    [
      time.toISOString(),
      batchSize,
      new Date(time.getTime() - GRACE_DAYS * DAY).toISOString(),
    ],
  );
  for (const row of due.rows)
    await transaction((d) => {
      const s = ensureSubscription(d, row.tutor_id, time);
      if (
        !s.autoRenew ||
        !s.paymentMethodId ||
        !s.paidUntil ||
        s.failedAttempts >= 3 ||
        Date.parse(s.paidUntil) + GRACE_DAYS * DAY <= time.getTime()
      )
        return;
      const teacher = d.accounts.find(
        (u) => u.id === s.tutorId && u.role === "teacher",
      );
      if (teacher) {
        reservePayment(d, teacher, true, "renewal", time);
        s.nextAttemptAt = new Date(time.getTime() + 5 * 60000).toISOString();
      }
    }, row.tutor_id);
  const pending = await pool().query(
    "SELECT id,tutor_id FROM ft_subscriptionPayments WHERE data->>'status' IN ('creating','pending') AND (data->>'checkedAt' IS NULL OR data->>'checkedAt'<=$1) ORDER BY data->>'checkedAt' NULLS FIRST,data->>'createdAt' LIMIT $2",
    [new Date(time.getTime() - 60000).toISOString(), batchSize],
  );
  for (const row of pending.rows) {
    try {
      await processPayment(row.id, row.tutor_id);
    } catch {
      console.error("Billing payment check failed", row.id);
    }
  }
}

export function paymentHistory(d: Database, tutorId: string) {
  return d.subscriptionPayments
    .filter((p) => p.tutorId === tutorId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 50)
    .map(
      ({ id, status, kind, amountKopecks, createdAt, periodEnd, error }) => ({
        id,
        status,
        kind,
        amountKopecks,
        createdAt,
        periodEnd,
        error,
      }),
    );
}

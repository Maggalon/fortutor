import type { Database, Subscription, SubscriptionView } from "./types";
import { assert } from "./security";

export const PRICE_KOPECKS = 119000;
export const TRIAL_DAYS = 14;
export const GRACE_DAYS = 3;
export const CONSENT_VERSION = "1190-monthly-v1";
const DAY = 86400000;

export function ensureSubscription(
  d: Database,
  tutorId: string,
  time = new Date(),
): Subscription {
  let s = d.subscriptions.find((x) => x.tutorId === tutorId);
  if (!s) {
    const teacher = d.accounts.find(
      (x) => x.id === tutorId && x.role === "teacher",
    );
    assert(teacher, "Преподаватель не найден", 404);
    s = {
      id: tutorId,
      tutorId,
      trialEndsAt: new Date(
        Date.parse(teacher.createdAt) + TRIAL_DAYS * DAY,
      ).toISOString(),
      autoRenew: false,
      renewalVersion: 0,
      failedAttempts: 0,
    };
    d.subscriptions.push(s);
  }
  return s;
}

export function subscriptionView(
  d: Database,
  tutorId: string,
  time = new Date(),
): SubscriptionView {
  const s = ensureSubscription(d, tutorId, time);
  if (s.freeAccess) {
    return {
      status: "free",
      canWrite: true,
      trialEndsAt: s.trialEndsAt,
      paidUntil: s.paidUntil,
      accessUntil: null,
      autoRenew: false,
      priceRub: 0,
      configured: false,
    };
  }
  const paid = Date.parse(s.paidUntil || s.trialEndsAt);
  const end = Math.max(paid, Date.parse(s.trialEndsAt));
  // A paid subscriber with automatic renewal gets three days to resolve a failure.
  const grace = !!s.paidUntil && s.autoRenew && !!s.paymentMethodId;
  const access = end + (grace ? GRACE_DAYS * DAY : 0);
  const status =
    time.getTime() < end
      ? s.paidUntil && paid >= Date.parse(s.trialEndsAt)
        ? "active"
        : "trial"
      : time.getTime() < access
        ? "grace"
        : "expired";
  return {
    status,
    canWrite: time.getTime() < access,
    trialEndsAt: s.trialEndsAt,
    paidUntil: s.paidUntil,
    accessUntil: new Date(access).toISOString(),
    autoRenew: s.autoRenew,
    nextAttemptAt: s.nextAttemptAt,
    lastError: s.lastError,
    priceRub: PRICE_KOPECKS / 100,
    configured: !!(
      process.env.YOOKASSA_SHOP_ID && process.env.YOOKASSA_SECRET_KEY
    ),
  };
}

export function assertSubscription(d: Database, tutorId: string) {
  assert(
    subscriptionView(d, tutorId).canWrite,
    "Подписка закончилась. Преподавателю нужно продлить доступ в разделе «Подписка». Просмотр и скачивание данных доступны.",
    402,
  );
}

export function addCalendarMonth(value: string) {
  const date = new Date(value);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 1);
  const lastDay = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString();
}

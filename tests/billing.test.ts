import test from "node:test";
import strict from "node:assert/strict";
import { seed, empty } from "../lib/seed";
import {
  assertSubscription,
  ensureSubscription,
  subscriptionView,
  addCalendarMonth,
} from "../lib/subscription";
import {
  reservePayment,
  applyProviderPayment,
  cancelAutoRenew,
  checkout,
  processPayment,
  billingWebhook,
  billingTick,
  paymentHistory,
} from "../lib/billing";
import { act, snapshot, submit, schedule } from "../lib/domain";
import { transaction, migrate, pool } from "../lib/db";
import { id } from "../lib/security";

process.env.YOOKASSA_SHOP_ID = "test-shop";
process.env.YOOKASSA_SECRET_KEY = "test-secret";
process.env.YOOKASSA_TEST_MODE = "true";
process.env.YOOKASSA_RECEIPTS = "false";
process.env.APP_URL = "https://tutor.test.invalid";
const stamp = new Date("2026-01-01T12:00:00.000Z");
function setup() {
  const d = seed();
  const u = d.accounts[0];
  u.createdAt = stamp.toISOString();
  ensureSubscription(d, u.id, stamp);
  return { d, u, s: d.subscriptions[0] };
}
function remote(p: { id: string; tutorId: string }, status = "succeeded") {
  return {
    id: `provider-${p.id}`,
    status,
    paid: status === "succeeded",
    test: true,
    amount: { value: "1190.00", currency: "RUB" },
    recipient: { account_id: "test-shop" },
    metadata: { orderId: p.id, tutorId: p.tutorId },
    payment_method: { id: "saved-method", saved: true },
    confirmation: { confirmation_url: "https://yookassa.ru/test-confirmation" },
  };
}

test("trial lasts exactly 14 days; expiry preserves reads and prevents teacher/student writes", () => {
  const { d, u, s } = setup();
  strict.equal(s.trialEndsAt, "2026-01-15T12:00:00.000Z");
  strict.equal(
    subscriptionView(d, u.id, new Date("2026-01-15T11:59:59Z")).canWrite,
    true,
  );
  strict.equal(
    subscriptionView(d, u.id, new Date(s.trialEndsAt)).canWrite,
    false,
  );
  strict.throws(() => assertSubscription(d, u.id), /Подписка закончилась/);
  strict.throws(
    () =>
      act(d, u, {
        action: "student.create",
        name: "Петр",
        subject: "Математика",
        billing: "package",
        rate: 1000,
        packageSize: 8,
      }),
    /Подписка закончилась/,
  );
  const student = d.accounts[1];
  strict.throws(
    () =>
      submit(
        d,
        u.id,
        student.studentId!,
        d.assignments[0].id,
        "Ответ",
        [],
        student,
      ),
    /Подписка закончилась/,
  );
  strict.equal(snapshot(d, u).students.length, 6);
  schedule(d, new Date("2026-01-16T12:00:00Z"));
  strict.equal(d.jobs.length, 0);
});
test("without YooKassa trial remains available and payment actions never contact the provider", async () => {
  const shop = process.env.YOOKASSA_SHOP_ID;
  const secret = process.env.YOOKASSA_SECRET_KEY;
  const originalFetch = globalThis.fetch;
  delete process.env.YOOKASSA_SHOP_ID;
  delete process.env.YOOKASSA_SECRET_KEY;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    throw new Error("Unexpected provider request");
  };
  try {
    const { d, u, s } = setup();
    const trial = subscriptionView(d, u.id, stamp);
    strict.equal(trial.configured, false);
    strict.equal(trial.status, "trial");
    strict.equal(trial.canWrite, true);
    strict.equal(
      subscriptionView(d, u.id, new Date(s.trialEndsAt)).canWrite,
      false,
    );
    await strict.rejects(
      checkout(u, { autoRenew: false, consent: false }),
      /Оплата пока не настроена/,
    );
    await billingTick();
    strict.equal(requests, 0);
    strict.equal(d.subscriptionPayments.length, 0);
  } finally {
    process.env.YOOKASSA_SHOP_ID = shop;
    process.env.YOOKASSA_SECRET_KEY = secret;
    globalThis.fetch = originalFetch;
  }
});
test("successful payment adds a calendar month after trial; duplicate and stale events never extend twice", () => {
  const { d, u, s } = setup();
  const p = reservePayment(d, u, true, "checkout", stamp);
  applyProviderPayment(d, p.id, remote(p), stamp);
  strict.equal(s.paidUntil, "2026-02-15T12:00:00.000Z");
  applyProviderPayment(d, p.id, remote(p), new Date("2026-01-02T12:00:00Z"));
  applyProviderPayment(d, p.id, remote(p, "pending"), stamp);
  strict.equal(s.paidUntil, "2026-02-15T12:00:00.000Z");
  strict.equal(p.status, "succeeded");
  strict.equal(d.billingEvents.filter((e) => e.kind === "succeeded").length, 1);
  strict.equal(s.paymentMethodId, "saved-method");
  strict.equal(
    reservePayment(d, u, true, "checkout", new Date("2026-01-01T12:00:01Z")).id,
    p.id,
  );
  strict.equal(
    addCalendarMonth("2028-01-31T15:30:00.000Z"),
    "2028-02-29T15:30:00.000Z",
  );
});
test("payment verification rejects foreign shops, currencies, amounts, metadata and test mode", () => {
  const { d, u, s } = setup();
  const p = reservePayment(d, u, false, "checkout", stamp);
  for (const bad of [
    { ...remote(p), recipient: { account_id: "other" } },
    { ...remote(p), amount: { value: "1.00", currency: "RUB" } },
    { ...remote(p), amount: { value: "1190.00", currency: "USD" } },
    { ...remote(p), metadata: { orderId: p.id, tutorId: "other" } },
    { ...remote(p), test: false },
    { ...remote(p), paid: false },
  ])
    strict.throws(() => applyProviderPayment(d, p.id, bad, stamp));
  strict.equal(s.paidUntil, undefined);
});
test("late successful webhook cannot re-enable canceled auto-renewal", () => {
  const { d, u, s } = setup();
  const p = reservePayment(d, u, true, "checkout", stamp);
  cancelAutoRenew(d, u.id);
  applyProviderPayment(d, p.id, remote(p), stamp);
  strict.equal(s.autoRenew, false);
  strict.equal(s.paymentMethodId, undefined);
  strict.ok(s.paidUntil);
});
test("paid auto-renewal has three grace days; trial and manual subscription do not", () => {
  const { d, u, s } = setup();
  s.paidUntil = "2026-02-15T12:00:00.000Z";
  s.autoRenew = true;
  s.paymentMethodId = "method";
  strict.equal(
    subscriptionView(d, u.id, new Date("2026-02-16T12:00:00Z")).status,
    "grace",
  );
  strict.equal(
    subscriptionView(d, u.id, new Date("2026-02-18T12:00:00Z")).status,
    "expired",
  );
  cancelAutoRenew(d, u.id);
  strict.equal(
    subscriptionView(d, u.id, new Date("2026-02-15T12:00:00Z")).status,
    "expired",
  );
});
test("pending order is reused; receipt and provider credentials never leak into history or snapshot", () => {
  const { d, u } = setup();
  const p = reservePayment(d, u, true, "checkout", stamp);
  strict.equal(reservePayment(d, u, true, "checkout", stamp).id, p.id);
  strict.equal(d.subscriptionPayments.length, 1);
  const view = JSON.stringify({
    history: paymentHistory(d, u.id),
    snapshot: snapshot(d, u),
  });
  strict.ok(!view.includes("saved-method"));
  strict.ok(!view.includes("test-secret"));
  strict.ok(!view.includes("confirmation_url"));
});
test("canceled renewal schedules retry without granting a paid period", () => {
  const { d, u, s } = setup();
  s.autoRenew = true;
  s.paymentMethodId = "method";
  s.paidUntil = "2026-01-31T12:00:00.000Z";
  const at = new Date(s.paidUntil);
  const p = reservePayment(d, u, true, "renewal", at);
  applyProviderPayment(d, p.id, remote(p, "canceled"), at);
  strict.equal(s.failedAttempts, 1);
  strict.equal(s.nextAttemptAt, "2026-02-01T12:00:00.000Z");
  strict.equal(s.paidUntil, "2026-01-31T12:00:00.000Z");
});

test(
  "PostgreSQL billing: concurrent checkout, verified webhook, renewal, uncertainty cutoff, ownership and tenant rollback",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.DEMO_MODE = "false";
    await migrate();
    const uid = `billing-${id()}`,
      second = `billing-${id()}`;
    const template = seed().accounts[0];
    const u = {
      ...template,
      id: uid,
      tutorId: uid,
      email: `${uid}@test.invalid`,
      createdAt: new Date().toISOString(),
    };
    await transaction((d) => {
      d.accounts.push(u, {
        ...u,
        id: second,
        tutorId: second,
        email: `${second}@test.invalid`,
        createdAt: stamp.toISOString(),
      });
      ensureSubscription(d, uid);
    });
    const originalFetch = globalThis.fetch;
    const byId = new Map<string, ReturnType<typeof remote>>();
    const requests: { key: string; body: any }[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        const key = (init.headers as Record<string, string>)["Idempotence-Key"];
        requests.push({ key, body });
        let value = byId.get(`provider-${key}`);
        if (!value) {
          value = remote(
            { id: key, tutorId: body.metadata.tutorId },
            body.payment_method_id ? "succeeded" : "pending",
          );
          byId.set(value.id, value);
        }
        return Response.json(value);
      }
      return Response.json(byId.get(url.split("/").at(-1)!));
    };
    try {
      // Existing tutors receive a fresh migration trial once, rather than immediate expiry.
      await migrate();
      const migratedTrial = await transaction(
        (d) => d.subscriptions[0].trialEndsAt,
        second,
      );
      strict.ok(Date.parse(migratedTrial) > Date.now() + 13 * DAY);
      await migrate();
      strict.equal(
        await transaction((d) => d.subscriptions[0].trialEndsAt, second),
        migratedTrial,
      );
      await strict.rejects(
        checkout(u, { autoRenew: true, consent: false }),
        /согласие/,
      );
      const results = await Promise.all([
        checkout(u, { autoRenew: true, consent: true }),
        checkout(u, { autoRenew: true, consent: true }),
      ]);
      strict.equal(results[0].id, results[1].id);
      strict.equal(new Set(requests.map((r) => r.key)).size, 1);
      strict.equal(requests[0].body.amount.value, "1190.00");
      const pid = results[0].id;
      const provider = byId.get(`provider-${pid}`)!;
      provider.status = "succeeded";
      provider.paid = true;
      await billingWebhook({
        type: "notification",
        event: "payment.succeeded",
        object: { id: provider.id, metadata: { orderId: pid } },
      });
      const until = await transaction((d) => d.subscriptions[0].paidUntil, uid);
      await billingWebhook({
        type: "notification",
        event: "payment.succeeded",
        object: { id: provider.id },
      });
      strict.equal(
        await transaction((d) => d.subscriptions[0].paidUntil, uid),
        until,
      );
      await strict.rejects(
        transaction((d) => {
          d.students.push({ ...seed().students[0], tutorId: second });
        }, uid),
        /вне рабочего/,
      );
      strict.equal(await transaction((d) => d.students.length, uid), 0);
      await transaction((d) => {
        const s = d.subscriptions[0];
        s.trialEndsAt = new Date(Date.now() - 20 * DAY).toISOString();
        s.paidUntil = new Date(Date.now() - 60000).toISOString();
      }, uid);
      await billingTick();
      strict.ok(
        requests.some((r) => r.body.payment_method_id === "saved-method"),
      );
      strict.ok(
        Date.parse(
          (await transaction((d) => d.subscriptions[0].paidUntil, uid))!,
        ) > Date.now(),
      );
      const uncertain = await transaction((d) => {
        for (const p of d.subscriptionPayments)
          p.createdAt = new Date(Date.now() - 6 * 60000).toISOString();
        const p = reservePayment(d, u, false, "checkout");
        p.firstSentAt = new Date(Date.now() - 24 * 3600000).toISOString();
        return p.id;
      }, uid);
      const before = requests.length;
      await processPayment(uncertain, uid);
      strict.equal(requests.length, before);
      strict.equal(
        await transaction(
          (d) => d.subscriptionPayments.find((p) => p.id === uncertain)!.status,
          uid,
        ),
        "review",
      );
    } finally {
      globalThis.fetch = originalFetch;
      for (const collection of Object.keys(empty()))
        await pool().query(
          `DELETE FROM ft_${collection} WHERE tutor_id=ANY($1::text[])`,
          [[uid, second]],
        );
      await pool().query("DELETE FROM ft_tenants WHERE id=ANY($1::text[])", [
        [uid, second],
      ]);
      await pool().end();
    }
  },
);
const DAY = 86400000;

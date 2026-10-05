import { z } from "zod";
import { pool, transaction, demoMode } from "../lib/db";
import { assert, id } from "../lib/security";
import { ensureSubscription, subscriptionView } from "../lib/subscription";
import {
  cancelAutoRenew,
  grantFreeAccess,
  reconcilePayment,
} from "../lib/billing";

const [command, email, value, ...reason] = process.argv.slice(2);
assert(!demoMode(), "Команда требует PostgreSQL");
try {
  if (command === "list") {
    const rows = await pool().query(
      "SELECT a.data->>'email' email,s.data->>'trialEndsAt' trial_end,s.data->>'paidUntil' paid_until,s.data->>'freeAccess' free_access,s.data->>'autoRenew' auto_renew,s.data->>'lastError' error FROM ft_accounts a JOIN ft_subscriptions s ON s.tutor_id=a.id WHERE a.data->>'role'='teacher' ORDER BY a.data->>'email'",
    );
    console.table(rows.rows);
  } else {
    assert(
      email,
      "Usage: billing-admin.ts list | status EMAIL | free EMAIL confirm REASON | grant EMAIL ISO_DATE REASON | revoke EMAIL confirm REASON | reconcile EMAIL PROVIDER_PAYMENT_ID | abandon EMAIL ORDER_ID REASON",
    );
    const result = await pool().query(
      "SELECT id FROM ft_accounts WHERE lower(data->>'email')=lower($1) AND data->>'role'='teacher'",
      [email],
    );
    const tutorId = result.rows[0]?.id;
    assert(tutorId, "Преподаватель не найден");
    if (command === "reconcile") {
      assert(
        value && /^[a-zA-Z0-9-]{1,100}$/.test(value),
        "Укажите payment ID из ЮKassa",
      );
      await reconcilePayment(tutorId, value);
    } else
      await transaction((d) => {
        const s = ensureSubscription(d, tutorId);
        if (command === "free") {
          assert(
            value === "confirm" && reason.length,
            "Укажите confirm и причину бесплатного доступа",
          );
          grantFreeAccess(d, tutorId, reason.join(" "));
        } else if (command === "grant") {
          const until = z.iso.datetime().parse(value);
          assert(Date.parse(until) > Date.now(), "Дата должна быть в будущем");
          assert(reason.length, "Укажите причину изменения доступа");
          s.freeAccess = undefined;
          s.paidUntil = until;
          s.failedAttempts = 0;
          s.lastError = undefined;
          d.billingEvents.push({
            id: id(),
            tutorId,
            kind: "admin-grant",
            createdAt: new Date().toISOString(),
            note: reason.join(" "),
          });
        } else if (command === "revoke") {
          assert(
            value === "confirm" && reason.length,
            "Укажите confirm и причину отзыва доступа",
          );
          cancelAutoRenew(d, tutorId);
          s.freeAccess = undefined;
          s.paidUntil = new Date().toISOString();
          s.trialEndsAt = s.paidUntil;
          d.billingEvents.push({
            id: id(),
            tutorId,
            kind: "admin-revoke",
            createdAt: new Date().toISOString(),
            note: reason.join(" "),
          });
        } else if (command === "abandon") {
          assert(
            value && reason.length,
            "Укажите order ID и причину после проверки отсутствия платежа в ЮKassa",
          );
          const p = d.subscriptionPayments.find(
            (p) => p.id === value && p.status === "review" && !p.providerId,
          );
          assert(
            p,
            "Можно закрыть только неопределенный заказ без provider ID после ручной сверки",
          );
          p.status = "canceled";
          p.error = "Заказ закрыт оператором после сверки с ЮKassa";
          s.lastError = undefined;
          d.billingEvents.push({
            id: id(),
            tutorId,
            paymentId: p.id,
            kind: "admin-abandon",
            createdAt: new Date().toISOString(),
            note: reason.join(" "),
          });
        } else assert(command === "status", "Неизвестная команда");
        console.log(subscriptionView(d, tutorId));
      }, tutorId);
  }
} finally {
  await pool().end();
}

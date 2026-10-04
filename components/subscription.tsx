"use client";
import { useState, useEffect, useCallback } from "react";
import type { SubscriptionView } from "@/lib/types";
import { request } from "./auth";
import { SectionHead, Badge } from "./ui";

type Payment = {
  id: string;
  status: string;
  kind: string;
  amountKopecks: number;
  createdAt: string;
  periodEnd?: string;
  error?: string;
};
const date = (value: string) =>
  new Date(value).toLocaleString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const labels = {
  trial: "Пробный период",
  active: "Подписка активна",
  grace: "Нужно продлить подписку",
  expired: "Доступ только для просмотра",
};
const paymentLabels: Record<string, string> = {
  creating: "Проверяем оплату",
  pending: "Ожидает оплаты",
  succeeded: "Оплачен",
  canceled: "Отменен",
  review: "Нужна проверка поддержки",
};

export default function SubscriptionPanel({
  initial,
  refresh,
}: {
  initial: SubscriptionView;
  refresh: () => Promise<void>;
}) {
  const [info, setInfo] = useState(initial);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [autoRenew, setAutoRenew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    const data = await request("/api/billing");
    setInfo(data.subscription);
    setPayments(data.payments);
  }, []);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);
  useEffect(() => {
    setInfo(initial);
  }, [initial]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("billing") !== "return")
      return;
    setNotice("Проверяем оплату. Доступ обновится после подтверждения ЮKassa.");
    void request("/api/billing/check", {})
      .then(async () => {
        await load();
        await refresh();
      })
      .catch((e) => setError(e.message));
    const url = new URL(window.location.href);
    url.searchParams.delete("billing");
    window.history.replaceState(null, "", url);
  }, [load, refresh]);
  useEffect(() => {
    if (!payments.some((p) => ["creating", "pending"].includes(p.status)))
      return;
    const timer = setInterval(() => void load().catch(() => {}), 15000);
    return () => clearInterval(timer);
  }, [payments, load]);
  async function run(action: "pay" | "cancel" | "check") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (action === "pay") {
        const p = await request("/api/billing/checkout", {
          autoRenew,
          consent: autoRenew,
        });
        if (p.url && p.status === "pending") {
          window.location.assign(p.url);
          return;
        }
        setNotice(
          p.status === "succeeded"
            ? "Подписка оплачена."
            : "Оплата обрабатывается. Статус обновится автоматически.",
        );
      } else {
        await request(`/api/billing/${action}`, {});
        setNotice(
          action === "cancel"
            ? "Автопродление отключено. Оплаченный период сохраняется."
            : "Статус оплаты проверен.",
        );
      }
      await load();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            Подписка<span className="heading-dot">.</span>
          </h1>
          <p>Ваше рабочее пространство — 1190 ₽ в месяц.</p>
        </div>
      </div>
      <section className="panel settings-panel subscription-panel">
        <SectionHead title={labels[info.status]} />
        <p className="subscription-price">
          1190 ₽ <small>/ месяц</small>
        </p>
        <p>
          {info.paidUntil
            ? `Оплачено до ${date(info.paidUntil)}.`
            : `14 дней бесплатно. Пробный период до ${date(info.trialEndsAt)}.`}
        </p>
        {info.status === "grace" && (
          <p role="status">
            Льготный доступ до {date(info.accessUntil)}. Проверьте оплату или
            продлите подписку вручную.
          </p>
        )}
        {!info.canWrite && (
          <p>
            Вы можете просматривать данные, скачивать файлы и экспортировать
            кабинет. Создание и изменение учебных данных возобновятся после
            оплаты.
          </p>
        )}
        <p>
          В подписку входят кабинет преподавателя и учеников, расписание, ДЗ,
          учет оплат, боты и отчеты. Если оплатить заранее, месяц добавится
          после текущего доступа.
        </p>
        <p>
          {info.autoRenew
            ? `Автопродление включено: 1190 ₽ после окончания оплаченного периода.${info.nextAttemptAt ? ` Следующая попытка: ${date(info.nextAttemptAt)}.` : ""}`
            : "Автопродление отключено."}
        </p>
        {info.lastError && <p role="status">{info.lastError}</p>}
        {!info.configured && (
          <p role="status">
            Прием платежей пока недоступен. Пробный период — 14 дней без карты.
          </p>
        )}
        <label className="subscription-consent">
          <input
            type="checkbox"
            checked={autoRenew}
            onChange={(e) => setAutoRenew(e.target.checked)}
            disabled={busy || !info.configured}
          />
          <span>
            Согласен на сохранение способа оплаты и автоматическое списание 1190
            ₽ каждый месяц. Автопродление можно отключить здесь в любое время.
          </span>
        </label>
        <div className="subscription-actions">
          <button
            className="primary"
            disabled={busy || !info.configured}
            onClick={() => void run("pay")}
          >
            {busy ? "Подождите…" : "Оплатить месяц · 1190 ₽"}
          </button>
          {info.autoRenew && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void run("cancel")}
            >
              Отключить автопродление
            </button>
          )}
          <button
            className="secondary"
            disabled={busy || !info.configured}
            onClick={() => void run("check")}
          >
            Проверить оплату
          </button>
          <a className="secondary" href="/api/export" download>
            Экспортировать данные
          </a>
        </div>
        <p className="subscription-caption">
          Карту обрабатывает ЮKassa. Возвращение с формы оплаты не подтверждает
          платеж. Уже отправленное в банк списание может завершиться после
          отключения автопродления.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
      </section>
      <section className="panel settings-panel subscription-panel">
        <SectionHead title="История оплаты платформы" />
        {payments.length === 0 ? (
          <p>Оплат пока нет.</p>
        ) : (
          <div className="subscription-history">
            {payments.map((p) => (
              <div key={p.id}>
                <div>
                  <strong>{p.amountKopecks / 100} ₽</strong>
                  <span>
                    {date(p.createdAt)} ·{" "}
                    {p.kind === "renewal" ? "Автопродление" : "Оплата месяца"}
                  </span>
                  {p.error && <small>{p.error}</small>}
                </div>
                <Badge>{paymentLabels[p.status] || p.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

import type { Database, Student } from "./types";
export function countRu(value: number, forms: [string, string, string]) {
  const n = Math.abs(value),
    last = n % 10,
    lastTwo = n % 100;
  return `${value} ${forms[last === 1 && lastTwo !== 11 ? 0 : last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? 1 : 2]}`;
}
export const attended = (l: Database["lessons"][number], s: string) =>
  l.status === "completed" &&
  l.studentIds.includes(s) &&
  l.attendance[s] !== false;
export function finance(d: Pick<Database, "lessons" | "payments">, s: Student) {
  const lessons = d.lessons.filter((l) => attended(l, s.id));
  const payments = d.payments.filter((p) => p.studentId === s.id);
  const paid = new Set(payments.flatMap((p) => p.lessonIds));
  const unpaid = lessons.filter((l) => !paid.has(l.id));
  const balance =
    s.initialBalance +
    payments.reduce((n, p) => n + p.lessons, 0) -
    lessons.length;
  return {
    balance,
    debt:
      s.billing === "lesson"
        ? unpaid.reduce((n, l) => n + (l.rates[s.id] ?? s.rate), 0)
        : Math.max(0, -balance) * s.rate,
    unpaid,
  };
}
export const initials = (name: string) =>
  name
    .split(" ")
    .slice(0, 2)
    .map((x) => x[0])
    .join("");
export const rub = (value: number) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(value);
export const lessonLabel = {
  planned: "Запланирован",
  completed: "Проведен",
  cancelled: "Отменен",
  rescheduled: "Перенесен",
};
export const submissionLabel = {
  submitted: "На проверке",
  revision: "На доработке",
  reviewed: "Проверено",
};

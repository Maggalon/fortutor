import { z } from "zod";
import type {
  Account,
  Database,
  Student,
  Snapshot,
  Job,
  Binding,
} from "./types";
import { assert, id, token, hashToken, AppError } from "./security";
import { demoMode } from "./db";
import { assertSubscription, subscriptionView } from "./subscription";
import { botLink } from "./bot-config";
const text = z.string().trim().min(1).max(200),
  date = z.iso.datetime({ offset: true }),
  ids = z.array(z.string()).max(200);
const baseStudent = {
  name: text,
  email: z.union([z.email(), z.literal("")]).default(""),
  subject: text,
  grade: z.string().max(80).default(""),
  billing: z.enum(["lesson", "package"]),
  rate: z.number().int().min(1).max(1000000),
  packageSize: z.number().int().min(1).max(1000),
  initialBalance: z.number().int().min(-1000).max(1000).default(0),
  note: z.string().max(3000).default(""),
};
export const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("student.create"), ...baseStudent }),
  z.object({ action: z.literal("student.update"), id: text, ...baseStudent }),
  z.object({ action: z.literal("student.invite"), id: text }),
  z.object({ action: z.literal("student.parent-code"), id: text }),
  z.object({
    action: z.literal("group.save"),
    id: z.string().optional(),
    name: text,
    studentIds: ids.min(1),
  }),
  z.object({
    action: z.literal("lesson.create"),
    title: text,
    subject: text,
    studentIds: ids.min(1),
    start: date,
    duration: z.number().int().min(15).max(480),
    location: z.string().max(1000),
    weeks: z.number().int().min(1).max(52),
  }),
  z.object({
    action: z.literal("lesson.status"),
    id: text,
    status: z.enum(["planned", "completed", "cancelled", "rescheduled"]),
    start: date.optional(),
    attendance: z.record(z.string(), z.boolean()).default({}),
  }),
  z.object({
    action: z.literal("assignment.create"),
    title: text,
    subject: text,
    text: z.string().min(1).max(20000),
    links: z.array(z.url()).max(20),
    fileIds: ids.max(10),
    studentIds: ids.min(1),
    deadline: date,
    maxScore: z.number().int().min(1).max(1000),
  }),
  z.object({
    action: z.literal("assignment.archive"),
    id: text,
    archived: z.boolean(),
  }),
  z.object({
    action: z.literal("submission.send"),
    assignmentId: text,
    text: z.string().max(20000),
    fileIds: ids.max(10),
  }),
  z.object({
    action: z.literal("submission.review"),
    id: text,
    status: z.enum(["reviewed", "revision"]),
    score: z.number().min(0).optional(),
    comment: z.string().min(1).max(5000),
  }),
  z.object({
    action: z.literal("payment.create"),
    studentId: text,
    amount: z.number().int().min(1).max(100000000),
    lessons: z.number().int().min(0).max(1000),
    lessonIds: ids,
    note: z.string().max(1000),
  }),
  z.object({
    action: z.literal("settings.save"),
    name: text,
    paymentDetails: z.string().max(1000),
    timezone: text,
    reportDays: z.union([z.literal(0), z.literal(14), z.literal(30)]),
  }),
  z.object({
    action: z.literal("report.create"),
    studentId: text,
    from: date,
    to: date,
  }),
  z.object({
    action: z.literal("bot.link"),
    channel: z.enum(["telegram", "max"]),
  }),
  z.object({ action: z.literal("bot.unlink"), id: text }),
  z.object({ action: z.literal("job.retry"), id: text }),
]);
export const now = () => new Date().toISOString();
import { attended, finance } from "./shared";
export { attended, finance } from "./shared";
export function enqueue(
  d: Database,
  j: Omit<Job, "attempts" | "nextAt" | "createdAt" | "status">,
) {
  if (d.jobs.some((x) => x.id === j.id)) return;
  d.jobs.push({
    ...j,
    status: "pending",
    attempts: 0,
    nextAt: now(),
    createdAt: now(),
  });
}
export function notify(
  d: Database,
  tutorId: string,
  studentId: string,
  role: Binding["role"],
  message: string,
  key: string,
) {
  for (const b of d.bindings.filter(
    (x) =>
      x.tutorId === tutorId && x.studentId === studentId && x.role === role,
  ))
    enqueue(d, {
      id: `${key}-${b.id}`,
      tutorId,
      kind: "message",
      bindingId: b.id,
      text: message,
    });
}
function owned<T extends { id: string; tutorId: string }>(
  rows: T[],
  user: Account,
  key: string,
): T {
  const row = rows.find((x) => x.id === key && x.tutorId === user.tutorId);
  assert(row, "Объект не найден", 404);
  return row;
}
export function filesAllowed(d: Database, u: Account, fileIds: string[]) {
  for (const fileId of fileIds) {
    const f = owned(d.files, u, fileId);
    assert(!f.pending, "Файл еще не загружен");
    assert(
      u.role === "teacher" || f.ownerId === u.id || f.ownerId === u.studentId,
      "Нет доступа к файлу",
      403,
    );
  }
}
export function canReadFile(d: Database, u: Account, fileId: string) {
  const f = d.files.find((x) => x.id === fileId && x.tutorId === u.tutorId);
  return (
    !!f &&
    !f.pending &&
    (u.role === "teacher" ||
      f.ownerId === u.id ||
      f.ownerId === u.studentId ||
      d.assignments.some(
        (a) =>
          a.studentIds.includes(u.studentId ?? "") &&
          a.fileIds.includes(fileId),
      ) ||
      d.submissions.some(
        (s) => s.studentId === u.studentId && s.fileIds.includes(fileId),
      ))
  );
}
export function snapshot(d: Database, u: Account): Snapshot {
  const mine = <T extends { tutorId: string }>(rows: T[]) =>
    rows.filter((x) => x.tutorId === u.tutorId);
  const teacher = u.role === "teacher";
  const { passwordHash: _, ...user } = u;
  return {
    user,
    subscription: subscriptionView(d, u.tutorId),
    demo: demoMode(),
    students: mine(d.students)
      .filter((s) => teacher || s.id === u.studentId)
      .map((s) => (teacher ? s : { ...s, parentCode: "", note: "" })),
    groups: mine(d.groups)
      .filter((g) => teacher || g.studentIds.includes(u.studentId ?? ""))
      .map((g) =>
        teacher
          ? g
          : { ...g, studentIds: g.studentIds.filter((x) => x === u.studentId) },
      ),
    lessons: mine(d.lessons)
      .filter((l) => teacher || l.studentIds.includes(u.studentId ?? ""))
      .map((l) =>
        teacher
          ? l
          : {
              ...l,
              studentIds: l.studentIds.filter((x) => x === u.studentId),
              attendance: { [u.studentId!]: l.attendance[u.studentId!] },
              rates: { [u.studentId!]: l.rates[u.studentId!] },
            },
      ),
    assignments: mine(d.assignments)
      .filter((a) => teacher || a.studentIds.includes(u.studentId ?? ""))
      .map((a) => (teacher ? a : { ...a, studentIds: [u.studentId!] })),
    submissions: mine(d.submissions).filter(
      (s) => teacher || s.studentId === u.studentId,
    ),
    payments: mine(d.payments).filter(
      (p) => teacher || p.studentId === u.studentId,
    ),
    files: mine(d.files)
      .filter((f) => canReadFile(d, u, f.id))
      .map(({ key: _, ...f }) => f),
    bindings: mine(d.bindings)
      .filter(
        (b) => teacher || (b.studentId === u.studentId && b.role === "student"),
      )
      .map(({ chatId: _, userId: __, ...b }) => b),
    reports: teacher ? mine(d.reports) : [],
    jobs: teacher
      ? mine(d.jobs).map(({ id, kind, status, error, createdAt }) => ({
          id,
          kind,
          status,
          error,
          createdAt,
        }))
      : [],
    integrations: {
      telegram: !!process.env.TELEGRAM_BOT_TOKEN,
      max: !!process.env.MAX_BOT_TOKEN,
      deepseek: !!process.env.DEEPSEEK_API_KEY,
      storage: !!process.env.S3_BUCKET,
      queue: !!process.env.REDIS_URL,
    },
  };
}
function weekly(start: string, weeks: number, zone: string) {
  if (!weeks) return start;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = (n: number) =>
    Object.fromEntries(
      fmt.formatToParts(n).map((x) => [x.type, Number(x.value)]),
    );
  const p = parts(Date.parse(start));
  const target = Date.UTC(
    p.year,
    p.month - 1,
    p.day + 7 * weeks,
    p.hour,
    p.minute,
    p.second,
  );
  let value = target;
  for (let i = 0; i < 3; i++) {
    const q = parts(value);
    value +=
      target - Date.UTC(q.year, q.month - 1, q.day, q.hour, q.minute, q.second);
  }
  return new Date(value).toISOString();
}
export function act(d: Database, u: Account, input: unknown) {
  const a = actionSchema.parse(input),
    stamp = now();
  if (a.action !== "bot.unlink" && a.action !== "settings.save")
    assertSubscription(d, u.tutorId);
  if (!["submission.send", "bot.link", "bot.unlink"].includes(a.action))
    assert(
      u.role === "teacher",
      "Только преподаватель может выполнять это действие",
      403,
    );
  const validateStudents = (list: string[]) => {
    assert(new Set(list).size === list.length, "Ученики повторяются");
    list.forEach((s) => owned(d.students, u, s));
  };
  switch (a.action) {
    case "student.create": {
      const s = {
        ...a,
        id: id(),
        tutorId: u.tutorId,
        parentCode: token().slice(0, 16).toUpperCase(),
        createdAt: stamp,
      };
      d.students.push(s);
      return { id: s.id };
    }
    case "student.update": {
      const s = owned(d.students, u, a.id);
      if (
        d.lessons.some((l) => attended(l, s.id)) ||
        d.payments.some((p) => p.studentId === s.id)
      )
        assert(
          s.billing === a.billing && s.initialBalance === a.initialBalance,
          "После начала учета схема и начальный баланс неизменны",
        );
      Object.assign(s, a);
      return {};
    }
    case "student.invite": {
      const s = owned(d.students, u, a.id);
      assert(
        !d.accounts.some((x) => x.studentId === s.id),
        "Ученик уже зарегистрирован",
      );
      const raw = token();
      d.invites = d.invites.filter((x) => x.studentId !== s.id);
      d.invites.push({
        id: id(),
        tutorId: u.tutorId,
        studentId: s.id,
        tokenHash: hashToken(raw),
        used: false,
        expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      });
      return {
        url: `${process.env.APP_URL || "http://localhost:3000"}/?invite=${raw}`,
      };
    }
    case "student.parent-code": {
      const s = owned(d.students, u, a.id);
      s.parentCode = token().slice(0, 16).toUpperCase();
      return { code: s.parentCode };
    }
    case "group.save":
      validateStudents(a.studentIds);
      if (a.id) Object.assign(owned(d.groups, u, a.id), a);
      else d.groups.push({ ...a, id: id(), tutorId: u.tutorId });
      return {};
    case "lesson.create": {
      validateStudents(a.studentIds);
      const seriesId = a.weeks > 1 ? id() : undefined;
      for (let w = 0; w < a.weeks; w++) {
        const start = weekly(a.start, w, u.timezone);
        const end = Date.parse(start) + a.duration * 60000;
        assert(
          !d.lessons.some(
            (l) =>
              l.tutorId === u.tutorId &&
              l.status !== "cancelled" &&
              Date.parse(l.start) < end &&
              Date.parse(l.start) + l.duration * 60000 > Date.parse(start),
          ),
          "В это время уже есть занятие",
        );
        d.lessons.push({
          ...a,
          id: id(),
          tutorId: u.tutorId,
          start,
          seriesId,
          status: "planned",
          attendance: {},
          rates: {},
        });
      }
      return {};
    }
    case "lesson.status": {
      const l = owned(d.lessons, u, a.id);
      if (l.status === "completed") {
        assert(
          a.status === "completed",
          "Проведенный урок нельзя изменить: он уже учтен в балансе",
        );
        return {};
      }
      if (a.status === "rescheduled") {
        assert(
          a.start && Date.parse(a.start) > Date.now(),
          "Укажите новую дату в будущем",
        );
        const end = Date.parse(a.start) + l.duration * 60000;
        assert(
          !d.lessons.some(
            (x) =>
              x.id !== l.id &&
              x.tutorId === u.tutorId &&
              x.status !== "cancelled" &&
              Date.parse(x.start) < end &&
              Date.parse(x.start) + x.duration * 60000 > Date.parse(a.start!),
          ),
          "В это время уже есть занятие",
        );
        l.originalStart = l.start;
        l.start = a.start;
      }
      l.status = a.status;
      l.attendance = Object.fromEntries(
        l.studentIds.map((s) => [s, a.attendance[s] !== false]),
      );
      if (l.status === "completed") {
        for (const sid of l.studentIds) {
          const s = owned(d.students, u, sid);
          l.rates[sid] = s.rate;
          if (!attended(l, sid)) continue;
          const f = finance(d, s);
          if (s.billing === "lesson" || f.balance === 1 || f.balance < 0)
            notify(
              d,
              u.tutorId,
              sid,
              "parent",
              `${s.name}: ${s.billing === "lesson" ? `занятие ${new Date(l.start).toLocaleDateString("ru-RU", { timeZone: u.timezone })} проведено. К оплате ${s.rate} ₽.` : `Осталось занятий: ${f.balance}. Пополните абонемент (${s.packageSize} занятий, ${s.packageSize * s.rate} ₽).`}\nРеквизиты: ${u.paymentDetails || "уточните у преподавателя"}`,
              `payment-${l.id}-${sid}`,
            );
        }
      }
      return {};
    }
    case "assignment.create": {
      validateStudents(a.studentIds);
      filesAllowed(d, u, a.fileIds);
      assert(
        a.links.every((x) => /^https?:\/\//.test(x)),
        "Ссылки должны начинаться с http или https",
      );
      const item = {
        ...a,
        id: id(),
        tutorId: u.tutorId,
        archived: false,
        createdAt: stamp,
      };
      d.assignments.push(item);
      for (const sid of a.studentIds)
        notify(
          d,
          u.tutorId,
          sid,
          "student",
          `Новое ДЗ: ${a.title}\n${a.text.slice(0, 2000)}\nСрок: ${new Date(a.deadline).toLocaleString("ru-RU", { timeZone: u.timezone })}\n${process.env.APP_URL || ""}`,
          `assignment-${item.id}`,
        );
      return {};
    }
    case "assignment.archive":
      owned(d.assignments, u, a.id).archived = a.archived;
      return {};
    case "submission.send": {
      assert(
        u.role === "student" && u.studentId,
        "Только ученик может сдать работу",
        403,
      );
      submit(d, u.tutorId, u.studentId, a.assignmentId, a.text, a.fileIds, u);
      return {};
    }
    case "submission.review": {
      const s = owned(d.submissions, u, a.id),
        assignment = owned(d.assignments, u, s.assignmentId);
      assert(s.status !== "reviewed", "Работа уже проверена");
      assert(
        a.status === "revision" ||
          (a.score !== undefined && a.score <= assignment.maxScore),
        "Укажите балл в пределах максимума",
      );
      Object.assign(s, {
        status: a.status,
        score: a.status === "reviewed" ? a.score : undefined,
        comment: a.comment,
        reviewedAt: stamp,
      });
      notify(
        d,
        u.tutorId,
        s.studentId,
        "student",
        `${assignment.title}: ${a.status === "reviewed" ? `${a.score}/${assignment.maxScore}` : "на доработке"}\n${a.comment}`,
        `review-${s.id}-${stamp}`,
      );
      return {};
    }
    case "payment.create": {
      const s = owned(d.students, u, a.studentId);
      if (s.billing === "package")
        assert(
          a.lessons > 0 && a.lessonIds.length === 0,
          "Укажите количество оплаченных занятий",
        );
      else {
        assert(
          a.lessons === 0 && a.lessonIds.length > 0,
          "Выберите занятия для закрытия долга",
        );
        assert(
          new Set(a.lessonIds).size === a.lessonIds.length,
          "Занятия повторяются",
        );
        const unpaid = finance(d, s).unpaid;
        assert(
          a.lessonIds.every((x) => unpaid.some((l) => l.id === x)),
          "Один из уроков уже оплачен или не проведен",
        );
        const total = unpaid
          .filter((l) => a.lessonIds.includes(l.id))
          .reduce((n, l) => n + (l.rates[s.id] ?? s.rate), 0);
        assert(
          a.amount === total,
          "Сумма должна соответствовать выбранным урокам",
        );
      }
      d.payments.push({ ...a, id: id(), tutorId: u.tutorId, createdAt: stamp });
      return {};
    }
    case "settings.save": {
      try {
        new Intl.DateTimeFormat("ru", { timeZone: a.timezone });
      } catch {
        throw new AppError("Неизвестный часовой пояс");
      }
      Object.assign(u, a);
      return {};
    }
    case "report.create": {
      owned(d.students, u, a.studentId);
      assert(process.env.DEEPSEEK_API_KEY, "DeepSeek API не подключен", 503);
      assert(
        Date.parse(a.from) < Date.parse(a.to) &&
          Date.parse(a.to) - Date.parse(a.from) <= 93 * 86400000,
        "Период отчета должен быть от 1 до 93 дней",
      );
      assert(
        !d.reports.some(
          (r) => r.studentId === a.studentId && r.status === "pending",
        ),
        "Отчет уже формируется",
      );
      return createReport(d, u, a.studentId, a.from, a.to);
    }
    case "bot.link": {
      assert(
        u.role === "student" && u.studentId,
        "Привязка доступна в кабинете ученика",
        403,
      );
      const raw = token();
      const link = botLink(a.channel, raw);
      assert(
        a.channel === "telegram"
          ? process.env.TELEGRAM_BOT_TOKEN
          : process.env.MAX_BOT_TOKEN,
        "Бот еще не подключен",
        503,
      );
      const expiresAt = new Date(Date.now() + 15 * 60000).toISOString();
      d.linkTokens = d.linkTokens.filter(
        (x) => x.studentId !== u.studentId || x.channel !== a.channel,
      );
      d.linkTokens.push({
        id: id(),
        tutorId: u.tutorId,
        studentId: u.studentId,
        channel: a.channel,
        tokenHash: hashToken(raw),
        expiresAt,
      });
      return { ...link, code: raw, expiresAt };
    }
    case "bot.unlink": {
      const b = owned(d.bindings, u, a.id);
      assert(
        u.role === "teacher" ||
          (b.studentId === u.studentId && b.role === "student"),
        "Нет доступа",
        403,
      );
      d.flows = d.flows.filter((x) => x.bindingId !== b.id);
      d.bindings = d.bindings.filter((x) => x.id !== b.id);
      return {};
    }
    case "job.retry": {
      const j = owned(d.jobs, u, a.id);
      assert(j.status === "failed", "Можно повторить только неуспешную задачу");
      j.status = "pending";
      j.attempts = 0;
      j.nextAt = stamp;
      j.error = undefined;
      if (j.kind === "report") {
        const report = d.reports.find((r) => r.id === j.reportId);
        if (report) {
          report.status = "pending";
          report.error = undefined;
        }
      }
      return {};
    }
  }
}
export function submit(
  d: Database,
  tutorId: string,
  studentId: string,
  assignmentId: string,
  text: string,
  fileIds: string[],
  u: Account,
) {
  assertSubscription(d, tutorId);
  const a = owned(d.assignments, u, assignmentId);
  assert(
    !a.archived && a.studentIds.includes(studentId),
    "Задание недоступно",
    403,
  );
  filesAllowed(d, u, fileIds);
  assert(text.trim() || fileIds.length, "Добавьте текст, фото или файл");
  const old = d.submissions.find(
    (x) => x.assignmentId === assignmentId && x.studentId === studentId,
  );
  assert(!old || old.status === "revision", "Работа уже отправлена");
  if (old)
    Object.assign(old, {
      text,
      fileIds,
      status: "submitted",
      score: undefined,
      comment: "",
      createdAt: now(),
      reviewedAt: undefined,
    });
  else
    d.submissions.push({
      id: id(),
      tutorId,
      studentId,
      assignmentId,
      text,
      fileIds,
      status: "submitted",
      comment: "",
      createdAt: now(),
    });
}
export function createReport(
  d: Database,
  u: Account,
  studentId: string,
  from: string,
  to: string,
) {
  assertSubscription(d, u.tutorId);
  const r = {
    id: id(),
    tutorId: u.tutorId,
    studentId,
    from,
    to,
    text: "",
    status: "pending" as const,
    createdAt: now(),
  };
  d.reports.push(r);
  enqueue(d, {
    id: `report-${r.id}`,
    tutorId: u.tutorId,
    kind: "report",
    reportId: r.id,
  });
  return { id: r.id };
}
export function schedule(d: Database, time = new Date()) {
  const stamp = time.toISOString();
  for (const u of d.accounts.filter((x) => x.role === "teacher")) {
    if (!subscriptionView(d, u.tutorId, time).canWrite) continue;
    for (const l of d.lessons.filter(
      (x) =>
        x.tutorId === u.id && ["planned", "rescheduled"].includes(x.status),
    )) {
      const delta = Date.parse(l.start) - time.getTime();
      for (const hours of [24, 2])
        if (
          delta > 0 &&
          delta <= hours * 3600000 &&
          delta > (hours - 1) * 3600000
        )
          for (const s of l.studentIds)
            notify(
              d,
              u.id,
              s,
              "student",
              `Занятие «${l.subject}» ${new Date(l.start).toLocaleString("ru-RU", { timeZone: u.timezone })}\n${l.location}`,
              `lesson-${l.id}-${l.start}-${hours}`,
            );
    }
    for (const a of d.assignments.filter(
      (x) => x.tutorId === u.id && !x.archived,
    )) {
      const delta = Date.parse(a.deadline) - time.getTime();
      const calendarDate = (value: Date) =>
        new Intl.DateTimeFormat("en-CA", {
          timeZone: u.timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(value);
      const hour = Number(
        new Intl.DateTimeFormat("en-GB", {
          timeZone: u.timezone,
          hour: "2-digit",
          hourCycle: "h23",
        }).format(time),
      );
      const dayReminder =
        calendarDate(new Date(a.deadline)) === calendarDate(time) &&
        (hour >= 9 || delta <= 2 * 3600000);
      for (const hours of [24, 0])
        if (
          delta > 0 &&
          (hours === 0
            ? dayReminder
            : delta <= hours * 3600000 && delta > (hours - 1) * 3600000)
        )
          for (const s of a.studentIds)
            if (
              !d.submissions.some(
                (x) =>
                  x.assignmentId === a.id &&
                  x.studentId === s &&
                  x.status !== "revision",
              )
            )
              notify(
                d,
                u.id,
                s,
                "student",
                `Напоминание о ДЗ: ${a.title}\nСрок сдачи: ${new Date(a.deadline).toLocaleString("ru-RU", { timeZone: u.timezone })}`,
                `deadline-${a.id}-${hours}`,
              );
    }
    if (u.reportDays && process.env.DEEPSEEK_API_KEY)
      for (const s of d.students.filter((x) => x.tutorId === u.id)) {
        const latest = d.reports
          .filter((r) => r.studentId === s.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        if (
          time.getTime() - Date.parse(latest?.createdAt ?? s.createdAt) >=
            u.reportDays * 86400000 &&
          d.bindings.some((b) => b.studentId === s.id && b.role === "parent")
        )
          createReport(
            d,
            u,
            s.id,
            new Date(time.getTime() - u.reportDays * 86400000).toISOString(),
            stamp,
          );
      }
  }
  d.sessions = d.sessions.filter((x) => x.expiresAt > stamp);
  d.linkTokens = d.linkTokens.filter((x) => x.expiresAt > stamp);
  d.receipts = d.receipts.filter((x) => x.expiresAt > stamp);
  d.flows = d.flows.filter((x) => x.expiresAt > stamp);
  d.limits = d.limits.filter((x) => x.expiresAt > stamp);
}

import type { Database } from "./types";
import { hashPassword, hashToken } from "./security";
export const empty = (): Database => ({
  accounts: [],
  students: [],
  groups: [],
  lessons: [],
  assignments: [],
  submissions: [],
  payments: [],
  files: [],
  invites: [],
  sessions: [],
  bindings: [],
  linkTokens: [],
  reports: [],
  jobs: [],
  flows: [],
  receipts: [],
  limits: [],
  subscriptions: [],
  subscriptionPayments: [],
  billingEvents: [],
});
export function seed(): Database {
  const d = empty(),
    now = new Date(),
    iso = now.toISOString();
  const at = (day: number, hour: number) => {
    const x = new Date(now);
    x.setDate(x.getDate() + day);
    x.setHours(hour, 0, 0, 0);
    return x.toISOString();
  };
  d.accounts.push({
    id: "demo-teacher",
    tutorId: "demo-teacher",
    role: "teacher",
    name: "Анна Смирнова",
    email: "anna@fortutor.demo",
    passwordHash: hashPassword("ForTutor2026!"),
    createdAt: iso,
    paymentDetails: "СБП: +7 (999) 123-45-67, Анна С.",
    timezone: "Europe/Moscow",
    reportDays: 14,
  });
  const names = [
    "Александра Волкова",
    "Михаил Соколов",
    "Полина Морозова",
    "Артём Лебедев",
    "София Кузнецова",
    "Даниил Орлов",
  ];
  names.forEach((name, i) =>
    d.students.push({
      id: `student-${i}`,
      tutorId: "demo-teacher",
      name,
      email: i === 0 ? "sasha@fortutor.demo" : "",
      subject: i === 4 ? "Английский язык" : "Математика",
      grade: i < 3 ? "11 класс" : "9 класс",
      billing: i % 2 ? "lesson" : "package",
      rate: 1800,
      packageSize: 8,
      initialBalance: i === 0 ? 1 : 6,
      parentCode: `FT-${100000 + i}`,
      note: "",
      createdAt: iso,
    }),
  );
  d.accounts.push({
    ...d.accounts[0],
    id: "demo-student",
    studentId: "student-0",
    role: "student",
    name: names[0],
    email: "sasha@fortutor.demo",
  });
  d.groups.push({
    id: "group-1",
    tutorId: "demo-teacher",
    name: "ЕГЭ · профиль",
    studentIds: ["student-0", "student-1", "student-2"],
  });
  [0, 1, 2, 0, 4].forEach((s, i) =>
    d.lessons.push({
      id: `lesson-${i}`,
      tutorId: "demo-teacher",
      title: i === 2 ? "Пробный вариант ЕГЭ" : "Индивидуальное занятие",
      subject: d.students[s].subject,
      studentIds: [`student-${s}`],
      start: at(i < 3 ? 0 : 1, 14 + (i % 3) * 2),
      duration: 60,
      status: "planned",
      location: "https://meet.google.com",
      attendance: {},
      rates: {},
    }),
  );
  [
    "Производная и её применение",
    "Логарифмические уравнения",
    "Тригонометрия: практика",
  ].forEach((title, i) =>
    d.assignments.push({
      id: `assignment-${i}`,
      tutorId: "demo-teacher",
      title,
      subject: "Математика",
      text: "Решите задания 1–6. Запишите ход решения и прикрепите фотографию или PDF. Обратите внимание на область допустимых значений.",
      links: [],
      fileIds: [],
      studentIds: ["student-0", "student-1", "student-2"],
      deadline: at(i + 1, 18),
      maxScore: 10,
      archived: false,
      createdAt: iso,
    }),
  );
  d.submissions.push(
    {
      id: "submission-1",
      tutorId: "demo-teacher",
      assignmentId: "assignment-0",
      studentId: "student-0",
      text: "В задании 4 получилось два корня. Проверила подстановкой.",
      fileIds: [],
      status: "submitted",
      comment: "",
      createdAt: at(-1, 18),
    },
    {
      id: "submission-2",
      tutorId: "demo-teacher",
      assignmentId: "assignment-1",
      studentId: "student-1",
      text: "Решения записал в тетради, ответ x = 3.",
      fileIds: [],
      status: "submitted",
      comment: "",
      createdAt: at(-1, 20),
    },
    {
      id: "submission-3",
      tutorId: "demo-teacher",
      assignmentId: "assignment-2",
      studentId: "student-2",
      text: "Все задания выполнены.",
      fileIds: [],
      status: "reviewed",
      score: 8,
      comment: "Хорошая работа. Повтори формулу двойного угла.",
      createdAt: at(-3, 18),
      reviewedAt: at(-2, 12),
    },
  );
  d.invites.push({
    id: "demo-invite",
    tutorId: "demo-teacher",
    studentId: "student-3",
    tokenHash: hashToken("demo-invite"),
    expiresAt: at(7, 23),
    used: false,
  });
  return d;
}

import test from "node:test";
import strict from "node:assert/strict";
import { seed } from "../lib/seed";
import { act, finance, snapshot, schedule, canReadFile } from "../lib/domain";
import { reportContext } from "../lib/reports";
import {
  hashPassword,
  verifyPassword,
  validateFile,
  hashToken,
} from "../lib/security";
import { authenticate, currentUser } from "../lib/auth";
import { normalize } from "../lib/bots";
const setup = () => {
  const db = seed();
  return { db, teacher: db.accounts[0], student: db.accounts[1] };
};
test("completed lessons charge once and an absent student is not charged", () => {
  const { db, teacher } = setup();
  const s = db.students[0];
  db.bindings.push({
    id: "parent",
    tutorId: teacher.id,
    studentId: s.id,
    role: "parent",
    channel: "telegram",
    chatId: "12",
    userId: "12",
    createdAt: new Date().toISOString(),
  });
  s.initialBalance = 2;
  act(db, teacher, {
    action: "lesson.status",
    id: "lesson-0",
    status: "completed",
  });
  strict.equal(finance(db, s).balance, 1);
  strict.equal(db.jobs.length, 1);
  act(db, teacher, {
    action: "lesson.status",
    id: "lesson-0",
    status: "completed",
  });
  strict.equal(finance(db, s).balance, 1);
  strict.equal(db.jobs.length, 1);
  act(db, teacher, {
    action: "lesson.status",
    id: "lesson-3",
    status: "completed",
    attendance: { [s.id]: false },
  });
  strict.equal(finance(db, s).balance, 1);
  strict.throws(() =>
    act(db, teacher, {
      action: "lesson.status",
      id: "lesson-0",
      status: "cancelled",
    }),
  );
});
test("per-lesson payment closes selected debt using the price at completion", () => {
  const { db, teacher } = setup();
  const s = db.students[1];
  act(db, teacher, {
    action: "lesson.status",
    id: "lesson-1",
    status: "completed",
  });
  s.rate = 2500;
  strict.equal(finance(db, s).debt, 1800);
  strict.throws(() =>
    act(db, teacher, {
      action: "payment.create",
      studentId: s.id,
      amount: 2500,
      lessons: 0,
      lessonIds: ["lesson-1"],
      note: "",
    }),
  );
  act(db, teacher, {
    action: "payment.create",
    studentId: s.id,
    amount: 1800,
    lessons: 0,
    lessonIds: ["lesson-1"],
    note: "СБП",
  });
  strict.equal(finance(db, s).debt, 0);
  strict.throws(() =>
    act(db, teacher, {
      action: "payment.create",
      studentId: s.id,
      amount: 1800,
      lessons: 0,
      lessonIds: ["lesson-1"],
      note: "",
    }),
  );
});
test("package top-up changes balance, cancellation leaves it unchanged", () => {
  const { db, teacher } = setup();
  const s = db.students[0],
    before = finance(db, s).balance;
  act(db, teacher, {
    action: "lesson.status",
    id: "lesson-0",
    status: "cancelled",
  });
  strict.equal(finance(db, s).balance, before);
  act(db, teacher, {
    action: "payment.create",
    studentId: s.id,
    amount: 14400,
    lessons: 8,
    lessonIds: [],
    note: "",
  });
  strict.equal(finance(db, s).balance, before + 8);
});
test("students cannot manage payments or access another tutor entities", () => {
  const { db, teacher, student } = setup();
  strict.throws(() =>
    act(db, student, {
      action: "payment.create",
      studentId: "student-0",
      amount: 10,
      lessons: 1,
      lessonIds: [],
      note: "",
    }),
  );
  db.students.push({ ...db.students[0], id: "foreign", tutorId: "other" });
  strict.throws(() =>
    act(db, teacher, { action: "student.invite", id: "foreign" }),
  );
  const state = snapshot(db, student);
  strict.equal(state.students.length, 1);
  strict.equal(state.students[0].parentCode, "");
  strict.ok(!("passwordHash" in state.user));
  strict.equal(state.reports.length, 0);
  strict.ok(state.assignments.every((a) => a.studentIds.length === 1));
});
test("weekly repetitions keep local wall time across DST and reject overlaps", () => {
  const { db, teacher } = setup();
  teacher.timezone = "Europe/Berlin";
  db.lessons = [];
  act(db, teacher, {
    action: "lesson.create",
    title: "Математика",
    subject: "Математика",
    studentIds: ["student-0"],
    start: "2026-10-18T08:00:00Z",
    duration: 60,
    weeks: 3,
    location: "",
  });
  strict.deepEqual(
    db.lessons.map((l) => l.start),
    [
      "2026-10-18T08:00:00Z",
      "2026-10-25T09:00:00.000Z",
      "2026-11-01T09:00:00.000Z",
    ],
  );
  strict.throws(() =>
    act(db, teacher, {
      action: "lesson.create",
      title: "Другой урок",
      subject: "Математика",
      studentIds: ["student-1"],
      start: "2026-10-18T08:30:00Z",
      duration: 60,
      weeks: 1,
      location: "",
    }),
  );
});
test("one-time invitations, hashed sessions and credential checks", () => {
  const { db, teacher } = setup();
  const invite = act(db, teacher, {
    action: "student.invite",
    id: "student-3",
  }) as { url: string };
  const raw = new URL(invite.url).searchParams.get("invite")!;
  strict.notEqual(db.invites.at(-1)!.tokenHash, raw);
  const session = authenticate(
    db,
    {
      email: "new@example.ru",
      password: "SafePassword123!",
      name: "Новый ученик",
      invite: raw,
      termsAccepted: true,
      personalDataConsent: true,
    },
    "join",
  );
  strict.equal(currentUser(db, session).studentId, "student-3");
  strict.equal(db.sessions.at(-1)!.id, hashToken(session));
  strict.throws(() =>
    authenticate(
      db,
      {
        email: "second@example.ru",
        password: "SafePassword123!",
        name: "Второй ученик",
        invite: raw,
        termsAccepted: true,
        personalDataConsent: true,
      },
      "join",
    ),
  );
  strict.throws(() =>
    authenticate(
      db,
      { email: "new@example.ru", password: "WrongPassword123" },
      "login",
    ),
  );
  const hash = hashPassword("SafePassword123!");
  strict.ok(verifyPassword("SafePassword123!", hash));
  strict.ok(!verifyPassword("WrongPassword123", hash));
});
test("assignment submission, revision and review enforce ownership and grade range", () => {
  const { db, teacher, student } = setup();
  db.submissions = [];
  act(db, student, {
    action: "submission.send",
    assignmentId: "assignment-0",
    text: "Решение",
    fileIds: [],
  });
  strict.throws(() =>
    act(db, student, {
      action: "submission.send",
      assignmentId: "assignment-0",
      text: "Повтор",
      fileIds: [],
    }),
  );
  const work = db.submissions[0];
  strict.throws(() =>
    act(db, teacher, {
      action: "submission.review",
      id: work.id,
      status: "reviewed",
      score: 11,
      comment: "Все верно",
    }),
  );
  act(db, teacher, {
    action: "submission.review",
    id: work.id,
    status: "revision",
    comment: "Проверь ОДЗ",
  });
  act(db, student, {
    action: "submission.send",
    assignmentId: "assignment-0",
    text: "Исправлено",
    fileIds: [],
  });
  act(db, teacher, {
    action: "submission.review",
    id: work.id,
    status: "reviewed",
    score: 9,
    comment: "Теперь верно",
  });
  strict.equal(work.status, "reviewed");
  strict.equal(work.score, 9);
});
test("scheduler produces reminders once per binding and honors cancellation", () => {
  const { db, teacher } = setup();
  db.assignments = [];
  db.bindings.push({
    id: "bound",
    tutorId: teacher.id,
    studentId: "student-0",
    role: "student",
    channel: "max",
    chatId: "55",
    userId: "55",
    createdAt: new Date().toISOString(),
  });
  const at = new Date("2026-10-05T10:00:00Z");
  db.lessons = [{ ...db.lessons[0], start: "2026-10-05T12:00:00Z" }];
  schedule(db, at);
  schedule(db, at);
  strict.equal(db.jobs.length, 1);
  strict.match(db.jobs[0].text!, /Математика/);
  db.jobs = [];
  db.lessons[0].status = "cancelled";
  schedule(db, at);
  strict.equal(db.jobs.length, 0);
});
test("report context includes only this student and reviewed work in the selected period", () => {
  const { db, teacher } = setup();
  const r = {
    id: "r",
    tutorId: teacher.id,
    studentId: "student-2",
    from: "2000-01-01T00:00:00Z",
    to: "2099-01-01T00:00:00Z",
    text: "",
    status: "pending" as const,
    createdAt: new Date().toISOString(),
  };
  const context = reportContext(db, r);
  strict.equal(context.checkedAssignments.length, 1);
  strict.equal(context.checkedAssignments[0].score, 8);
  strict.equal(
    context.checkedAssignments[0].comment,
    "Хорошая работа. Повтори формулу двойного угла.",
  );
  strict.equal(
    reportContext(db, { ...r, from: "2098-01-01T00:00:00Z" }).checkedAssignments
      .length,
    0,
  );
});
test("file signatures and permissions prevent forged files and cross-student access", () => {
  strict.ok(validateFile(Buffer.from("%PDF-1.7"), "application/pdf"));
  strict.ok(!validateFile(Buffer.from("<script>"), "application/pdf"));
  const { db, student, teacher } = setup();
  db.files.push({
    id: "file",
    tutorId: teacher.id,
    ownerId: "student-1",
    name: "work.pdf",
    mime: "application/pdf",
    size: 8,
    key: "private",
    createdAt: new Date().toISOString(),
  });
  strict.ok(!canReadFile(db, student, "file"));
  db.assignments[0].fileIds = ["file"];
  strict.ok(canReadFile(db, student, "file"));
  db.files[0].pending = true;
  strict.ok(!canReadFile(db, student, "file"));
});
test("Telegram and MAX normalize text, callbacks, media and bot start payloads", () => {
  strict.deepEqual(
    normalize("telegram", {
      message: {
        chat: { id: 1 },
        from: { id: 2 },
        document: {
          file_id: "abc",
          file_name: "решение.pdf",
          mime_type: "application/pdf",
        },
      },
    }).media,
    [{ fileId: "abc", name: "решение.pdf", mime: "application/pdf" }],
  );
  const event = normalize("max", {
    update_type: "message_callback",
    callback: { user: { user_id: 22 }, payload: "confirm", callback_id: "cb" },
    message: { recipient: { chat_id: 33 }, body: { text: "" } },
  });
  strict.equal(event.callback, "confirm");
  strict.equal(event.userId, "22");
  strict.equal(event.chatId, "33");
  strict.equal(
    normalize("max", {
      update_type: "bot_started",
      user: { user_id: 1 },
      chat_id: 2,
      payload: "link",
    }).text,
    "/start link",
  );
});

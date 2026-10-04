// HTTP acceptance against a LOCAL production container. Creates and removes its own tenant.
import strict from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { transaction, pool } from "../lib/db";
import { empty } from "../lib/seed";
const origin = process.env.SMOKE_URL || "http://127.0.0.1:3002";
strict.ok(
  ["127.0.0.1", "localhost"].includes(new URL(origin).hostname),
  "Smoke test is limited to localhost",
);
strict.ok(
  process.env.DATABASE_URL,
  "Set the LOCAL test DATABASE_URL for cleanup",
);
process.env.DEMO_MODE = "false";
const email = `smoke-${randomUUID()}@test.invalid`,
  password = "SmokeTestPassword!";
let teacherCookie = "",
  studentCookie = "",
  uid = "";
async function post(path: string, body: unknown, cookie = teacherCookie) {
  const response = await fetch(`${origin}/api/${path}`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  strict.ok(response.ok, `${path}: ${JSON.stringify(result)}`);
  return { response, result };
}
async function state(cookie: string) {
  const r = await fetch(`${origin}/api/state`, { headers: { Cookie: cookie } });
  strict.equal(r.status, 200);
  return r.json();
}
try {
  const health = await fetch(`${origin}/api/health`);
  strict.equal(health.status, 200);
  strict.equal((await health.json()).demo, false);
  const registered = await post(
    "auth/register",
    { name: "HTTP тест преподавателя", email, password },
    "",
  );
  teacherCookie = registered.response.headers.get("set-cookie")!.split(";")[0];
  strict.ok(registered.response.headers.get("set-cookie")!.includes("Secure"));
  uid = (await state(teacherCookie)).user.id;
  const trial = (await state(teacherCookie)).subscription;
  strict.equal(trial.status, "trial");
  strict.equal(trial.priceRub, 1190);
  strict.equal(trial.autoRenew, false);
  const billing = await fetch(`${origin}/api/billing`, {
    headers: { Cookie: teacherCookie },
  });
  strict.equal(billing.status, 200);
  strict.equal((await billing.json()).payments.length, 0);
  const foreign = await fetch(`${origin}/api/action`, {
    method: "POST",
    headers: {
      Origin: "https://foreign.invalid",
      "Content-Type": "application/json",
      Cookie: teacherCookie,
    },
    body: JSON.stringify({ action: "settings.save" }),
  });
  strict.equal(foreign.status, 403);
  const sid = (
    await post("action", {
      action: "student.create",
      name: "HTTP тест ученика",
      email: "",
      subject: "Математика",
      grade: "10 класс",
      billing: "lesson",
      rate: 1500,
      packageSize: 8,
      initialBalance: 0,
      note: "",
    })
  ).result.id;
  const invite = (await post("action", { action: "student.invite", id: sid }))
    .result.url;
  const joined = await post(
    "auth/join",
    {
      name: "HTTP тест ученика",
      email: `student-${email}`,
      password,
      invite: new URL(invite).searchParams.get("invite"),
    },
    "",
  );
  studentCookie = joined.response.headers.get("set-cookie")!.split(";")[0];
  await post("action", {
    action: "assignment.create",
    title: "Тест HTTP",
    subject: "Математика",
    text: "Решить уравнение",
    links: [],
    fileIds: [],
    studentIds: [sid],
    deadline: new Date(Date.now() + 86400000).toISOString(),
    maxScore: 10,
  });
  const aid = (await state(studentCookie)).assignments[0].id;
  await post(
    "action",
    {
      action: "submission.send",
      assignmentId: aid,
      text: "Решение тестового уравнения",
      fileIds: [],
    },
    studentCookie,
  );
  const submission = (await state(teacherCookie)).submissions[0];
  await post("action", {
    action: "submission.review",
    id: submission.id,
    status: "reviewed",
    score: 9,
    comment: "Проверено через HTTP",
  });
  strict.equal((await state(studentCookie)).submissions[0].score, 9);
  await post("action", {
    action: "lesson.create",
    title: "Тестовый урок",
    subject: "Математика",
    studentIds: [sid],
    start: new Date(Date.now() - 3600000).toISOString(),
    duration: 60,
    location: "Онлайн",
    weeks: 1,
  });
  const lid = (await state(teacherCookie)).lessons[0].id;
  await post("action", {
    action: "lesson.status",
    id: lid,
    status: "completed",
    attendance: {},
  });
  await post("action", {
    action: "payment.create",
    studentId: sid,
    amount: 1500,
    lessons: 0,
    lessonIds: [lid],
    note: "Тест API",
  });
  strict.equal((await state(teacherCookie)).payments.length, 1);
  const forbidden = await fetch(`${origin}/api/action`, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      Cookie: studentCookie,
    },
    body: JSON.stringify({
      action: "payment.create",
      studentId: sid,
      amount: 1,
      lessons: 1,
      lessonIds: [],
      note: "",
    }),
  });
  strict.equal(forbidden.status, 403);
  const studentBilling = await fetch(`${origin}/api/billing`, {
    headers: { Cookie: studentCookie },
  });
  strict.equal(studentBilling.status, 403);
  await transaction((d) => {
    const sub = d.subscriptions.find((s) => s.tutorId === uid)!;
    sub.trialEndsAt = new Date(Date.now() - 1000).toISOString();
  }, uid);
  strict.equal((await state(teacherCookie)).subscription.status, "expired");
  for (const [path, body, cookie] of [
    [
      "action",
      {
        action: "student.create",
        name: "Новый ученик",
        subject: "Математика",
        billing: "lesson",
        rate: 1000,
        packageSize: 8,
      },
      teacherCookie,
    ],
    [
      "files/presign",
      { name: "answer.pdf", mime: "application/pdf", size: 100 },
      studentCookie,
    ],
  ] as const) {
    const r = await fetch(`${origin}/api/${path}`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify(body),
    });
    strict.equal(r.status, 402, `Expired subscription blocks ${path}`);
  }
  const exported = await fetch(`${origin}/api/export`, {
    headers: { Cookie: teacherCookie },
  });
  strict.equal(exported.status, 200);
  strict.ok(
    exported.headers.get("content-disposition")?.includes("attachment"),
  );
  strict.equal((await exported.json()).subscription.status, "expired");
  strict.equal((await state(studentCookie)).subscription.canWrite, false);
  await transaction((d) => {
    d.subscriptions.find((s) => s.tutorId === uid)!.trialEndsAt = new Date(
      Date.now() + 14 * 86400000,
    ).toISOString();
  }, uid);
  const unsigned = await fetch(`${origin}/api/webhooks/max`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  strict.equal(unsigned.status, 403);
  const event = { update_type: "test_no_user", marker: email };
  const webhook = await fetch(`${origin}/api/webhooks/max`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Max-Bot-Api-Secret": "test-only-secret",
    },
    body: JSON.stringify(event),
  });
  strict.equal(webhook.status, 200);
  const deadline = Date.now() + 30000;
  let handled = false;
  while (Date.now() < deadline) {
    handled = await transaction((d) =>
      d.jobs.some(
        (j) =>
          (j.event as { marker?: string })?.marker === email &&
          j.status === "done",
      ),
    );
    if (handled) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  strict.ok(handled, "The running worker must process the HTTP outbox event");
  console.log(
    "Production HTTP smoke passed: auth, trial/billing/expiry/export, Origin, invites, homework/review, lessons/payments, role boundaries, webhook secret and worker processing.",
  );
} finally {
  if (uid)
    await transaction((d) => {
      for (const key of Object.keys(empty()) as (keyof typeof d)[]) {
        const rows = d[key] as {
          id: string;
          tutorId: string;
          event?: unknown;
        }[];
        rows.splice(
          0,
          rows.length,
          ...rows.filter(
            (x) =>
              x.tutorId !== uid && !JSON.stringify(x.event)?.includes(email),
          ),
        );
      }
    });
  if (uid) await pool().query("DELETE FROM ft_tenants WHERE id=$1", [uid]);
  await pool().end();
}

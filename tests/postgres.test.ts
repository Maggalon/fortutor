import test from "node:test";
import strict from "node:assert/strict";
import { transaction, migrate, pool } from "../lib/db";
import { empty } from "../lib/seed";
import { hashPassword, id } from "../lib/security";
import { act, finance } from "../lib/domain";
test(
  "PostgreSQL persists entity rows, rolls back errors and serializes concurrent mutations",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.DEMO_MODE = "false";
    await migrate();
    await pool().query(
      "INSERT INTO ft_tenants(id) VALUES('system') ON CONFLICT DO NOTHING",
    );
    const uid = `test-${id()}`;
    const teacher = {
      id: uid,
      tutorId: uid,
      role: "teacher" as const,
      name: "Тестовый преподаватель",
      email: `${uid}@test.invalid`,
      passwordHash: hashPassword("IntegrationPassword!"),
      createdAt: new Date().toISOString(),
      paymentDetails: "Тестовые реквизиты",
      timezone: "Europe/Moscow",
      reportDays: 0,
    };
    try {
      const sid = await transaction((d) => {
        d.accounts.push(teacher);
        return (
          act(d, teacher, {
            action: "student.create",
            name: "Тестовый ученик",
            email: "",
            subject: "Математика",
            grade: "11 класс",
            billing: "package",
            rate: 1800,
            packageSize: 8,
            initialBalance: 0,
            note: "",
          }) as { id: string }
        ).id;
      });
      await Promise.all(
        Array.from({ length: 10 }, () =>
          transaction((d) => {
            act(d, teacher, {
              action: "payment.create",
              studentId: sid,
              amount: 1800,
              lessons: 1,
              lessonIds: [],
              note: "",
            });
          }),
        ),
      );
      strict.equal(
        await transaction(
          (d) =>
            finance(
              d,
              d.students.find((s) => s.id === sid)!,
            ).balance,
        ),
        10,
      );
      await strict.rejects(
        transaction((d) => {
          d.students.find((s) => s.id === sid)!.name = "Несохраненное имя";
          throw new Error("Rollback");
        }),
      );
      strict.equal(
        await transaction((d) => d.students.find((s) => s.id === sid)!.name),
        "Тестовый ученик",
      );
      const rows = await pool().query(
        "SELECT count(*) FROM ft_payments WHERE tutor_id=$1",
        [uid],
      );
      strict.equal(Number(rows.rows[0].count), 10);
    } finally {
      await transaction((d) => {
        for (const key of Object.keys(empty()) as (keyof typeof d)[]) {
          const rows = d[key] as { tutorId: string }[];
          rows.splice(0, rows.length, ...rows.filter((x) => x.tutorId !== uid));
        }
      });
      await pool().query("DELETE FROM ft_tenants WHERE id=$1", [uid]);
      await pool().end();
    }
  },
);

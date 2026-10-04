import { Pool } from "pg";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { empty, seed } from "./seed";
import type { Database, Collection } from "./types";
import { assert } from "./security";
const collections = Object.keys(empty()) as Collection[];
export const demoMode = () =>
  process.env.DEMO_MODE === "true" ||
  (process.env.NODE_ENV !== "production" && !process.env.DATABASE_URL);
const globals = globalThis as typeof globalThis & {
  ftPool?: Pool;
  ftLock?: Promise<unknown>;
};
export function pool() {
  if (!globals.ftPool) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
    globals.ftPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      ssl:
        process.env.DATABASE_SSL === "true"
          ? { rejectUnauthorized: true }
          : undefined,
    });
  }
  return globals.ftPool;
}
export async function migrate() {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(78192044)");
    await client.query(
      `CREATE TABLE IF NOT EXISTS ft_schema(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()); CREATE TABLE IF NOT EXISTS ft_tenants(id text PRIMARY KEY);`,
    );
    for (const c of collections) {
      await client.query(
        `CREATE TABLE IF NOT EXISTS ft_${c}(id text PRIMARY KEY,tutor_id text NOT NULL REFERENCES ft_tenants(id),data jsonb NOT NULL); CREATE INDEX IF NOT EXISTS ft_${c}_tenant ON ft_${c}(tutor_id);`,
      );
    }
    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS ft_accounts_email ON ft_accounts((lower(data->>'email'))); CREATE UNIQUE INDEX IF NOT EXISTS ft_students_parent_code ON ft_students((data->>'parentCode')); INSERT INTO ft_schema(version) VALUES(1) ON CONFLICT DO NOTHING;`,
    );
    await client.query(
      "INSERT INTO ft_tenants(id) VALUES('system') ON CONFLICT DO NOTHING",
    );
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ft_subscription_payment_provider ON ft_subscriptionPayments((data->>'providerId')) WHERE data->>'providerId' IS NOT NULL;
      CREATE INDEX IF NOT EXISTS ft_subscription_payment_pending ON ft_subscriptionPayments((data->>'status'),(data->>'checkedAt'));
      INSERT INTO ft_subscriptions(id,tutor_id,data)
      SELECT id,id,jsonb_build_object('id',id,'tutorId',id,'trialEndsAt',to_char((now() AT TIME ZONE 'UTC') + interval '14 days','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'autoRenew',false,'renewalVersion',0,'failedAttempts',0)
      FROM ft_accounts WHERE data->>'role'='teacher' ON CONFLICT DO NOTHING;
      INSERT INTO ft_schema(version) VALUES(2) ON CONFLICT DO NOTHING;
    `);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
// Tenant operations share the global lock and take a separate exclusive tenant lock.
// Cross-tenant routing/registration still takes the exclusive global lock.
export async function transaction<T>(
  fn: (db: Database) => T | Promise<T>,
  tutorId?: string,
): Promise<T> {
  if (demoMode()) {
    if (process.env.NODE_ENV === "production")
      throw new Error("Demo is forbidden in production");
    const work = async () => {
      const dir = path.join(process.cwd(), ".data");
      await mkdir(dir, { recursive: true });
      let d: Database;
      try {
        d = Object.assign(
          empty(),
          JSON.parse(await readFile(path.join(dir, "database.json"), "utf8")),
        );
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        d = seed();
      }
      const result = await fn(d);
      await writeFile(path.join(dir, "database.tmp"), JSON.stringify(d));
      await rename(
        path.join(dir, "database.tmp"),
        path.join(dir, "database.json"),
      );
      return result;
    };
    const p = (globals.ftLock ?? Promise.resolve()).then(work, work);
    globals.ftLock = p.catch(() => {});
    return p;
  }
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    if (tutorId) {
      await client.query("SELECT pg_advisory_xact_lock_shared(78192044)");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`fortutor:${tutorId}`],
      );
    } else await client.query("SELECT pg_advisory_xact_lock(78192044)");
    const d = empty();
    for (const c of collections) {
      const rows = tutorId
        ? await client.query(`SELECT data FROM ft_${c} WHERE tutor_id=$1`, [
            tutorId,
          ])
        : await client.query(`SELECT data FROM ft_${c}`);
      (d[c] as unknown[]).push(...rows.rows.map((r) => r.data));
    }
    const before = structuredClone(d);
    const result = await fn(d);
    for (const a of d.accounts.filter((x) => x.role === "teacher"))
      await client.query(
        "INSERT INTO ft_tenants(id) VALUES($1) ON CONFLICT DO NOTHING",
        [a.id],
      );
    for (const c of collections) {
      const old = new Map(before[c].map((x) => [x.id, JSON.stringify(x)]));
      for (const row of d[c]) {
        assert(
          !tutorId || row.tutorId === tutorId,
          "Запись вне рабочего пространства",
          403,
        );
        if (old.get(row.id) !== JSON.stringify(row))
          await client.query(
            `INSERT INTO ft_${c}(id,tutor_id,data) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET tutor_id=EXCLUDED.tutor_id,data=EXCLUDED.data WHERE ft_${c}.tutor_id=EXCLUDED.tutor_id`,
            [row.id, row.tutorId, JSON.stringify(row)],
          );
        old.delete(row.id);
      }
      for (const key of old.keys())
        await client.query(
          `DELETE FROM ft_${c} WHERE id=$1${tutorId ? " AND tutor_id=$2" : ""}`,
          tutorId ? [key, tutorId] : [key],
        );
    }
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

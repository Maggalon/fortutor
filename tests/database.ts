import { randomUUID } from "node:crypto";
import type { TestContext } from "node:test";
import { Pool } from "pg";
import { pool } from "../lib/db";

// Test files run in separate processes but share TEST_DATABASE_URL. Give each
// file its own schema so global workers and fixture cleanup cannot cross suites.
export async function isolateTestDatabase(t: TestContext) {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) throw new Error("TEST_DATABASE_URL required");
  const schema = `ft_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: raw, max: 1 });
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
  } catch (error) {
    await admin.end();
    throw error;
  }
  const url = new URL(raw);
  const options = url.searchParams.get("options") || "";
  url.searchParams.set("options", `${options} -c search_path=${schema}`.trim());
  process.env.DATABASE_URL = url.toString();
  process.env.DEMO_MODE = "false";
  t.after(async () => {
    try {
      await pool().end();
    } finally {
      try {
        // schema is generated here, never supplied by the environment.
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      } finally {
        await admin.end();
      }
    }
  });
}

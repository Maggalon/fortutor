import test from "node:test";
import strict from "node:assert/strict";
import { spawnSync } from "node:child_process";

function check(overrides: Partial<NodeJS.ProcessEnv> = {}) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/check-config.ts"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_ENV: "production",
        DEMO_MODE: "false",
        APP_URL: "https://tutor.test.invalid",
        DATABASE_URL: "postgresql://test:test@localhost/unused",
        REDIS_URL: "redis://localhost:6379",
        S3_BUCKET: "test-bucket",
        S3_ACCESS_KEY_ID: "test-access",
        S3_SECRET_ACCESS_KEY: "test-storage-secret",
        YOOKASSA_SHOP_ID: "",
        YOOKASSA_SECRET_KEY: "",
        YOOKASSA_TEST_MODE: undefined,
        YOOKASSA_RECEIPTS: undefined,
        YOOKASSA_VAT_CODE: "",
        ...overrides,
      },
    },
  );
}

test("production preflight allows the first deployment without YooKassa", () => {
  const result = check();
  strict.equal(result.status, 0, result.stderr);
  strict.match(result.stdout, /payments and automatic charges are disabled/);
  strict.ok(!result.stdout.includes("test-storage-secret"));
  strict.notEqual(check({ S3_BUCKET: "" }).status, 0);
});

test("production preflight rejects incomplete YooKassa credentials", () => {
  for (const env of [
    { YOOKASSA_SHOP_ID: "test-shop" },
    { YOOKASSA_SECRET_KEY: "test-secret" },
  ]) {
    const result = check(env);
    strict.notEqual(result.status, 0);
    strict.match(result.stderr, /оставьте оба пустыми/);
  }
});

test("configured YooKassa still requires valid payment and receipt settings", () => {
  const env = {
    YOOKASSA_SHOP_ID: "test-shop",
    YOOKASSA_SECRET_KEY: "test-secret",
    YOOKASSA_TEST_MODE: "true",
    YOOKASSA_RECEIPTS: "false",
  };
  const result = check(env);
  strict.equal(result.status, 0, result.stderr);
  strict.doesNotMatch(
    result.stdout,
    /payments and automatic charges are disabled/,
  );
  strict.notEqual(check({ ...env, YOOKASSA_TEST_MODE: "invalid" }).status, 0);
  strict.notEqual(check({ ...env, YOOKASSA_RECEIPTS: "true" }).status, 0);
  strict.equal(
    check({ ...env, YOOKASSA_RECEIPTS: "true", YOOKASSA_VAT_CODE: "1" }).status,
    0,
  );
});

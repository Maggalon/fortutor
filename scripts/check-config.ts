import { assert } from "../lib/security";
import {
  botLink,
  telegramUsername,
  telegramUpdateMode,
} from "../lib/bot-config";
for (const name of [
  "APP_URL",
  "DATABASE_URL",
  "REDIS_URL",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
])
  assert(process.env[name], `Заполните ${name} в .env.production`);
assert(
  new URL(process.env.APP_URL!).protocol === "https:",
  "APP_URL должен использовать HTTPS",
);
assert(process.env.DEMO_MODE === "false", "DEMO_MODE должен быть false");
if (process.env.TELEGRAM_BOT_TOKEN) {
  telegramUsername();
  if (telegramUpdateMode() === "webhook")
    assert(
      process.env.TELEGRAM_WEBHOOK_SECRET &&
        /^[a-z\d_-]{1,256}$/i.test(process.env.TELEGRAM_WEBHOOK_SECRET),
      "Заполните корректный TELEGRAM_WEBHOOK_SECRET",
    );
}
if (process.env.MAX_BOT_TOKEN) {
  botLink("max", "config-check");
  assert(process.env.MAX_WEBHOOK_SECRET, "Заполните MAX_WEBHOOK_SECRET");
}
const shopId = process.env.YOOKASSA_SHOP_ID;
const secretKey = process.env.YOOKASSA_SECRET_KEY;
assert(
  !!shopId === !!secretKey,
  "Заполните YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY вместе либо оставьте оба пустыми",
);
if (shopId && secretKey) {
  assert(
    ["true", "false"].includes(process.env.YOOKASSA_TEST_MODE || ""),
    "Укажите YOOKASSA_TEST_MODE=true или false",
  );
  assert(
    ["true", "false"].includes(process.env.YOOKASSA_RECEIPTS || ""),
    "Укажите YOOKASSA_RECEIPTS=true или false",
  );
  if (process.env.YOOKASSA_RECEIPTS === "true") {
    const vat = Number(process.env.YOOKASSA_VAT_CODE);
    assert(
      Number.isInteger(vat) && vat >= 1 && vat <= 12,
      "Заполните YOOKASSA_VAT_CODE",
    );
  }
}
console.log("Production configuration validated (secret values hidden).");
if (!shopId)
  console.log(
    "YooKassa is not configured: trial access is available; payments and automatic charges are disabled.",
  );

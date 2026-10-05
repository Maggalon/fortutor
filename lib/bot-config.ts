import type { Channel } from "./types";
import { assert, AppError } from "./security";

export const botCommands = [
  { command: "start", description: "Открыть меню" },
  { command: "help", description: "Помощь и список команд" },
  { command: "homework", description: "Сдать домашнее задание" },
  { command: "balance", description: "Баланс занятий" },
  { command: "cancel", description: "Отменить отправку ДЗ" },
  { command: "unlink", description: "Отключить бота" },
];

export function telegramUsername(value = process.env.TELEGRAM_BOT_USERNAME) {
  const username = (value || "")
    .trim()
    .replace(/^https:\/\/(?:t\.me|telegram\.me)\//i, "")
    .replace(/^@/, "")
    .replace(/\/$/, "");
  assert(
    /^[a-z\d_]{5,32}$/i.test(username),
    "Проверьте TELEGRAM_BOT_USERNAME: нужен username бота",
    503,
  );
  return username;
}

export function botLink(channel: Channel, code: string) {
  if (channel === "telegram") {
    const username = telegramUsername();
    return {
      url: `https://t.me/${username}?start=${encodeURIComponent(code)}`,
      appUrl: `tg://resolve?domain=${username}&start=${encodeURIComponent(code)}`,
      username: `@${username}`,
    };
  }
  const value = process.env.MAX_BOT_URL?.trim();
  assert(value, "Бот MAX еще не подключен", 503);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError(
      "Проверьте MAX_BOT_URL: нужна публичная HTTPS-ссылка бота",
      503,
    );
  }
  assert(
    url.protocol === "https:" &&
      url.hostname === "max.ru" &&
      url.pathname !== "/" &&
      !url.username &&
      !url.password &&
      !url.port,
    "Проверьте MAX_BOT_URL: нужна публичная ссылка https://max.ru/…",
    503,
  );
  url.searchParams.set("start", code);
  url.hash = "";
  return { url: url.toString() };
}

export function botWebhookUrl(channel: Channel) {
  const value = process.env.APP_URL?.trim();
  assert(value, "APP_URL обязателен для настройки ботов");
  const url = new URL(value);
  assert(
    url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash,
    "APP_URL должен быть публичным HTTPS-адресом без query-параметров",
  );
  return `${value.replace(/\/+$/, "")}/api/webhooks/${channel}`;
}

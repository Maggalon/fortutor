import { ProxyAgent } from "undici";
import { assert } from "./security";

let cached: { url: string; agent: ProxyAgent } | undefined;

function proxyAgent() {
  const value = process.env.TELEGRAM_PROXY_URL?.trim();
  if (!value) return undefined;
  if (cached?.url === value) return cached.agent;
  let url: URL;
  try {
    url = new URL(value);
    assert(
      ["http:", "https:"].includes(url.protocol) &&
        url.pathname === "/" &&
        !url.search &&
        !url.hash,
      "Некорректный адрес прокси",
    );
    // Decode credentials before constructing the CONNECT authentication header.
    const token =
      url.username || url.password
        ? `Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString("base64")}`
        : undefined;
    const agent = new ProxyAgent({ uri: url.origin, token });
    if (cached) void cached.agent.close().catch(() => {});
    cached = { url: value, agent };
    return agent;
  } catch {
    throw new Error(
      "TELEGRAM_PROXY_URL должен иметь формат http://USER:PASSWORD@HOST:PORT",
    );
  }
}

export async function telegramFetch(url: string, init: RequestInit = {}) {
  const target = new URL(url);
  assert(
    target.protocol === "https:" && target.hostname === "api.telegram.org",
    "Недопустимый адрес Telegram API",
  );
  const agent = proxyAgent();
  const options: RequestInit & { dispatcher?: ProxyAgent } = {
    ...init,
    redirect: "error",
    ...(agent ? { dispatcher: agent } : {}),
  };
  try {
    return await fetch(url, options);
  } catch {
    // Never include the proxy URL or bot token in logs or client errors.
    throw new Error(
      agent
        ? "Telegram: не удалось выполнить запрос через HTTP-прокси. Проверьте доступность прокси и его учетные данные."
        : "Telegram: API недоступен с сервера. Проверьте исходящий HTTPS или настройте TELEGRAM_PROXY_URL.",
    );
  }
}

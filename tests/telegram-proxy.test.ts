import test from "node:test";
import strict from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { ProxyAgent } from "undici";
import { telegramFetch } from "../lib/telegram-transport";
import { telegram, maxRequest, readMedia } from "../lib/providers";

test("Telegram uses an authenticated CONNECT tunnel and reports errors without secrets", async () => {
  const previous = process.env.TELEGRAM_PROXY_URL;
  const seen: { host?: string; auth?: string } = {};
  const proxy = createServer();
  proxy.on("connect", (req, socket) => {
    seen.host = req.url;
    seen.auth = req.headers["proxy-authorization"];
    socket.end(
      "HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
    );
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  process.env.TELEGRAM_PROXY_URL = `http://proxy-user:proxy-password@127.0.0.1:${(proxy.address() as AddressInfo).port}`;
  try {
    await strict.rejects(
      telegramFetch("https://api.telegram.org/botprivate-token/getMe", {
        signal: AbortSignal.timeout(3000),
      }),
      (error: Error) => {
        strict.match(error.message, /через HTTP-прокси/);
        strict.doesNotMatch(
          error.message,
          /proxy-password|proxy-user|private-token/,
        );
        return true;
      },
    );
    strict.equal(seen.host, "api.telegram.org:443");
    strict.equal(
      seen.auth,
      `Basic ${Buffer.from("proxy-user:proxy-password").toString("base64")}`,
    );
  } finally {
    if (previous === undefined) delete process.env.TELEGRAM_PROXY_URL;
    else process.env.TELEGRAM_PROXY_URL = previous;
    proxy.closeAllConnections();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
  }
});

test("proxy applies to Telegram methods and files while MAX remains direct", async () => {
  const previous = {
    proxy: process.env.TELEGRAM_PROXY_URL,
    telegram: process.env.TELEGRAM_BOT_TOKEN,
    max: process.env.MAX_BOT_TOKEN,
  };
  const original = globalThis.fetch;
  const calls: { url: string; proxy: boolean }[] = [];
  process.env.TELEGRAM_PROXY_URL = "http://user:password@127.0.0.1:12345";
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.MAX_BOT_TOKEN = "test-token";
  globalThis.fetch = async (input, init) => {
    calls.push({
      url: String(input),
      proxy:
        (init as RequestInit & { dispatcher?: unknown })?.dispatcher instanceof
        ProxyAgent,
    });
    if (String(input).includes("/file/") || String(input).includes("okcdn.ru"))
      return new Response("%PDF-1.7");
    return Response.json({ ok: true, result: true, success: true });
  };
  try {
    await telegram("getMe", {});
    await readMedia("https://api.telegram.org/file/bottest-token/document.pdf");
    await maxRequest("GET", "/me");
    await readMedia("https://okcdn.ru/document.pdf");
    strict.deepEqual(
      calls.map((c) => c.proxy),
      [true, true, false, false],
    );
    delete process.env.TELEGRAM_PROXY_URL;
    await telegram("getMe", {});
    strict.equal(calls.at(-1)!.proxy, false);
    process.env.TELEGRAM_PROXY_URL = "http://user:private-password@host/path";
    await strict.rejects(telegram("getMe", {}), (error: Error) => {
      strict.match(error.message, /TELEGRAM_PROXY_URL/);
      strict.doesNotMatch(error.message, /private-password/);
      return true;
    });
  } finally {
    globalThis.fetch = original;
    for (const [key, value] of [
      ["TELEGRAM_PROXY_URL", previous.proxy],
      ["TELEGRAM_BOT_TOKEN", previous.telegram],
      ["MAX_BOT_TOKEN", previous.max],
    ]) {
      if (value === undefined) delete process.env[key!];
      else process.env[key!] = value;
    }
  }
});

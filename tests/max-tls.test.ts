import test from "node:test";
import strict from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { Agent } from "undici";
import { getGlobalDispatcher } from "undici";
import { maxFetch } from "../lib/max-transport";

test("MAX CA bundle contains valid CA certificates with a verified chain", () => {
  const pem = readFileSync("certs/max-ca.pem", "utf8");
  const certs = pem
    .match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)!
    .map((value) => new X509Certificate(value));
  strict.equal(certs.length, 2);
  for (const cert of certs) {
    strict.equal(cert.ca, true);
    strict.ok(Date.parse(cert.validFrom) <= Date.now());
    strict.ok(Date.parse(cert.validTo) > Date.now());
  }
  strict.equal(certs[0].subject, certs[0].issuer);
  strict.equal(certs[0].verify(certs[0].publicKey), true);
  strict.equal(certs[1].verify(certs[0].publicKey), true);
});

test("MAX uses its own TLS agent, keeps the global dispatcher and reports certificate errors clearly", async () => {
  const original = globalThis.fetch;
  const global = getGlobalDispatcher();
  let dispatcher: unknown;
  globalThis.fetch = async (_input, init) => {
    dispatcher = (init as RequestInit & { dispatcher?: unknown }).dispatcher;
    strict.equal(init?.redirect, "error");
    return Response.json({ success: true });
  };
  try {
    await maxFetch("https://platform-api2.max.ru/me");
    strict.ok(dispatcher instanceof Agent);
    strict.equal(getGlobalDispatcher(), global);
    globalThis.fetch = async () => {
      throw new TypeError("fetch failed", {
        cause: { code: "UNABLE_TO_GET_ISSUER_CERT_LOCALLY" },
      });
    };
    await strict.rejects(
      maxFetch("https://platform-api2.max.ru/me"),
      /MAX: не удалось проверить TLS-сертификат/,
    );
  } finally {
    globalThis.fetch = original;
  }
});

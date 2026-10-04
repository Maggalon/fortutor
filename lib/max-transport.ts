import { Agent } from "undici";
import { readFileSync } from "node:fs";
import { getCACertificates } from "node:tls";
import path from "node:path";

let agent: Agent | undefined;
function maxAgent() {
  if (!agent) {
    const bundle = readFileSync(
      path.join(process.cwd(), "certs", "max-ca.pem"),
      "utf8",
    );
    agent = new Agent({
      connect: { ca: [...getCACertificates("default"), bundle] },
    });
  }
  return agent;
}

export async function maxFetch(url: string, init: RequestInit = {}) {
  const options: RequestInit & { dispatcher: Agent } = {
    ...init,
    redirect: "error",
    dispatcher: maxAgent(),
  };
  try {
    return await fetch(url, options);
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code;
    if (
      [
        "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
        "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
        "CERT_HAS_EXPIRED",
        "ERR_TLS_CERT_ALTNAME_INVALID",
      ].includes(code || "")
    )
      throw new Error(
        "MAX: не удалось проверить TLS-сертификат. Проверьте актуальность certs/max-ca.pem и сертификат API.",
      );
    throw new Error(
      "MAX: API недоступен с сервера. Проверьте исходящий HTTPS и адрес MAX_API_URL.",
    );
  }
}

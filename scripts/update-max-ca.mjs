// Public CA certificates from the download service linked by gosuslugi.ru/crt.
import { X509Certificate } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
const sources = [
  "https://gu-st.ru/content/Other/doc/russian_trusted_root_ca.cer",
  "https://gu-st.ru/content/Other/doc/russian_trusted_sub_ca.cer",
];
const certificates = [];
for (const url of sources) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30000),
    redirect: "error",
  });
  if (!response.ok)
    throw new Error(`Certificate download failed: HTTP ${response.status}`);
  const cert = new X509Certificate(Buffer.from(await response.arrayBuffer()));
  if (
    !cert.ca ||
    Date.parse(cert.validFrom) > Date.now() ||
    Date.parse(cert.validTo) <= Date.now()
  )
    throw new Error("Downloaded certificate is not a currently valid CA");
  certificates.push(cert);
}
const [root, intermediate] = certificates;
if (
  root.subject !== root.issuer ||
  !root.verify(root.publicKey) ||
  !intermediate.verify(root.publicKey)
)
  throw new Error("Downloaded CA signatures do not form the expected chain");
await mkdir("certs", { recursive: true });
await writeFile(
  "certs/max-ca.pem",
  certificates.map((cert) => cert.toString()).join("\n"),
);
for (const cert of certificates)
  console.log(
    `${cert.subject}\nSHA256: ${cert.fingerprint256}\nValid until: ${cert.validTo}`,
  );

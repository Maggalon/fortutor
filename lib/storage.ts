import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { id, assert, validateFile } from "./security";
import { demoMode } from "./db";
import type { StoredFile, Account } from "./types";
function client() {
  assert(process.env.S3_BUCKET, "Файловое хранилище не подключено", 503);
  return new S3Client({
    endpoint: process.env.S3_ENDPOINT || undefined,
    region: process.env.S3_REGION || "us-east-1",
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: process.env.S3_ACCESS_KEY_ID
      ? {
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
        }
      : undefined,
  });
}
export async function storeFile(
  u: Account,
  name: string,
  mime: string,
  bytes: Uint8Array,
): Promise<StoredFile> {
  assert(
    validateFile(bytes, mime),
    "Разрешены настоящие JPG, PNG и PDF до 20 МБ",
  );
  const fid = id(),
    key = `${u.tutorId}/${fid}`;
  if (demoMode()) {
    const dir = path.join(process.cwd(), ".data", "uploads");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, fid), bytes);
  } else
    await client().send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        Body: bytes,
        ContentType: mime,
      }),
    );
  return {
    id: fid,
    tutorId: u.tutorId,
    ownerId: u.studentId || u.id,
    name: name.replace(/[\r\n]/g, "").slice(0, 200),
    mime,
    size: bytes.length,
    key,
    createdAt: new Date().toISOString(),
  };
}
export async function downloadFile(f: StoredFile) {
  if (demoMode())
    return new Response(
      new Uint8Array(
        await readFile(path.join(process.cwd(), ".data", "uploads", f.id)),
      ),
      {
        headers: {
          "Content-Type": f.mime,
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,
          "Cache-Control": "private, no-store",
        },
      },
    );
  return Response.redirect(
    await getSignedUrl(
      client(),
      new GetObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: f.key,
        ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      }),
      { expiresIn: 300 },
    ),
  );
}
export async function prepareUpload(
  u: Account,
  name: string,
  mime: string,
  size: number,
) {
  assert(
    ["image/png", "image/jpeg", "application/pdf"].includes(mime) &&
      size > 0 &&
      size <= 20 * 1024 * 1024,
    "Разрешены JPG, PNG и PDF до 20 МБ",
  );
  const fid = id();
  const file: StoredFile = {
    id: fid,
    tutorId: u.tutorId,
    ownerId: u.studentId || u.id,
    name: name.replace(/[\r\n]/g, "").slice(0, 200),
    mime,
    size,
    key: `staging/${u.tutorId}/${fid}`,
    createdAt: new Date().toISOString(),
    pending: true,
  };
  const url = await getSignedUrl(
    client(),
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: file.key,
      ContentType: mime,
      ContentLength: size,
    }),
    { expiresIn: 300 },
  );
  return { file, url };
}
export async function verifyUpload(f: StoredFile) {
  const s3 = client();
  const key = `${f.tutorId}/${f.id}/${id()}`;
  await s3.send(
    new CopyObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      CopySource: `${process.env.S3_BUCKET}/${f.key.split("/").map(encodeURIComponent).join("/")}`,
    }),
  );
  const head = await s3.send(
    new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
  );
  assert(
    head.ContentLength === f.size && head.ContentType === f.mime,
    "Размер или тип загруженного файла не совпадает",
  );
  const prefix = await s3.send(
    new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      Range: "bytes=0-7",
    }),
  );
  const bytes = await prefix.Body?.transformToByteArray();
  assert(
    bytes && validateFile(bytes, f.mime),
    "Файл не соответствует формату JPG, PNG или PDF",
  );
  return key;
}

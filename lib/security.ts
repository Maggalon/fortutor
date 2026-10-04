import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
export const id = () => randomBytes(16).toString("hex");
export const token = () => randomBytes(32).toString("base64url");
export const hashToken = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function hashPassword(value: string) {
  const salt = id();
  return `${salt}:${scryptSync(value, salt, 64).toString("hex")}`;
}
export function verifyPassword(value: string, stored: string) {
  const [salt, digest] = stored.split(":");
  if (!salt || !digest) return false;
  const a = scryptSync(value, salt, 64),
    b = Buffer.from(digest, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function assert(
  condition: unknown,
  message: string,
  status = 400,
): asserts condition {
  if (!condition) throw new AppError(message, status);
}
export function validateFile(bytes: Uint8Array, mime: string) {
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) return false;
  const b = Buffer.from(bytes);
  return mime === "application/pdf"
    ? b.subarray(0, 5).toString() === "%PDF-"
    : mime === "image/png"
      ? b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : mime === "image/jpeg"
        ? b[0] === 255 && b[1] === 216 && b[2] === 255
        : false;
}

import { z } from "zod";
import { cookies } from "next/headers";
import type { Account, Database } from "./types";
import {
  assert,
  id,
  token,
  hashToken,
  hashPassword,
  verifyPassword,
} from "./security";
import { now } from "./domain";
import { transaction, demoMode, pool } from "./db";
import { ensureSubscription } from "./subscription";
import { LEGAL_VERSION } from "./legal";
export function currentUser(d: Database, raw: string | undefined) {
  assert(raw, "Войдите в аккаунт", 401);
  const s = d.sessions.find(
    (x) => x.id === hashToken(raw) && x.expiresAt > now(),
  );
  assert(s, "Сессия истекла. Войдите снова", 401);
  const u = d.accounts.find((x) => x.id === s.accountId);
  assert(u, "Аккаунт не найден", 401);
  return u;
}
export async function sessionToken() {
  return (await cookies()).get("ft_session")?.value;
}
export async function setSession(raw: string) {
  (await cookies()).set("ft_session", raw, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 86400,
  });
}
export function limit(
  d: Database,
  key: string,
  max = 10,
  minutes = 15,
  tutorId = "system",
) {
  const stamp = now();
  let l = d.limits.find((x) => x.id === hashToken(key) && x.expiresAt > stamp);
  if (!l) {
    l = {
      id: hashToken(key),
      tutorId,
      count: 0,
      expiresAt: new Date(Date.now() + minutes * 60000).toISOString(),
    };
    d.limits.push(l);
  }
  l.count++;
  return l.count <= max;
}
const credentials = z.object({
  email: z.email().transform((x) => x.trim().toLowerCase()),
  password: z.string().min(12).max(200),
  name: z.string().trim().min(2).max(100).optional(),
  invite: z.string().max(200).optional(),
  termsAccepted: z.boolean().optional(),
  personalDataConsent: z.boolean().optional(),
});
export function authenticate(
  d: Database,
  input: unknown,
  mode: "login" | "register" | "join",
) {
  const a = credentials.parse(input);
  let u: Account | undefined;
  if (mode === "login") {
    u = d.accounts.find((x) => x.email.toLowerCase() === a.email);
    assert(
      u && verifyPassword(a.password, u.passwordHash),
      "Неверный email или пароль",
      401,
    );
  } else {
    assert(a.name, "Укажите имя");
    assert(
      a.termsAccepted === true,
      "Примите пользовательское соглашение и оферту",
    );
    assert(
      a.personalDataConsent === true,
      "Необходимо отдельное согласие на обработку персональных данных",
    );
    assert(
      !d.accounts.some((x) => x.email.toLowerCase() === a.email),
      "Этот email уже зарегистрирован",
      409,
    );
    const uid = id();
    let tutorId = uid,
      studentId: string | undefined;
    if (mode === "join") {
      const invite = d.invites.find(
        (x) =>
          x.tokenHash === hashToken(a.invite ?? "") &&
          !x.used &&
          x.expiresAt > now(),
      );
      assert(invite, "Приглашение недействительно или истекло", 410);
      assert(
        !d.accounts.some((x) => x.studentId === invite.studentId),
        "Ученик уже зарегистрирован",
        409,
      );
      invite.used = true;
      tutorId = invite.tutorId;
      studentId = invite.studentId;
      const s = d.students.find((x) => x.id === studentId)!;
      s.email = a.email;
      s.name = a.name;
    }
    u = {
      id: uid,
      tutorId,
      studentId,
      role: mode === "join" ? "student" : "teacher",
      name: a.name,
      email: a.email,
      passwordHash: hashPassword(a.password),
      createdAt: now(),
      paymentDetails: "",
      timezone: "Europe/Moscow",
      reportDays: 14,
      legalAcceptance: {
        termsVersion: LEGAL_VERSION,
        termsAt: now(),
        personalDataVersion: LEGAL_VERSION,
        personalDataAt: now(),
      },
    };
    d.accounts.push(u);
    if (u.role === "teacher") ensureSubscription(d, u.id);
  }
  return makeSession(d, u);
}
export async function userTransaction<T>(
  raw: string | undefined,
  fn: (d: Database, u: Account) => T | Promise<T>,
): Promise<T> {
  assert(raw, "Войдите в аккаунт", 401);
  if (demoMode()) return transaction((d) => fn(d, currentUser(d, raw)));
  const result = await pool().query(
    "SELECT tutor_id FROM ft_sessions WHERE id=$1 AND data->>'expiresAt'>$2",
    [hashToken(raw), now()],
  );
  assert(result.rows[0], "Сессия истекла. Войдите снова", 401);
  return transaction(
    (d) => fn(d, currentUser(d, raw)),
    result.rows[0].tutor_id,
  );
}
export function makeSession(d: Database, u: Account) {
  const raw = token();
  d.sessions.push({
    id: hashToken(raw),
    tutorId: u.tutorId,
    accountId: u.id,
    expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
  });
  return raw;
}

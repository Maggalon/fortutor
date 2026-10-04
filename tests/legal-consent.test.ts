import test from "node:test";
import strict from "node:assert/strict";
import { seed } from "../lib/seed";
import { authenticate, currentUser } from "../lib/auth";
import { LEGAL_VERSION } from "../lib/legal";

test("registration requires separate confirmations and records their versions and time", () => {
  const d = seed();
  const input = {
    email: "legal-test@example.ru",
    password: "LegalConsentPassword!",
    name: "Новый преподаватель",
  };
  const count = d.accounts.length;
  strict.throws(
    () => authenticate(d, input, "register"),
    /Примите пользовательское соглашение/,
  );
  strict.throws(
    () => authenticate(d, { ...input, termsAccepted: true }, "register"),
    /отдельное согласие/,
  );
  strict.equal(d.accounts.length, count);
  const start = Date.now();
  const raw = authenticate(
    d,
    { ...input, termsAccepted: true, personalDataConsent: true },
    "register",
  );
  const acceptance = currentUser(d, raw).legalAcceptance!;
  strict.equal(acceptance.termsVersion, LEGAL_VERSION);
  strict.equal(acceptance.personalDataVersion, LEGAL_VERSION);
  strict.ok(Date.parse(acceptance.termsAt) >= start);
  strict.ok(Date.parse(acceptance.personalDataAt) >= start);
  // Login does not create a second consent or require old accounts to fabricate one.
  const login = authenticate(d, input, "login");
  strict.deepEqual(currentUser(d, login).legalAcceptance, acceptance);
});

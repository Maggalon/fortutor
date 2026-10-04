"use client";
import { useState, useEffect } from "react";
import {
  ArrowUpRight,
  CalendarBlank,
  CheckCircle,
  Wallet,
  ArrowRight,
  GraduationCap,
} from "@phosphor-icons/react";
import { Field } from "./ui";
export async function request(url: string, body?: unknown) {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error([result.error, ...(result.details || [])].join(". "));
  return result;
}
export default function Auth({
  demo,
  onLogin,
}: {
  demo: boolean;
  onLogin: () => void;
}) {
  const [mode, setMode] = useState<"login" | "register" | "join">("login"),
    [invite, setInvite] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("invite");
    if (v) {
      setInvite(v);
      setMode("join");
    }
  }, []);
  async function login(data: unknown, path: string) {
    setBusy(true);
    setError("");
    try {
      await request(`/api/auth/${path}`, data);
      onLogin();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <section className="auth-story">
        <a className="brand" href="/">
          <span className="brand-mark">
            <GraduationCap size={24} weight="bold" />
          </span>
          for tutor<span className="brand-period">.</span>
        </a>
        <div className="auth-copy">
          <span className="eyebrow">ПРОСТРАНСТВО ПРЕПОДАВАТЕЛЯ</span>
          <h1>
            Больше внимания
            <br />
            ученикам.
          </h1>
          <p>
            Все, что нужно для занятий, в одном спокойном рабочем пространстве.
          </p>
          <div className="auth-features">
            <div>
              <CalendarBlank size={24} />
              <span>Расписание, которое всегда под рукой</span>
            </div>
            <div>
              <CheckCircle size={24} />
              <span>Домашние задания и понятная обратная связь</span>
            </div>
            <div>
              <Wallet size={24} />
              <span>Оплаты и отчеты для родителей</span>
            </div>
          </div>
        </div>
        <div className="auth-bottom">
          Ваши занятия. Ваш ритм.
          <ArrowUpRight size={20} />
        </div>
      </section>
      <section className="auth-form">
        <div className="auth-form-inner">
          <span className="eyebrow">FOR TUTOR</span>
          <h2>
            {mode === "join"
              ? "Добро пожаловать на занятия"
              : mode === "register"
                ? "Ваш новый кабинет"
                : "Рады видеть вас снова"}
          </h2>
          <p>
            {mode === "join"
              ? "Зарегистрируйтесь по приглашению преподавателя."
              : mode === "register"
                ? "14 дней бесплатно, без карты. Далее 1190 ₽ в месяц. Создайте аккаунт и пригласите первого ученика."
                : "Войдите, чтобы продолжить работу с учениками."}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              void login(
                {
                  email: fd.get("email"),
                  password: fd.get("password"),
                  name: fd.get("name") || undefined,
                  invite: invite || undefined,
                },
                mode,
              );
            }}
          >
            {mode !== "login" && (
              <Field label="Ваше имя">
                <input
                  name="name"
                  autoComplete="name"
                  required
                  minLength={2}
                  placeholder="Имя и фамилия"
                />
              </Field>
            )}
            <Field label="Email">
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="you@example.ru"
              />
            </Field>
            <Field label="Пароль" hint="Не менее 12 символов">
              <input
                name="password"
                type="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                required
                minLength={12}
              />
            </Field>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <button className="primary full" disabled={busy}>
              {busy
                ? "Подождите…"
                : mode === "login"
                  ? "Войти в кабинет"
                  : "Создать аккаунт"}
              <ArrowRight size={18} />
            </button>
          </form>
          {mode !== "join" && (
            <p className="auth-switch">
              {mode === "login" ? "Еще нет аккаунта?" : "Уже зарегистрированы?"}{" "}
              <button
                className="text-button"
                onClick={() => {
                  setMode(mode === "login" ? "register" : "login");
                  setError("");
                }}
              >
                {mode === "login" ? "Регистрация" : "Войти"}
              </button>
            </p>
          )}
          {demo && (
            <div className="demo-login">
              <span>Попробуйте на примере вымышленных данных</span>
              <div>
                <button
                  disabled={busy}
                  onClick={() => void login({ role: "teacher" }, "demo")}
                >
                  Кабинет преподавателя
                </button>
                <button
                  disabled={busy}
                  onClick={() => void login({ role: "student" }, "demo")}
                >
                  Кабинет ученика
                </button>
              </div>
            </div>
          )}
        </div>
        <span className="auth-foot">
          Учиться и преподавать становится проще.
        </span>
      </section>
    </div>
  );
}

"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  SquaresFour,
  CalendarBlank,
  Notebook,
  Users,
  Wallet,
  ChartLine,
  SlidersHorizontal,
  GraduationCap,
  MagnifyingGlass,
  Bell,
  ArrowRight,
  ArrowUpRight,
  CaretLeft,
  CaretRight,
  Plus,
  Check,
  Clock,
  PaperPlaneTilt,
  SignOut,
  Sun,
  Moon,
  CheckCircle,
  List,
  X,
  ArrowClockwise,
  WarningCircle,
} from "@phosphor-icons/react";
import type { Snapshot, Assignment, Student, Lesson } from "@/lib/types";
import {
  finance,
  rub,
  lessonLabel,
  submissionLabel,
  countRu,
} from "@/lib/shared";
import Auth, { request } from "./auth";
import SubscriptionPanel from "./subscription";
import LegalLinks from "./legal-links";
import { timezoneOptions } from "@/lib/timezones";
import {
  Avatar,
  Badge,
  CreateButton,
  Empty,
  SectionHead,
  Modal,
  FileLinks,
  MaxIcon,
  ChannelLabel,
} from "./ui";
import Forms, { type DialogState, dialogTitle, type Mutate } from "./forms";
type View =
  | "overview"
  | "schedule"
  | "homework"
  | "students"
  | "payments"
  | "reports"
  | "subscription"
  | "settings";
const nav = [
  { id: "overview", name: "Обзор", icon: SquaresFour },
  { id: "schedule", name: "Расписание", icon: CalendarBlank },
  { id: "homework", name: "Домашние задания", icon: Notebook },
  { id: "students", name: "Ученики", icon: Users },
  { id: "payments", name: "Оплаты", icon: Wallet },
  { id: "reports", name: "Отчеты", icon: ChartLine },
  { id: "subscription", name: "Подписка", icon: Wallet },
  { id: "settings", name: "Настройки", icon: SlidersHorizontal },
] as const;
const date = (
  value: string,
  options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" },
) => new Date(value).toLocaleDateString("ru-RU", options);
const time = (value: string) =>
  new Date(value).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
function monday(d: Date) {
  const n = new Date(d);
  n.setHours(0, 0, 0, 0);
  n.setDate(n.getDate() - ((n.getDay() + 6) % 7));
  return n;
}
export default function Platform({ demo }: { demo: boolean }) {
  const [s, setS] = useState<Snapshot | null>(null),
    [loading, setLoading] = useState(true),
    [view, setView] = useState<View>("overview"),
    [query, setQuery] = useState(""),
    [dialog, setDialog] = useState<DialogState | null>(null),
    [toast, setToast] = useState(""),
    [error, setError] = useState(""),
    [mobile, setMobile] = useState(false),
    [dark, setDark] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const refresh = useCallback(async () => {
    try {
      const data = await request("/api/state");
      setS(data);
      setError("");
    } catch (e) {
      if (
        (e as Error).message.includes("Войдите") ||
        (e as Error).message.includes("Сессия")
      )
        setS(null);
      else setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const update = () => {
      const v = window.location.hash.slice(1);
      if (nav.some((n) => n.id === v)) setView(v as View);
    };
    update();
    window.addEventListener("hashchange", update);
    const theme = localStorage.getItem("ft-theme");
    const isDark = theme
      ? theme === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
    setDark(isDark);
    document.documentElement.dataset.theme = isDark ? "dark" : "light";
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 30000);
    const shortcut = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => {
      window.removeEventListener("hashchange", update);
      window.removeEventListener("focus", focus);
      window.removeEventListener("keydown", shortcut);
      clearInterval(poll);
    };
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  const go = (id: View) => {
    setView(id);
    window.location.hash = id;
    setQuery("");
    setMobile(false);
  };
  const mutate: Mutate = async (body) => {
    const result = await request("/api/action", body);
    await refresh();
    setToast("Изменения сохранены");
    return result;
  };
  const run = async (body: unknown) => {
    try {
      return await mutate(body);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setToast("Скопировано");
    } catch {
      setError(
        "Копирование недоступно. Выделите значение и скопируйте вручную.",
      );
    }
  };
  const toggleTheme = () => {
    const value = !dark;
    setDark(value);
    document.documentElement.dataset.theme = value ? "dark" : "light";
    localStorage.setItem("ft-theme", value ? "dark" : "light");
  };
  if (loading)
    return (
      <main className="loading">
        <GraduationCap size={36} weight="duotone" />
        <span>Открываем ваше пространство…</span>
      </main>
    );
  if (!s)
    return (
      <>
        {error && (
          <div className="top-error" role="alert">
            {error}
            <button onClick={() => void refresh()}>Повторить</button>
          </div>
        )}
        <Auth demo={demo} onLogin={() => void refresh()} />
      </>
    );
  const teacher = s.user.role === "teacher",
    pending = s.submissions.filter((x) => x.status === "submitted"),
    match = (text: string) => text.toLowerCase().includes(query.toLowerCase());
  const props = { s, match, onDialog: setDialog, go, mutate: run };
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Перейти к содержимому
      </a>
      {mobile && (
        <button
          className="sidebar-overlay"
          aria-label="Закрыть меню"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <a className="brand" href="#overview" onClick={() => go("overview")}>
          <span className="brand-mark">
            <GraduationCap size={23} weight="bold" />
          </span>
          for tutor<span className="brand-period">.</span>
        </a>
        <div className="workspace-name">
          <span className="workspace-icon">{s.user.name.slice(0, 1)}</span>
          <div>
            <strong>Мой кабинет</strong>
            <small>{teacher ? "Преподаватель" : "Ученик"}</small>
          </div>
          <Check size={14} />
        </div>
        <span className="nav-caption">РАБОЧЕЕ ПРОСТРАНСТВО</span>
        <nav aria-label="Основная навигация">
          {nav
            .filter(
              (n) =>
                teacher ||
                !["students", "payments", "reports", "subscription"].includes(
                  n.id,
                ),
            )
            .map((n) => (
              <button
                key={n.id}
                onClick={() => go(n.id)}
                className={`nav-item ${view === n.id ? "active" : ""}`}
                aria-current={view === n.id ? "page" : undefined}
              >
                <n.icon size={21} weight={view === n.id ? "fill" : "regular"} />
                <span>{n.name}</span>
                {n.id === "homework" && pending.length > 0 && teacher && (
                  <span className="nav-count">{pending.length}</span>
                )}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          {!teacher && (
            <div className="bot-note">
              <PaperPlaneTilt size={21} weight="duotone" />
              <strong>Занятия на связи</strong>
              <p>
                Напоминания и отчеты
                <br />в Telegram и MAX.
              </p>
              <button className="text-button" onClick={() => go("settings")}>
                Настроить ботов
                <ArrowUpRight size={14} />
              </button>
            </div>
          )}
          <button className="user-card" onClick={() => go("settings")}>
            <Avatar name={s.user.name} />
            <div>
              <strong>{s.user.name}</strong>
              <small>
                {teacher ? "Частный преподаватель" : "Личный кабинет"}
              </small>
            </div>
            <SlidersHorizontal size={18} />
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-menu"
              aria-label="Открыть меню"
              onClick={() => setMobile(true)}
            >
              <List size={22} />
            </button>
            <span>Мой кабинет</span>
            <CaretRight size={13} />
            <strong>{nav.find((n) => n.id === view)?.name}</strong>
          </div>
          <div className="topbar-tools">
            <label className="search">
              <MagnifyingGlass size={17} />
              <input
                ref={search}
                placeholder="Поиск в разделе"
                aria-label="Поиск в разделе"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <kbd>⌘ K</kbd>
            </label>
            <button
              className="icon-button"
              aria-label={dark ? "Светлая тема" : "Темная тема"}
              onClick={toggleTheme}
            >
              {dark ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            <button
              className="icon-button notification-button"
              aria-label="Работы на проверке"
              onClick={() => go("homework")}
            >
              <Bell size={20} />
              {pending.length > 0 && teacher && <span />}
            </button>
            <Avatar name={s.user.name} size={32} />
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          {!s.demo && (
            <div className="demo-strip">
              <span>
                {s.subscription.status === "free"
                  ? "Бесплатный бессрочный доступ"
                  : s.subscription.status === "trial"
                    ? `Пробный период до ${date(s.subscription.trialEndsAt)} · далее 1190 ₽ в месяц`
                    : !s.subscription.canWrite
                      ? "Подписка закончилась · доступен просмотр данных"
                      : s.subscription.status === "grace"
                        ? "Необходимо продлить подписку · действует льготный период"
                        : `Подписка оплачена до ${date(s.subscription.paidUntil!)}`}
              </span>
              {teacher && (
                <button
                  className="text-button"
                  onClick={() => go("subscription")}
                >
                  Подписка <ArrowRight size={14} />
                </button>
              )}
            </div>
          )}
          {s.demo && (
            <div className="demo-strip">
              <span>
                Демонстрация · вымышленные данные сохраняются локально
              </span>
              <button
                className="text-button"
                onClick={async () => {
                  try {
                    await request("/api/auth/demo", {
                      role: teacher ? "student" : "teacher",
                    });
                    await refresh();
                    go("overview");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                {teacher ? "Кабинет ученика" : "Кабинет преподавателя"}
                <ArrowRight size={14} />
              </button>
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              <WarningCircle size={20} />
              <span>{error}</span>
              <button
                className="icon-button"
                aria-label="Закрыть ошибку"
                onClick={() => setError("")}
              >
                <X size={18} />
              </button>
            </div>
          )}
          {view === "overview" && <Overview {...props} />}
          {view === "schedule" && <Schedule {...props} />}
          {view === "homework" && <Homework {...props} />}
          {view === "students" && teacher && <Students {...props} />}
          {view === "payments" && teacher && <Payments {...props} />}
          {view === "reports" && teacher && <Reports {...props} />}
          {view === "subscription" && teacher && (
            <SubscriptionPanel initial={s.subscription} refresh={refresh} />
          )}
          {view === "settings" && (
            <Settings
              s={s}
              mutate={mutate}
              dark={dark}
              toggleTheme={toggleTheme}
              logout={async () => {
                await request("/api/auth/logout", {});
                setS(null);
                go("overview");
              }}
            />
          )}
        </main>
        <footer className="app-footer">
          <span>For Tutor</span>
          <LegalLinks compact />
          <span>
            Часовой пояс отображения:{" "}
            {Intl.DateTimeFormat().resolvedOptions().timeZone}
          </span>
        </footer>
      </div>
      {dialog && (
        <Modal
          key={`${dialog.type}-${dialog.id}`}
          title={dialogTitle[dialog.type]}
          onClose={() => setDialog(null)}
        >
          <Forms
            s={s}
            dialog={dialog}
            mutate={mutate}
            onClose={() => setDialog(null)}
            onDialog={setDialog}
            copy={(value) => void copy(value)}
          />
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle size={20} weight="fill" />
          {toast}
        </div>
      )}
    </div>
  );
}
interface ViewProps {
  s: Snapshot;
  match: (text: string) => boolean;
  onDialog: (dialog: DialogState) => void;
  go: (view: View) => void;
  mutate: (body: unknown) => Promise<Record<string, string> | undefined>;
}
function LessonRow({
  l,
  s,
  onClick,
}: {
  l: Lesson;
  s: Snapshot;
  onClick: () => void;
}) {
  return (
    <button className="lesson-row" onClick={onClick}>
      <div className="lesson-time">
        <strong>{time(l.start)}</strong>
        <small>{l.duration} мин</small>
      </div>
      <span className="lesson-stripe" />
      <div className="lesson-info">
        <strong>{l.subject}</strong>
        <span>
          {l.studentIds
            .map((id) => s.students.find((x) => x.id === id)?.name)
            .join(", ")}
        </span>
      </div>
      <Badge
        tone={
          l.status === "completed"
            ? "green"
            : l.status === "cancelled"
              ? "red"
              : "neutral"
        }
      >
        {lessonLabel[l.status]}
      </Badge>
      <ArrowUpRight size={18} />
    </button>
  );
}
function Overview({ s, onDialog, go, match }: ViewProps) {
  const teacher = s.user.role === "teacher",
    today = new Date();
  const upcoming = s.lessons
    .filter(
      (l) =>
        ["planned", "rescheduled"].includes(l.status) &&
        Date.parse(l.start) + l.duration * 60000 > Date.now(),
    )
    .sort((a, b) => a.start.localeCompare(b.start));
  const todayLessons = s.lessons
    .filter(
      (l) =>
        sameDay(new Date(l.start), today) &&
        l.status !== "cancelled" &&
        match(l.subject + " " + l.title),
    )
    .sort((a, b) => a.start.localeCompare(b.start));
  const pending = s.submissions.filter((x) => x.status === "submitted");
  const active = s.assignments.filter((a) => !a.archived);
  const outstanding = s.students.reduce(
    (n, student) => n + finance(s, student).debt,
    0,
  );
  const recent = s.submissions.filter((x) => x.status === "reviewed").slice(-5);
  const next = upcoming[0];
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {today.toLocaleDateString("ru-RU", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </span>
          <h1>
            {new Date().getHours() < 12
              ? "Доброе утро"
              : new Date().getHours() < 18
                ? "Добрый день"
                : "Добрый вечер"}
            , {s.user.name.split(" ")[0]}
            <span className="heading-dot">.</span>
          </h1>
          <p>
            {teacher
              ? "Все для ваших занятий. Без лишней суеты."
              : "Ваши занятия, задания и обратная связь преподавателя."}
          </p>
        </div>
        {teacher ? (
          <CreateButton onClick={() => onDialog({ type: "lesson" })}>
            Добавить занятие
          </CreateButton>
        ) : (
          <button className="primary" onClick={() => go("homework")}>
            Мои задания
            <ArrowRight size={18} />
          </button>
        )}
      </div>
      <div className="metrics">
        <div className="metric">
          <span>
            <CalendarBlank size={19} />
            Занятия сегодня
          </span>
          <strong>
            {todayLessons.length}
            <small>
              {todayLessons.filter((l) => l.status === "completed").length}{" "}
              проведено
            </small>
          </strong>
        </div>
        <div className="metric">
          <span>
            <Notebook size={19} />
            {teacher ? "Работы на проверке" : "Актуальные задания"}
          </span>
          <strong>
            {teacher ? pending.length : active.length}
            <small>
              {teacher ? "ждут вашего внимания" : "пора разобраться"}
            </small>
          </strong>
        </div>
        <div className="metric">
          <span>
            <Users size={19} />
            {teacher ? "Ваши ученики" : "Проверенные работы"}
          </span>
          <strong>
            {teacher
              ? s.students.length
              : s.submissions.filter((x) => x.status === "reviewed").length}
            <small>
              {teacher
                ? countRu(s.groups.length, [
                    "учебная группа",
                    "учебные группы",
                    "учебных групп",
                  ])
                : "с обратной связью"}
            </small>
          </strong>
        </div>
        <div className="metric">
          <span>
            <Wallet size={19} />
            {teacher ? "К оплате" : "Остаток занятий"}
          </span>
          <strong>
            {teacher
              ? rub(outstanding)
              : s.students[0]?.billing === "package"
                ? finance(s, s.students[0]).balance
                : rub(finance(s, s.students[0]).debt)}
            <small>
              {teacher
                ? "по проведенным занятиям"
                : s.students[0]?.billing === "package"
                  ? "в абонементе"
                  : "задолженность"}
            </small>
          </strong>
        </div>
      </div>
      <div className="overview-grid">
        <section className="panel day-panel">
          <SectionHead
            title="Расписание на сегодня"
            action={
              <button className="text-button" onClick={() => go("schedule")}>
                Весь календарь
                <ArrowUpRight size={15} />
              </button>
            }
          />
          <div className="day-date">
            <CalendarBlank size={18} />
            {today.toLocaleDateString("ru-RU", {
              day: "numeric",
              month: "long",
            })}
            <Badge>
              {countRu(todayLessons.length, ["занятие", "занятия", "занятий"])}
            </Badge>
          </div>
          {todayLessons.length ? (
            todayLessons.map((l) => (
              <LessonRow
                key={l.id}
                l={l}
                s={s}
                onClick={() => onDialog({ type: "lesson-detail", id: l.id })}
              />
            ))
          ) : (
            <Empty
              title="Сегодня свободный день"
              detail="Ближайшие занятия появятся в расписании."
              action={
                teacher ? (
                  <button onClick={() => onDialog({ type: "lesson" })}>
                    <Plus size={16} />
                    Добавить занятие
                  </button>
                ) : undefined
              }
            />
          )}
          <div className="panel-bottom">
            <Clock size={16} />
            <span>Напоминания ученикам за 24 часа и за 2 часа</span>
          </div>
        </section>
        <section className="panel review-panel">
          <SectionHead
            title={teacher ? "Ждут проверки" : "Ближайшие дедлайны"}
            action={
              <button
                className="text-button"
                onClick={() => go("homework")}
                aria-label="Все домашние задания"
              >
                <ArrowUpRight size={19} />
              </button>
            }
          />
          {teacher ? (
            pending.length ? (
              pending.slice(0, 4).map((work) => {
                const student = s.students.find((x) => x.id === work.studentId),
                  a = s.assignments.find((x) => x.id === work.assignmentId);
                return (
                  <button
                    key={work.id}
                    className="review-row"
                    onClick={() => onDialog({ type: "review", id: work.id })}
                  >
                    <Avatar name={student?.name || "Ученик"} />
                    <div>
                      <strong>{student?.name}</strong>
                      <span>{a?.title}</span>
                      <small>
                        {date(work.createdAt)} · {time(work.createdAt)}
                      </small>
                    </div>
                    <ArrowRight size={17} />
                  </button>
                );
              })
            ) : (
              <Empty
                title="Все работы проверены"
                detail="Новые решения появятся здесь."
              />
            )
          ) : active.length ? (
            active
              .sort((a, b) => a.deadline.localeCompare(b.deadline))
              .slice(0, 4)
              .map((a) => (
                <button
                  key={a.id}
                  className="review-row"
                  onClick={() => go("homework")}
                >
                  <Notebook size={23} />
                  <div>
                    <strong>{a.title}</strong>
                    <span>
                      До {date(a.deadline)} в {time(a.deadline)}
                    </span>
                  </div>
                  <ArrowRight size={17} />
                </button>
              ))
          ) : (
            <Empty title="Заданий пока нет" />
          )}
          <button className="panel-link" onClick={() => go("homework")}>
            {teacher ? "Перейти к домашним заданиям" : "Открыть мои задания"}
            <ArrowRight size={17} />
          </button>
        </section>
        <section className="panel week-preview">
          <SectionHead
            title="Ваша неделя"
            action={
              <button className="text-button" onClick={() => go("schedule")}>
                Открыть расписание
                <ArrowUpRight size={15} />
              </button>
            }
          />
          <div className="week-mini">
            {Array.from({ length: 7 }, (_, i) => {
              const d = monday(today);
              d.setDate(d.getDate() + i);
              const count = s.lessons.filter(
                (l) =>
                  sameDay(new Date(l.start), d) && l.status !== "cancelled",
              ).length;
              return (
                <button
                  key={i}
                  className={sameDay(d, today) ? "today" : ""}
                  onClick={() => go("schedule")}
                >
                  <small>
                    {d.toLocaleDateString("ru-RU", { weekday: "short" })}
                  </small>
                  <strong>{d.getDate()}</strong>
                  <span
                    aria-label={
                      count
                        ? countRu(count, ["занятие", "занятия", "занятий"])
                        : "Без занятий"
                    }
                  >
                    {count ? `${count} зан.` : "—"}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
        <section className="next-panel">
          <span className="eyebrow">БЛИЖАЙШЕЕ ЗАНЯТИЕ</span>
          {next ? (
            <>
              <div className="next-time">
                {time(next.start)}
                <span>{date(next.start)}</span>
              </div>
              <h3>{next.subject}</h3>
              <p>
                {next.studentIds
                  .map((id) => s.students.find((x) => x.id === id)?.name)
                  .join(", ")}
              </p>
              <button
                onClick={() => onDialog({ type: "lesson-detail", id: next.id })}
              >
                Подробнее о занятии
                <ArrowUpRight size={16} />
              </button>
            </>
          ) : (
            <>
              <h3>Место для новых планов</h3>
              <p>Добавьте занятие, чтобы начать неделю.</p>
              {teacher && (
                <button onClick={() => onDialog({ type: "lesson" })}>
                  Запланировать
                  <Plus size={16} />
                </button>
              )}
            </>
          )}
        </section>
      </div>
      {recent.length > 0 && (
        <section className="recent-section">
          <SectionHead
            title="Последние результаты"
            description="Небольшие шаги складываются в большой прогресс."
            action={
              <button className="text-button" onClick={() => go("homework")}>
                Все работы
                <ArrowRight size={15} />
              </button>
            }
          />
          <div className="recent-results">
            {recent.map((work) => {
              const a = s.assignments.find((x) => x.id === work.assignmentId);
              return (
                <div key={work.id}>
                  <Avatar
                    name={
                      s.students.find((x) => x.id === work.studentId)?.name ||
                      "Ученик"
                    }
                  />
                  <div>
                    <strong>{a?.title}</strong>
                    <span>
                      {s.students.find((x) => x.id === work.studentId)?.name}
                    </span>
                  </div>
                  <strong className="score">
                    {work.score}
                    <small>/{a?.maxScore}</small>
                  </strong>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}
function Schedule({ s, onDialog, match }: ViewProps) {
  const [week, setWeek] = useState(monday(new Date())),
    [layout, setLayout] = useState<"week" | "list">("week");
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(week);
    d.setDate(d.getDate() + i);
    return d;
  });
  const rows = s.lessons
    .filter(
      (l) =>
        new Date(l.start) >= week &&
        new Date(l.start) < new Date(week.getTime() + 7 * 86400000) &&
        match(
          l.subject +
            " " +
            l.title +
            " " +
            l.studentIds
              .map((id) => s.students.find((x) => x.id === id)?.name)
              .join(" "),
        ),
    )
    .sort((a, b) => a.start.localeCompare(b.start));
  const shift = (n: number) =>
    setWeek((old) => {
      const d = new Date(old);
      d.setDate(d.getDate() + n * 7);
      return d;
    });
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            Расписание<span className="heading-dot">.</span>
          </h1>
          <p>Занятия и свободное время в одном календаре.</p>
        </div>
        {s.user.role === "teacher" && (
          <CreateButton onClick={() => onDialog({ type: "lesson" })}>
            Добавить занятие
          </CreateButton>
        )}
      </div>
      <div className="calendar-toolbar">
        <div>
          <button
            className="icon-button"
            aria-label="Предыдущая неделя"
            onClick={() => shift(-1)}
          >
            <CaretLeft size={18} />
          </button>
          <strong>
            {date(days[0].toISOString())} –{" "}
            {date(days[6].toISOString(), {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </strong>
          <button
            className="icon-button"
            aria-label="Следующая неделя"
            onClick={() => shift(1)}
          >
            <CaretRight size={18} />
          </button>
          <button onClick={() => setWeek(monday(new Date()))}>Сегодня</button>
        </div>
        <div className="segmented">
          <button
            className={layout === "week" ? "selected" : ""}
            onClick={() => setLayout("week")}
          >
            Неделя
          </button>
          <button
            className={layout === "list" ? "selected" : ""}
            onClick={() => setLayout("list")}
          >
            Список
          </button>
        </div>
      </div>
      <div className={`calendar panel ${layout}`}>
        <div className="calendar-days">
          {days.map((d, i) => (
            <section key={i} className={sameDay(d, new Date()) ? "today" : ""}>
              <header>
                <span>
                  {d.toLocaleDateString("ru-RU", { weekday: "short" })}
                </span>
                <strong>{d.getDate()}</strong>
              </header>
              <div className="calendar-events">
                {rows
                  .filter((l) => sameDay(new Date(l.start), d))
                  .map((l) => (
                    <button
                      key={l.id}
                      className={`calendar-event ${l.status}`}
                      onClick={() =>
                        onDialog({ type: "lesson-detail", id: l.id })
                      }
                    >
                      <span>
                        {time(l.start)} <small>{l.duration} мин</small>
                      </span>
                      <strong>{l.subject}</strong>
                      <p>
                        {l.studentIds
                          .map(
                            (id) => s.students.find((x) => x.id === id)?.name,
                          )
                          .join(", ")}
                      </p>
                      <small>{lessonLabel[l.status]}</small>
                    </button>
                  ))}
                {!rows.some((l) => sameDay(new Date(l.start), d)) && (
                  <span className="no-events">Без занятий</span>
                )}
              </div>
            </section>
          ))}
        </div>
      </div>
      <p className="muted small">
        При переносе напоминания будут отправлены к новой дате. Отмененные уроки
        не списываются.
      </p>
    </>
  );
}
function Homework({ s, onDialog, match, mutate }: ViewProps) {
  const [filter, setFilter] = useState("active"),
    teacher = s.user.role === "teacher";
  const pending = s.submissions.filter((w) => w.status === "submitted");
  const filters = teacher
    ? [
        ["active", "Актуальные"],
        ["review", "На проверке"],
        ["reviewed", "Проверенные"],
        ["archive", "Архив"],
      ]
    : [
        ["active", "Актуальные"],
        ["review", "Отправленные"],
        ["reviewed", "Проверенные"],
        ["archive", "Архив"],
      ];
  const workRows = s.submissions
    .filter((w) =>
      filter === "review" ? w.status === "submitted" : w.status === "reviewed",
    )
    .filter((w) => {
      const a = s.assignments.find((x) => x.id === w.assignmentId);
      return match(
        (a?.title || "") +
          " " +
          (s.students.find((x) => x.id === w.studentId)?.name || ""),
      );
    });
  const assignments = s.assignments
    .filter((a) => (filter === "archive" ? a.archived : !a.archived))
    .filter((a) => match(a.title + " " + a.subject));
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            Домашние задания<span className="heading-dot">.</span>
          </h1>
          <p>
            {teacher
              ? "От условий задачи до обратной связи ученику."
              : "Все задания и результаты вашей работы."}
          </p>
        </div>
        {teacher && (
          <CreateButton onClick={() => onDialog({ type: "assignment" })}>
            Создать задание
          </CreateButton>
        )}
      </div>
      <div className="tabs">
        {filters.map(([key, label]) => (
          <button
            className={filter === key ? "active" : ""}
            key={key}
            onClick={() => setFilter(key)}
          >
            {label}
            {key === "review" && pending.length > 0 && (
              <span>{pending.length}</span>
            )}
          </button>
        ))}
      </div>
      {filter === "review" || filter === "reviewed" ? (
        <div className="panel work-list">
          {workRows.length ? (
            workRows.map((w) => {
              const a = s.assignments.find((x) => x.id === w.assignmentId)!;
              return (
                <article className="work-row" key={w.id}>
                  <div className="work-row-head">
                    <Avatar
                      name={
                        s.students.find((x) => x.id === w.studentId)?.name ||
                        s.user.name
                      }
                    />
                    <div>
                      <h3>{a.title}</h3>
                      <p>
                        {s.students.find((x) => x.id === w.studentId)?.name} ·{" "}
                        {date(w.createdAt)}
                      </p>
                    </div>
                    <Badge tone={w.status === "reviewed" ? "green" : "amber"}>
                      {submissionLabel[w.status]}
                    </Badge>
                    {teacher && w.status === "submitted" && (
                      <button
                        className="primary"
                        onClick={() => onDialog({ type: "review", id: w.id })}
                      >
                        Проверить
                        <ArrowRight size={16} />
                      </button>
                    )}
                  </div>
                  <p className="pre-wrap">{w.text}</p>
                  <FileLinks ids={w.fileIds} files={s.files} />
                  {w.status === "reviewed" && (
                    <div className="feedback">
                      <strong>
                        {w.score}/{a.maxScore}
                      </strong>
                      <p>{w.comment}</p>
                    </div>
                  )}
                </article>
              );
            })
          ) : (
            <Empty
              title={
                filter === "review"
                  ? "Отправленных работ пока нет"
                  : "Проверенных работ пока нет"
              }
              detail="Работы появятся здесь после отправки или проверки."
            />
          )}
        </div>
      ) : assignments.length ? (
        <div className="assignment-grid">
          {assignments.map((a) => {
            const works = s.submissions.filter((w) => w.assignmentId === a.id),
              own = works.find((w) => w.studentId === s.user.studentId),
              late = Date.parse(a.deadline) < Date.now();
            return (
              <article className="assignment-card" key={a.id}>
                <div className="assignment-meta">
                  <Badge tone="green">{a.subject}</Badge>
                  <span>{a.maxScore} баллов</span>
                </div>
                <h3>{a.title}</h3>
                <p className="assignment-text pre-wrap">{a.text}</p>
                {a.links.length > 0 && (
                  <div className="assignment-links">
                    {a.links.map((link) => (
                      <a
                        key={link}
                        href={link}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Материал
                        <ArrowUpRight size={14} />
                      </a>
                    ))}
                  </div>
                )}
                <FileLinks ids={a.fileIds} files={s.files} />
                <div className="deadline">
                  <Clock size={16} />
                  <span>
                    До {date(a.deadline)} в {time(a.deadline)}
                  </span>
                  {late && !a.archived && <Badge tone="red">Срок прошел</Badge>}
                </div>
                {teacher ? (
                  <div className="assignment-footer">
                    <span>
                      {works.length} из {a.studentIds.length} сдали
                    </span>
                    <button
                      className="text-button"
                      onClick={() =>
                        void mutate({
                          action: "assignment.archive",
                          id: a.id,
                          archived: !a.archived,
                        })
                      }
                    >
                      {a.archived ? "Вернуть" : "В архив"}
                      <ArrowRight size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="assignment-footer">
                    {own && (
                      <Badge
                        tone={own.status === "reviewed" ? "green" : "amber"}
                      >
                        {submissionLabel[own.status]}
                        {own.status === "reviewed"
                          ? ` · ${own.score}/${a.maxScore}`
                          : ""}
                      </Badge>
                    )}
                    {!a.archived && (!own || own.status === "revision") && (
                      <button
                        className="primary"
                        onClick={() => onDialog({ type: "submit", id: a.id })}
                      >
                        {own ? "Отправить повторно" : "Сдать задание"}
                        <ArrowRight size={16} />
                      </button>
                    )}
                    {own?.comment && (
                      <p className="feedback-text">{own.comment}</p>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <Empty
          title="Заданий пока нет"
          detail={
            teacher
              ? "Создайте первое задание и назначьте ученикам."
              : "Преподаватель добавит задания здесь."
          }
          action={
            teacher ? (
              <CreateButton onClick={() => onDialog({ type: "assignment" })}>
                Создать задание
              </CreateButton>
            ) : undefined
          }
        />
      )}
    </>
  );
}
function Students({ s, onDialog, match }: ViewProps) {
  const [filter, setFilter] = useState("all");
  const list = s.students.filter(
    (student) =>
      match(student.name + " " + student.subject) &&
      (filter === "all" ||
        s.groups.find((g) => g.id === filter)?.studentIds.includes(student.id)),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            Ученики<span className="heading-dot">.</span>
          </h1>
          <p>Люди, которым вы помогаете двигаться вперед.</p>
        </div>
        <div className="heading-actions">
          <button onClick={() => onDialog({ type: "group" })}>
            <Users size={18} />
            Создать группу
          </button>
          <CreateButton onClick={() => onDialog({ type: "student" })}>
            Добавить ученика
          </CreateButton>
        </div>
      </div>
      <div className="group-filter">
        <button
          className={filter === "all" ? "selected" : ""}
          onClick={() => setFilter("all")}
        >
          Все ученики <span>{s.students.length}</span>
        </button>
        {s.groups.map((g) => (
          <div key={g.id}>
            <button
              className={filter === g.id ? "selected" : ""}
              onClick={() => setFilter(g.id)}
            >
              {g.name}
              <span>{g.studentIds.length}</span>
            </button>
            <button
              className="icon-button"
              aria-label={`Редактировать группу ${g.name}`}
              onClick={() => onDialog({ type: "group", id: g.id })}
            >
              <SlidersHorizontal size={15} />
            </button>
          </div>
        ))}
      </div>
      <div className="panel table-panel">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Ученик</th>
                <th>Предмет</th>
                <th>Оплата</th>
                <th>Баланс</th>
                <th>Мессенджеры</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((student) => {
                const f = finance(s, student),
                  bindings = s.bindings.filter(
                    (b) => b.studentId === student.id,
                  );
                return (
                  <tr key={student.id}>
                    <td>
                      <button
                        className="person"
                        onClick={() =>
                          onDialog({ type: "student-detail", id: student.id })
                        }
                      >
                        <Avatar name={student.name} />
                        <span>
                          <strong>{student.name}</strong>
                          <small>{student.grade || "Уровень не указан"}</small>
                        </span>
                      </button>
                    </td>
                    <td>{student.subject}</td>
                    <td>
                      {student.billing === "package" ? "Абонемент" : "Поурочно"}
                      <small className="cell-sub">
                        {rub(student.rate)} / занятие
                      </small>
                    </td>
                    <td>
                      <Badge
                        tone={f.debt || f.balance === 1 ? "amber" : "green"}
                      >
                        {student.billing === "package"
                          ? countRu(f.balance, [
                              "занятие",
                              "занятия",
                              "занятий",
                            ])
                          : f.debt
                            ? rub(f.debt)
                            : "Оплачено"}
                      </Badge>
                    </td>
                    <td>
                      {bindings.length ? (
                        <div className="channel-tags">
                          {[...new Set(bindings.map((b) => b.channel))].map(
                            (c) => (
                              <Badge key={c}>
                                <ChannelLabel channel={c} />
                              </Badge>
                            ),
                          )}
                        </div>
                      ) : (
                        <span className="muted">Не подключены</span>
                      )}
                    </td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`Открыть карточку ${student.name}`}
                        onClick={() =>
                          onDialog({ type: "student-detail", id: student.id })
                        }
                      >
                        <ArrowUpRight size={19} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!list.length && (
          <Empty
            title="Ученики не найдены"
            detail="Добавьте ученика или измените поиск."
          />
        )}
      </div>
      <p className="muted small">
        Приглашения и код родителя находятся в карточке ученика.
      </p>
    </>
  );
}
function Payments({ s, onDialog, match }: ViewProps) {
  const totals = s.students.map((student) => ({
    student,
    ...finance(s, student),
  }));
  const total = s.payments.reduce((n, p) => n + p.amount, 0);
  const debt = totals.reduce((n, f) => n + f.debt, 0);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            Оплаты<span className="heading-dot">.</span>
          </h1>
          <p>Понятный баланс и история каждого платежа.</p>
        </div>
        <CreateButton onClick={() => onDialog({ type: "payment" })}>
          Зафиксировать оплату
        </CreateButton>
      </div>
      <div className="payment-summary">
        <div>
          <span>Получено за все время</span>
          <strong>{rub(total)}</strong>
        </div>
        <div>
          <span>Задолженность</span>
          <strong>{rub(debt)}</strong>
        </div>
        <div>
          <span>Абонементы к пополнению</span>
          <strong>
            {
              totals.filter(
                (x) => x.student.billing === "package" && x.balance <= 1,
              ).length
            }
            <small>учеников</small>
          </strong>
        </div>
      </div>
      <SectionHead title="Баланс учеников" />
      <div className="panel table-panel">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Ученик</th>
                <th>Схема оплаты</th>
                <th>Остаток</th>
                <th>Задолженность</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {totals
                .filter((f) => match(f.student.name))
                .map((f) => (
                  <tr key={f.student.id}>
                    <td>
                      <div className="person">
                        <Avatar name={f.student.name} />
                        <strong>{f.student.name}</strong>
                      </div>
                    </td>
                    <td>
                      {f.student.billing === "package"
                        ? `Пакет ${f.student.packageSize} занятий`
                        : "Поурочно"}
                    </td>
                    <td>
                      {f.student.billing === "package" ? (
                        <Badge tone={f.balance <= 1 ? "amber" : "green"}>
                          {f.balance} занятий
                        </Badge>
                      ) : (
                        "По проведенным урокам"
                      )}
                    </td>
                    <td>
                      {f.debt ? (
                        <strong className="debt">{rub(f.debt)}</strong>
                      ) : (
                        <span className="muted">Нет долга</span>
                      )}
                    </td>
                    <td>
                      <button
                        onClick={() =>
                          onDialog({ type: "payment", id: f.student.id })
                        }
                      >
                        <Plus size={15} />
                        Оплата
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
      <section className="payment-history">
        <SectionHead title="История платежей" />
        {s.payments.length ? (
          <div className="panel table-panel">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Ученик</th>
                    <th>Сумма</th>
                    <th>Назначение</th>
                  </tr>
                </thead>
                <tbody>
                  {[...s.payments]
                    .reverse()
                    .filter((p) =>
                      match(
                        s.students.find((x) => x.id === p.studentId)?.name ||
                          "",
                      ),
                    )
                    .map((p) => (
                      <tr key={p.id}>
                        <td>{date(p.createdAt)}</td>
                        <td>
                          {s.students.find((x) => x.id === p.studentId)?.name}
                        </td>
                        <td>
                          <strong>{rub(p.amount)}</strong>
                        </td>
                        <td>
                          {p.lessons
                            ? `Пополнение на ${p.lessons} занятий`
                            : `Оплата ${p.lessonIds.length} занятий`}
                          <small className="cell-sub">{p.note}</small>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="panel">
            <Empty
              title="Здесь будет история оплат"
              detail="Фиксируйте платеж после получения перевода от родителя."
            />
          </div>
        )}
      </section>
    </>
  );
}
function Reports({ s, onDialog, match, mutate }: ViewProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const report = s.reports.find((r) => r.id === selected);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            Отчеты для родителей<span className="heading-dot">.</span>
          </h1>
          <p>Посещения, результаты и следующий шаг простыми словами.</p>
        </div>
        <CreateButton onClick={() => onDialog({ type: "report" })}>
          Сформировать отчет
        </CreateButton>
      </div>
      <div className="panel">
        {s.reports.length ? (
          s.reports
            .filter((r) =>
              match(s.students.find((x) => x.id === r.studentId)?.name || ""),
            )
            .slice()
            .reverse()
            .map((r) => (
              <div className="report-row" key={r.id}>
                <Avatar
                  name={
                    s.students.find((x) => x.id === r.studentId)?.name ||
                    "Ученик"
                  }
                />
                <div>
                  <strong>
                    {s.students.find((x) => x.id === r.studentId)?.name}
                  </strong>
                  <span>
                    {date(r.from)} – {date(r.to)}
                  </span>
                  {r.error && <small className="debt">{r.error}</small>}
                </div>
                <Badge
                  tone={
                    r.status === "ready"
                      ? "green"
                      : r.status === "failed"
                        ? "red"
                        : "amber"
                  }
                >
                  {r.status === "ready"
                    ? "Готов"
                    : r.status === "failed"
                      ? "Ошибка"
                      : "Формируется"}
                </Badge>
                {r.status === "ready" && (
                  <button onClick={() => setSelected(r.id)}>
                    Прочитать
                    <ArrowUpRight size={16} />
                  </button>
                )}
                {r.status === "failed" && (
                  <button
                    onClick={() =>
                      void mutate({ action: "job.retry", id: `report-${r.id}` })
                    }
                  >
                    Повторить
                  </button>
                )}
              </div>
            ))
        ) : (
          <Empty
            title="Первый отчет еще впереди"
            detail="Выберите ученика и период. Для информативного отчета сначала проверьте несколько работ."
            action={
              <CreateButton onClick={() => onDialog({ type: "report" })}>
                Сформировать отчет
              </CreateButton>
            }
          />
        )}
      </div>
      <SectionHead
        title="Готовность к отправке"
        description="Родители получают отчеты в том мессенджере, который подключили."
      />
      <div className="parent-ready">
        {s.students
          .filter((x) => match(x.name))
          .map((student) => {
            const channels = s.bindings.filter(
              (b) => b.studentId === student.id && b.role === "parent",
            );
            return (
              <div key={student.id}>
                <Avatar name={student.name} />
                <span>{student.name}</span>
                <Badge tone={channels.length ? "green" : "neutral"}>
                  {channels.length
                    ? [...new Set(channels.map((c) => c.channel))].map(
                        (channel) => (
                          <ChannelLabel key={channel} channel={channel} />
                        ),
                      )
                    : "Родитель не подключен"}
                </Badge>
              </div>
            );
          })}
      </div>
      {report && (
        <Modal title="Отчет для родителя" onClose={() => setSelected(null)}>
          <p className="muted">
            {s.students.find((x) => x.id === report.studentId)?.name} ·{" "}
            {date(report.from)} – {date(report.to)}
          </p>
          <div className="report-text pre-wrap">{report.text}</div>
        </Modal>
      )}
    </>
  );
}
function Settings({
  s,
  mutate,
  dark,
  toggleTheme,
  logout,
}: {
  s: Snapshot;
  mutate: Mutate;
  dark: boolean;
  toggleTheme: () => void;
  logout: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [botConnection, setBotConnection] = useState<{
    channel: "telegram" | "max";
    url: string;
    appUrl?: string;
    username?: string;
    code: string;
  } | null>(null);
  const teacher = s.user.role === "teacher";
  useEffect(() => {
    if (
      botConnection &&
      s.bindings.some(
        (b) => b.channel === botConnection.channel && b.role === "student",
      )
    ) {
      setBotConnection(null);
    }
  }, [s.bindings, botConnection]);
  async function save(body: unknown) {
    setBusy(true);
    setError("");
    try {
      await mutate(body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function link(channel: "telegram" | "max") {
    setBusy(true);
    setError("");
    try {
      const r = await mutate({ action: "bot.link", channel });
      setBotConnection({
        channel,
        url: r.url,
        appUrl: r.appUrl,
        username: r.username,
        code: r.code,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            Настройки<span className="heading-dot">.</span>
          </h1>
          <p>Ваш кабинет, реквизиты и связь с учениками.</p>
        </div>
      </div>
      <div
        className={`settings-layout${teacher ? " settings-layout-teacher" : ""}`}
      >
        <div>
          <form
            className="panel settings-panel"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              void save({
                action: "settings.save",
                name: fd.get("name"),
                paymentDetails: fd.get("paymentDetails"),
                timezone: fd.get("timezone"),
                reportDays: Number(fd.get("reportDays")),
              });
            }}
          >
            <SectionHead title="Профиль" />
            <div className="profile-inline">
              <Avatar name={s.user.name} size={54} />
              <div>
                <strong>{s.user.name}</strong>
                <span>{s.user.email}</span>
              </div>
            </div>
            {teacher && (
              <>
                <label className="field">
                  <span>Имя и фамилия</span>
                  <input name="name" defaultValue={s.user.name} required />
                </label>
                <label className="field">
                  <span>Реквизиты для оплаты</span>
                  <textarea
                    name="paymentDetails"
                    rows={3}
                    defaultValue={s.user.paymentDetails}
                    placeholder="Телефон для СБП, банк и имя получателя"
                  />
                  <small>Автоматически добавляются в сообщения родителю.</small>
                </label>
                <label className="field">
                  <span>Часовой пояс уведомлений</span>
                  <select
                    name="timezone"
                    required
                    defaultValue={s.user.timezone}
                  >
                    {timezoneOptions(s.user.timezone).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <small>
                    Выберите смещение относительно UTC, например UTC+3 для
                    Москвы. Уведомления и еженедельные повторы используют этот
                    пояс. Время в календаре отображается в поясе браузера.
                  </small>
                </label>
                <label className="field">
                  <span>Периодичность ИИ-отчетов</span>
                  <select name="reportDays" defaultValue={s.user.reportDays}>
                    <option value="0">Только вручную</option>
                    <option value="14">Раз в 2 недели</option>
                    <option value="30">Раз в месяц (30 дней)</option>
                  </select>
                </label>
                <button className="primary" disabled={busy}>
                  {busy ? "Сохранение…" : "Сохранить настройки"}
                  <Check size={16} />
                </button>
              </>
            )}
          </form>
        </div>
        <div className="settings-stack">
          <div className="panel appearance-panel">
            <SectionHead title="Оформление" />
            <div>
              <span>{dark ? "Темная тема" : "Светлая тема"}</span>
              <button onClick={toggleTheme}>
                {dark ? <Sun size={18} /> : <Moon size={18} />}Сменить тему
              </button>
            </div>
          </div>
          {!teacher && (
            <section className="panel settings-panel">
              <SectionHead title="Мессенджеры" />
              <p className="muted">
                Получайте напоминания и сдавайте работы прямо в боте.
              </p>
              {botConnection && (
                <Modal
                  title={`Подключение ${botConnection.channel === "telegram" ? "Telegram" : "MAX"}`}
                  onClose={() => setBotConnection(null)}
                >
                  <div className="bot-connection">
                    <p>
                      Откройте бота и нажмите «Начать» / Start. После
                      подтверждения привязки бот появится в настройках как
                      подключенный.
                    </p>
                    <div className="bot-connection-actions">
                      {botConnection.appUrl && (
                        <a className="primary" href={botConnection.appUrl}>
                          Открыть в приложении Telegram{" "}
                          <ArrowUpRight size={16} />
                        </a>
                      )}
                      <a
                        href={botConnection.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {botConnection.channel === "telegram"
                          ? "Открыть через t.me"
                          : "Открыть MAX"}{" "}
                        <ArrowUpRight size={16} />
                      </a>
                    </div>
                    <p>
                      Если ссылка не открывается
                      {botConnection.username
                        ? `, найдите ${botConnection.username} в Telegram`
                        : ", откройте чат с ботом MAX"}{" "}
                      и отправьте эту команду:
                    </p>
                    <label>
                      <span className="muted">
                        Команда подключения — нажмите, чтобы выделить
                      </span>
                      <input
                        aria-label="Команда подключения"
                        readOnly
                        value={`/start ${botConnection.code}`}
                        onFocus={(e) => e.currentTarget.select()}
                      />
                    </label>
                    <small className="muted">
                      Код действует 15 минут и используется один раз. Если срок
                      истек, закройте окно и нажмите «Подключить» снова.
                    </small>
                  </div>
                </Modal>
              )}
              {(["telegram", "max"] as const).map((channel) => {
                const binding = s.bindings.find(
                  (b) => b.channel === channel && b.role === "student",
                );
                return (
                  <div className="integration-row" key={channel}>
                    <div className="integration-icon">
                      {channel === "max" ? (
                        <MaxIcon size={22} />
                      ) : (
                        <PaperPlaneTilt size={22} />
                      )}
                    </div>
                    <div>
                      <strong>
                        {channel === "telegram" ? "Telegram" : "MAX"}
                      </strong>
                      <span>
                        {binding
                          ? "Подключен к вашему аккаунту"
                          : "Напоминания о занятиях и ДЗ"}
                      </span>
                    </div>
                    {binding ? (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void save({ action: "bot.unlink", id: binding.id })
                        }
                      >
                        Отключить
                      </button>
                    ) : (
                      <button
                        disabled={busy || !s.integrations[channel]}
                        onClick={() => void link(channel)}
                      >
                        Подключить
                        <ArrowUpRight size={15} />
                      </button>
                    )}
                  </div>
                );
              })}
            </section>
          )}
          {teacher && s.jobs.some((j) => j.status === "failed") && (
            <section className="panel settings-panel">
              <SectionHead title="Неуспешные задачи" />
              {s.jobs
                .filter((j) => j.status === "failed")
                .map((j) => (
                  <div className="failed-job" key={j.id}>
                    <p>
                      {j.kind === "report"
                        ? "Генерация отчета"
                        : j.kind === "bot"
                          ? "Обработка сообщения"
                          : "Доставка уведомления"}
                    </p>
                    <small>{j.error}</small>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void save({ action: "job.retry", id: j.id })
                      }
                    >
                      <ArrowClockwise size={15} />
                      Повторить
                    </button>
                  </div>
                ))}
            </section>
          )}
          <button className="logout-button" onClick={() => void logout()}>
            <SignOut size={18} />
            Выйти из аккаунта
          </button>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

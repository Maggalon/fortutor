"use client";
import { useState } from "react";
import { UploadSimple, ArrowRight, Plus } from "@phosphor-icons/react";
import type { Snapshot, Student } from "@/lib/types";
import { finance, rub, lessonLabel } from "@/lib/shared";
import { Field, FileLinks, CopyValue, Avatar, Badge, ChannelLabel } from "./ui";
export type DialogState = {
  type:
    | "student"
    | "student-edit"
    | "student-detail"
    | "group"
    | "lesson"
    | "lesson-detail"
    | "assignment"
    | "review"
    | "submit"
    | "payment"
    | "report";
  id?: string;
};
export const dialogTitle: Record<DialogState["type"], string> = {
  student: "Новый ученик",
  "student-edit": "Редактировать ученика",
  "student-detail": "Карточка ученика",
  group: "Учебная группа",
  lesson: "Новое занятие",
  "lesson-detail": "Занятие",
  assignment: "Новое домашнее задание",
  review: "Проверка работы",
  submit: "Сдать домашнее задание",
  payment: "Зафиксировать оплату",
  report: "Отчет для родителя",
};
export type Mutate = (body: unknown) => Promise<Record<string, string>>;
const localInput = (date: Date) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
export function StudentsPick({
  s,
  selected = [],
}: {
  s: Snapshot;
  selected?: string[];
}) {
  const [chosen, setChosen] = useState(new Set(selected));
  const toggle = (ids: string[]) =>
    setChosen((old) => {
      const next = new Set(old),
        all = ids.every((id) => next.has(id));
      ids.forEach((id) => (all ? next.delete(id) : next.add(id)));
      return next;
    });
  return (
    <div className="field">
      <span>Назначить ученикам</span>
      {s.groups.length > 0 && (
        <div className="group-picks">
          {s.groups.map((g) => (
            <button
              type="button"
              key={g.id}
              className={
                g.studentIds.every((id) => chosen.has(id)) ? "selected" : ""
              }
              onClick={() => toggle(g.studentIds)}
            >
              <Plus size={14} />
              {g.name}
            </button>
          ))}
        </div>
      )}
      <div className="student-picks">
        {s.students.map((student) => (
          <label key={student.id}>
            <input
              type="checkbox"
              name="studentIds"
              value={student.id}
              checked={chosen.has(student.id)}
              onChange={() => toggle([student.id])}
            />
            <Avatar name={student.name} size={28} />
            {student.name}
          </label>
        ))}
        {!s.students.length && (
          <p>Сначала добавьте ученика в разделе «Ученики».</p>
        )}
      </div>
    </div>
  );
}
function FilesUpload({
  onFiles,
  demo,
  onBusy,
}: {
  onFiles: (ids: string[]) => void;
  demo: boolean;
  onBusy: (value: boolean) => void;
}) {
  const [files, setFiles] = useState<{ id: string; name: string }[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function upload(list: FileList | null) {
    if (!list) return;
    setBusy(true);
    onBusy(true);
    setError("");
    const next = [...files];
    try {
      if (next.length + list.length > 10) throw new Error("Не более 10 файлов");
      for (const file of Array.from(list)) {
        if (file.size > 20 * 1024 * 1024)
          throw new Error("Файл должен быть не больше 20 МБ");
        let data: { id: string; name: string };
        if (demo) {
          const fd = new FormData();
          fd.append("file", file);
          const r = await fetch("/api/files", { method: "POST", body: fd });
          data = await r.json();
          if (!r.ok) throw new Error((data as { error?: string }).error);
        } else {
          const r = await fetch("/api/files/presign", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: file.name,
              mime: file.type,
              size: file.size,
            }),
          });
          const start = await r.json();
          if (!r.ok) throw new Error(start.error);
          const put = await fetch(start.url, {
            method: "PUT",
            headers: { "Content-Type": file.type },
            body: file,
          });
          if (!put.ok)
            throw new Error("Не удалось загрузить файл в S3. Проверьте CORS.");
          const finish = await fetch("/api/files/complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: start.id }),
          });
          data = await finish.json();
          if (!finish.ok) throw new Error((data as { error?: string }).error);
        }
        next.push(data);
      }
      setFiles(next);
      onFiles(next.map((f) => f.id));
    } catch (e) {
      setFiles(next);
      onFiles(next.map((f) => f.id));
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <div className="field">
      <span>Вложения</span>
      <label className="upload">
        <UploadSimple size={24} />
        <span>{busy ? "Загрузка…" : "Выберите фото или документ"}</span>
        <small>JPG, PNG, PDF · до 20 МБ</small>
        <input
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          multiple
          disabled={busy}
          onChange={(e) => void upload(e.target.files)}
        />
      </label>
      {files.map((f) => (
        <div key={f.id} className="uploaded">
          {f.name}
          <button
            type="button"
            className="text-button"
            onClick={() => {
              const next = files.filter((x) => x.id !== f.id);
              setFiles(next);
              onFiles(next.map((x) => x.id));
            }}
          >
            Убрать
          </button>
        </div>
      ))}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
export default function Forms({
  s,
  dialog,
  mutate,
  onClose,
  onDialog,
  copy,
}: {
  s: Snapshot;
  dialog: DialogState;
  mutate: Mutate;
  onClose: () => void;
  onDialog: (d: DialogState) => void;
  copy: (value: string) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [fileIds, setFileIds] = useState<string[]>([]),
    [uploading, setUploading] = useState(false),
    [result, setResult] = useState(""),
    [selectedStudent, setSelectedStudent] = useState(
      dialog.id || s.students[0]?.id || "",
    );
  const student = s.students.find((x) => x.id === dialog.id);
  const lesson = s.lessons.find((x) => x.id === dialog.id);
  const submission = s.submissions.find((x) => x.id === dialog.id);
  const assignment = s.assignments.find(
    (x) =>
      x.id ===
      (dialog.type === "review" ? submission?.assignmentId : dialog.id),
  );
  const group = s.groups.find((x) => x.id === dialog.id);
  const paymentStudent = s.students.find((x) => x.id === selectedStudent);
  const funds = paymentStudent ? finance(s, paymentStudent) : undefined;
  async function perform(body: unknown, close = true) {
    setBusy(true);
    setError("");
    try {
      const response = await mutate(body);
      if (close) onClose();
      else if (response.url || response.code)
        setResult(response.url || response.code);
      return response;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (dialog.type === "student-detail" && student) {
    const f = finance(s, student);
    return (
      <div className="student-detail">
        <div className="detail-identity">
          <Avatar name={student.name} size={64} />
          <div>
            <h3>{student.name}</h3>
            <p>
              {student.grade} · {student.subject}
            </p>
          </div>
          <button
            className="text-button"
            onClick={() => onDialog({ type: "student-edit", id: student.id })}
          >
            Изменить
          </button>
        </div>
        <div className="detail-metrics">
          <div>
            <small>
              {student.billing === "package"
                ? "Осталось занятий"
                : "Задолженность"}
            </small>
            <strong>
              {student.billing === "package" ? f.balance : rub(f.debt)}
            </strong>
          </div>
          <div>
            <small>Стоимость занятия</small>
            <strong>{rub(student.rate)}</strong>
          </div>
        </div>
        <h4>Доступ ученика</h4>
        <p className="muted">
          Ссылка действует 7 дней и используется один раз.
        </p>
        <button
          disabled={busy}
          onClick={() =>
            void perform({ action: "student.invite", id: student.id }, false)
          }
        >
          Создать приглашение
          <ArrowRight size={16} />
        </button>
        {result && <CopyValue value={result} onCopy={copy} />}
        <h4>Подключение родителя</h4>
        <p className="muted">
          Передайте код родителю. Он отправит его боту Telegram или MAX.
        </p>
        <CopyValue value={student.parentCode} onCopy={copy} />
        <button
          className="text-button"
          disabled={busy}
          onClick={() =>
            void perform(
              { action: "student.parent-code", id: student.id },
              false,
            )
          }
        >
          Выпустить новый код
        </button>
        <h4>Подключенные каналы</h4>
        {s.bindings
          .filter((b) => b.studentId === student.id)
          .map((b) => (
            <div className="binding" key={b.id}>
              <Badge tone="green">
                <ChannelLabel channel={b.channel} />
              </Badge>
              <span>{b.role === "parent" ? "Родитель" : "Ученик"}</span>
              <button
                className="text-button"
                onClick={() =>
                  void perform({ action: "bot.unlink", id: b.id }, false)
                }
              >
                Отключить
              </button>
            </div>
          ))}
        {!s.bindings.some((b) => b.studentId === student.id) && (
          <p className="muted">Мессенджеры пока не подключены.</p>
        )}
        {student.note && (
          <>
            <h4>Заметка преподавателя</h4>
            <p className="pre-wrap">{student.note}</p>
          </>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </div>
    );
  }
  const submitForm = (form: HTMLFormElement) => {
    const fd = new FormData(form),
      value = (key: string) => String(fd.get(key) || ""),
      num = (key: string) => Number(fd.get(key)),
      list = (key: string) => fd.getAll(key).map(String);
    let body: unknown;
    switch (dialog.type) {
      case "student":
      case "student-edit":
        body = {
          action:
            dialog.type === "student" ? "student.create" : "student.update",
          id: student?.id,
          name: value("name"),
          email: value("email"),
          subject: value("subject"),
          grade: value("grade"),
          billing: value("billing"),
          rate: num("rate"),
          packageSize: num("packageSize"),
          initialBalance: num("initialBalance"),
          note: value("note"),
        };
        break;
      case "group":
        body = {
          action: "group.save",
          id: dialog.id,
          name: value("name"),
          studentIds: list("studentIds"),
        };
        break;
      case "lesson":
        body = {
          action: "lesson.create",
          title: value("title"),
          subject: value("subject"),
          studentIds: list("studentIds"),
          start: new Date(value("start")).toISOString(),
          duration: num("duration"),
          weeks: num("weeks"),
          location: value("location"),
        };
        break;
      case "lesson-detail":
        body = {
          action: "lesson.status",
          id: dialog.id,
          status: value("status"),
          start: value("start")
            ? new Date(value("start")).toISOString()
            : undefined,
          attendance: Object.fromEntries(
            (lesson?.studentIds || []).map((id) => [
              id,
              list("attendance").includes(id),
            ]),
          ),
        };
        break;
      case "assignment":
        body = {
          action: "assignment.create",
          title: value("title"),
          subject: value("subject"),
          text: value("text"),
          studentIds: list("studentIds"),
          fileIds,
          links: value("links")
            .split("\n")
            .map((x) => x.trim())
            .filter(Boolean),
          deadline: new Date(value("deadline")).toISOString(),
          maxScore: num("maxScore"),
        };
        break;
      case "review":
        body = {
          action: "submission.review",
          id: dialog.id,
          status: value("status"),
          score: value("score") ? num("score") : undefined,
          comment: value("comment"),
        };
        break;
      case "submit":
        body = {
          action: "submission.send",
          assignmentId: dialog.id,
          text: value("text"),
          fileIds,
        };
        break;
      case "payment":
        body = {
          action: "payment.create",
          studentId: selectedStudent,
          amount: num("amount"),
          lessons: paymentStudent?.billing === "package" ? num("lessons") : 0,
          lessonIds:
            paymentStudent?.billing === "lesson" ? list("lessonIds") : [],
          note: value("note"),
        };
        break;
      case "report":
        body = {
          action: "report.create",
          studentId: value("studentId"),
          from: new Date(value("from") + "T00:00:00").toISOString(),
          to: new Date(value("to") + "T23:59:59").toISOString(),
        };
        break;
    }
    void perform(body);
  };
  const base =
    student ||
    ({
      name: "",
      email: "",
      grade: "",
      subject: "Математика",
      billing: "package",
      rate: 1800,
      packageSize: 8,
      initialBalance: 0,
      note: "",
    } as Student);
  return (
    <form
      className="editor-form"
      onSubmit={(e) => {
        e.preventDefault();
        try {
          submitForm(e.currentTarget);
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      {(dialog.type === "student" || dialog.type === "student-edit") && (
        <>
          <Field label="Имя и фамилия">
            <input
              name="name"
              required
              defaultValue={base.name}
              placeholder="Александра Волкова"
            />
          </Field>
          <div className="form-grid">
            <Field label="Предмет">
              <input name="subject" required defaultValue={base.subject} />
            </Field>
            <Field label="Класс или уровень">
              <input
                name="grade"
                defaultValue={base.grade}
                placeholder="11 класс"
              />
            </Field>
          </div>
          <Field label="Email ученика (необязательно)">
            <input name="email" type="email" defaultValue={base.email} />
          </Field>
          <div className="form-grid">
            <Field label="Схема оплаты">
              <select name="billing" defaultValue={base.billing}>
                <option value="package">Абонемент</option>
                <option value="lesson">Поурочно</option>
              </select>
            </Field>
            <Field label="Цена занятия, ₽">
              <input
                name="rate"
                type="number"
                min={1}
                required
                defaultValue={base.rate}
              />
            </Field>
            <Field label="Занятий в абонементе">
              <input
                name="packageSize"
                type="number"
                min={1}
                max={1000}
                required
                defaultValue={base.packageSize}
              />
            </Field>
            <Field
              label="Начальный остаток занятий"
              hint="Задается при создании, дальнейшие пополнения через оплаты"
            >
              <input
                name="initialBalance"
                type="number"
                min={-1000}
                max={1000}
                required
                defaultValue={base.initialBalance}
              />
            </Field>
          </div>
          <Field label="Личная заметка">
            <textarea name="note" rows={3} defaultValue={base.note} />
          </Field>
        </>
      )}
      {dialog.type === "group" && (
        <>
          <Field label="Название группы">
            <input
              name="name"
              required
              defaultValue={group?.name}
              placeholder="ЕГЭ, профильная математика"
            />
          </Field>
          <StudentsPick s={s} selected={group?.studentIds} />
        </>
      )}
      {dialog.type === "lesson" && (
        <>
          <Field label="Название">
            <input
              name="title"
              required
              defaultValue="Индивидуальное занятие"
            />
          </Field>
          <div className="form-grid">
            <Field label="Предмет">
              <input name="subject" required defaultValue="Математика" />
            </Field>
            <Field label="Длительность, минут">
              <input
                name="duration"
                type="number"
                required
                min={15}
                max={480}
                defaultValue={60}
              />
            </Field>
            <Field
              label="Дата и время"
              hint={`Часовой пояс браузера: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`}
            >
              <input
                type="datetime-local"
                name="start"
                required
                defaultValue={localInput(new Date(Date.now() + 86400000))}
              />
            </Field>
            <Field label="Повторять еженедельно">
              <select name="weeks">
                <option value="1">Разовое занятие</option>
                <option value="4">4 недели</option>
                <option value="8">8 недель</option>
                <option value="12">12 недель</option>
                <option value="26">26 недель</option>
                <option value="52">52 недели</option>
              </select>
            </Field>
          </div>
          <Field label="Ссылка на встречу или место">
            <input name="location" placeholder="https://meet.google.com/…" />
          </Field>
          <StudentsPick s={s} />
        </>
      )}
      {dialog.type === "lesson-detail" && lesson && (
        <>
          <div className="lesson-summary">
            <Badge tone="green">{lesson.subject}</Badge>
            <h3>{lesson.title}</h3>
            <p>
              {new Date(lesson.start).toLocaleString("ru-RU")} ·{" "}
              {lesson.duration} минут
            </p>
            {lesson.location &&
              (/^https?:\/\//.test(lesson.location) ? (
                <a href={lesson.location} target="_blank" rel="noreferrer">
                  Открыть встречу
                  <ArrowRight size={16} />
                </a>
              ) : (
                <p>{lesson.location}</p>
              ))}
          </div>
          {s.user.role === "teacher" && lesson.status !== "completed" ? (
            <>
              <Field label="Статус">
                <select name="status" defaultValue={lesson.status}>
                  {Object.entries(lessonLabel).map(([key, name]) => (
                    <option value={key} key={key}>
                      {name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Новая дата при переносе">
                <input name="start" type="datetime-local" />
              </Field>
              <div className="field">
                <span>Посещение (для проведенного урока)</span>
                {lesson.studentIds.map((id) => (
                  <label className="checkbox-row" key={id}>
                    <input
                      name="attendance"
                      type="checkbox"
                      value={id}
                      defaultChecked={lesson.attendance[id] !== false}
                    />
                    {s.students.find((x) => x.id === id)?.name} присутствовал(а)
                  </label>
                ))}
              </div>
              <p className="notice">
                После отметки «Проведен» занятие учитывается в оплатах. Ученик с
                пропуском не списывается.
              </p>
            </>
          ) : (
            <p className="notice">
              {lessonLabel[lesson.status]}
              {lesson.status === "completed"
                ? ". Занятие учтено в балансе."
                : ""}
            </p>
          )}
        </>
      )}
      {dialog.type === "assignment" && (
        <>
          <Field label="Тема задания">
            <input
              name="title"
              required
              placeholder="Производная и её применение"
            />
          </Field>
          <div className="form-grid">
            <Field label="Предмет">
              <input name="subject" required defaultValue="Математика" />
            </Field>
            <Field label="Максимальный балл">
              <input
                name="maxScore"
                type="number"
                required
                min={1}
                max={1000}
                defaultValue={10}
              />
            </Field>
          </div>
          <Field label="Что нужно сделать">
            <textarea
              name="text"
              required
              rows={5}
              placeholder="Условия, номера упражнений и рекомендации"
            />
          </Field>
          <Field label="Срок сдачи" hint="Время в часовом поясе браузера">
            <input
              name="deadline"
              type="datetime-local"
              required
              defaultValue={localInput(new Date(Date.now() + 3 * 86400000))}
            />
          </Field>
          <Field label="Ссылки (по одной на строку)">
            <textarea name="links" rows={2} placeholder="https://…" />
          </Field>
          <FilesUpload
            onFiles={setFileIds}
            demo={s.demo}
            onBusy={setUploading}
          />
          <StudentsPick s={s} />
        </>
      )}
      {dialog.type === "review" && submission && assignment && (
        <>
          <div className="work-context">
            <Badge>{assignment.subject}</Badge>
            <h3>{assignment.title}</h3>
            <p className="muted">
              {s.students.find((x) => x.id === submission.studentId)?.name}
            </p>
            <p className="pre-wrap">
              {submission.text || "Ответ во вложениях"}
            </p>
            <FileLinks ids={submission.fileIds} files={s.files} />
          </div>
          <div className="form-grid">
            <Field label="Результат проверки">
              <select name="status">
                <option value="reviewed">Проверено</option>
                <option value="revision">На доработке</option>
              </select>
            </Field>
            <Field label={`Балл из ${assignment.maxScore}`}>
              <input
                name="score"
                type="number"
                min={0}
                max={assignment.maxScore}
                step="0.5"
                defaultValue={submission.score}
              />
            </Field>
          </div>
          <Field label="Комментарий и разбор ошибок">
            <textarea
              name="comment"
              rows={5}
              required
              defaultValue={submission.comment}
              placeholder="Что получилось и что стоит повторить"
            />
          </Field>
        </>
      )}
      {dialog.type === "submit" && assignment && (
        <>
          <div className="work-context">
            <Badge>{assignment.subject}</Badge>
            <h3>{assignment.title}</h3>
            <p className="pre-wrap">{assignment.text}</p>
            {assignment.links.map((link) => (
              <a key={link} href={link} target="_blank" rel="noreferrer">
                {link}
              </a>
            ))}
            <FileLinks ids={assignment.fileIds} files={s.files} />
          </div>
          {s.submissions.find(
            (x) => x.assignmentId === assignment.id && x.status === "revision",
          )?.comment && (
            <p className="notice">
              Комментарий преподавателя:{" "}
              {
                s.submissions.find((x) => x.assignmentId === assignment.id)
                  ?.comment
              }
            </p>
          )}
          <Field label="Ваш ответ или комментарий">
            <textarea
              name="text"
              rows={5}
              placeholder="Запишите решение или пояснение к файлам"
            />
          </Field>
          <FilesUpload
            onFiles={setFileIds}
            demo={s.demo}
            onBusy={setUploading}
          />
        </>
      )}
      {dialog.type === "payment" && (
        <>
          <Field label="Ученик">
            <select
              value={selectedStudent}
              onChange={(e) => setSelectedStudent(e.target.value)}
            >
              {s.students.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </Field>
          {paymentStudent && (
            <div key={paymentStudent.id}>
              <p className="notice">
                {paymentStudent.billing === "package"
                  ? `Остаток: ${funds!.balance} занятий`
                  : `Задолженность: ${rub(funds!.debt)}`}
              </p>
              <Field label="Полученная сумма, ₽">
                <input
                  name="amount"
                  type="number"
                  min={1}
                  required
                  defaultValue={
                    paymentStudent.billing === "package"
                      ? paymentStudent.packageSize * paymentStudent.rate
                      : funds!.debt
                  }
                />
              </Field>
              {paymentStudent.billing === "package" ? (
                <Field label="Пополнить на количество занятий">
                  <input
                    name="lessons"
                    type="number"
                    min={1}
                    max={1000}
                    required
                    defaultValue={paymentStudent.packageSize}
                  />
                </Field>
              ) : (
                <div className="field">
                  <span>Закрыть задолженность за уроки</span>
                  {funds!.unpaid.map((l) => (
                    <label key={l.id} className="checkbox-row">
                      <input
                        type="checkbox"
                        name="lessonIds"
                        value={l.id}
                        defaultChecked
                      />
                      {new Date(l.start).toLocaleDateString("ru-RU")} ·{" "}
                      {rub(l.rates[paymentStudent.id] ?? paymentStudent.rate)}
                    </label>
                  ))}
                  {!funds!.unpaid.length && (
                    <p className="muted">Все проведенные уроки оплачены.</p>
                  )}
                </div>
              )}
            </div>
          )}
          <Field label="Заметка о платеже">
            <input name="note" placeholder="Например, перевод по СБП" />
          </Field>
        </>
      )}
      {dialog.type === "report" && (
        <>
          <p className="notice">
            ИИ составит отчет по посещениям, баллам и вашим комментариям.
            Готовый текст автоматически получит родитель в подключенном боте.
          </p>
          <Field label="Ученик">
            <select name="studentId" defaultValue={dialog.id}>
              {s.students.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="form-grid">
            <Field label="Начало периода">
              <input
                name="from"
                type="date"
                required
                defaultValue={localInput(
                  new Date(Date.now() - 14 * 86400000),
                ).slice(0, 10)}
              />
            </Field>
            <Field label="Конец периода">
              <input
                name="to"
                type="date"
                required
                defaultValue={localInput(new Date()).slice(0, 10)}
              />
            </Field>
          </div>
          {!s.integrations.deepseek && (
            <p className="form-error">
              Для генерации нужен DEEPSEEK_API_KEY на сервере.
            </p>
          )}
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="button" onClick={onClose}>
          Закрыть
        </button>
        {!(
          dialog.type === "lesson-detail" &&
          (lesson?.status === "completed" || s.user.role === "student")
        ) && (
          <button
            className="primary"
            disabled={
              busy ||
              uploading ||
              (dialog.type === "report" && !s.integrations.deepseek)
            }
          >
            {busy
              ? "Сохранение…"
              : dialog.type === "submit"
                ? "Отправить работу"
                : dialog.type === "review"
                  ? "Сохранить проверку"
                  : dialog.type === "report"
                    ? "Сформировать отчет"
                    : "Сохранить"}
            <ArrowRight size={16} />
          </button>
        )}
      </div>
    </form>
  );
}

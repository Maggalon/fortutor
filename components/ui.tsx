"use client";
import { useEffect, useRef } from "react";
import {
  X,
  Plus,
  ArrowRight,
  File,
  Copy,
  PaperPlaneTilt,
} from "@phosphor-icons/react";
export function MaxIcon({ size = 22 }: { size?: number }) {
  return (
    <span
      className="max-icon"
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}
export function ChannelLabel({ channel }: { channel: "telegram" | "max" }) {
  return (
    <span className="channel-label">
      {channel === "max" ? <MaxIcon size={14} /> : <PaperPlaneTilt size={14} />}
      {channel === "max" ? "MAX" : "Telegram"}
    </span>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Закрыть" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
export function Empty({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <File size={32} weight="duotone" />
      <h3>{title}</h3>
      {detail && <p>{detail}</p>}
      {action}
    </div>
  );
}
export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const letters = name
    .split(" ")
    .slice(0, 2)
    .map((x) => x[0])
    .join("");
  const tone =
    Array.from(name).reduce((sum, c) => sum + c.charCodeAt(0), 0) % 4;
  return (
    <span
      className={`avatar tone-${tone}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {letters}
    </span>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function CreateButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="primary" onClick={onClick}>
      <Plus size={18} weight="bold" />
      {children}
    </button>
  );
}
export function SectionHead({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="section-head">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
export function FileLinks({
  ids,
  files,
}: {
  ids: string[];
  files: { id: string; name: string }[];
}) {
  return (
    <div className="file-links">
      {ids.map((id) => (
        <a key={id} href={`/api/files/${id}`} target="_blank" rel="noreferrer">
          <File size={16} />
          {files.find((f) => f.id === id)?.name || "Вложение"}
          <ArrowRight size={14} />
        </a>
      ))}
    </div>
  );
}
export function CopyValue({
  value,
  onCopy,
}: {
  value: string;
  onCopy: (value: string) => void;
}) {
  return (
    <div className="copy-value">
      <input aria-label="Значение для копирования" readOnly value={value} />
      <button
        className="icon-button"
        aria-label="Скопировать"
        onClick={() => onCopy(value)}
      >
        <Copy size={18} />
      </button>
    </div>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

"use client";

import { useState, type InputHTMLAttributes } from "react";
import { CalendarDays, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A date, a date and time, or a time — drawn by the site, picked with the
 * browser's own picker.
 *
 * ---------------------------------------------------------------------------
 * Why not the browser's field as it is
 * ---------------------------------------------------------------------------
 * The shop's screenshot of 2026-11-20: on an Arabic phone the period's "from"
 * read `012026/10/` and "to" `202026/11/`. The browser draws a date field's
 * text itself, in the phone's language, and an Arabic date carries invisible
 * right-to-left marks between its parts; every date field on this site was
 * pinned left-to-right (`dir="ltr"` or `data-numeric`) so a number would never
 * be reordered, and inside a left-to-right box those marks open little
 * right-to-left runs that scramble the parts — the fault `lib/data/datetime.ts`
 * already fixes for the dates the site prints itself. Taking the pin off
 * mends the phone and breaks the desktop field the other way round, and no
 * stylesheet reaches inside the browser's own text.
 *
 * So the site draws the value — `01/10/2026`, day first and Western digits as
 * on every other date here, the same in both languages — and the real field
 * lies over it, transparent: a press lands on it and opens the browser's own
 * picker (`showPicker()` on a laptop, where a press would otherwise only
 * select a part of the field; a phone opens its picker on a tap anyway). The
 * value, the form submit, `min`/`max`, the label and the keyboard are all the
 * real field's, so nothing about how a date is chosen or sent changed.
 */
type DateFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "placeholder"> & {
  type?: "date" | "datetime-local" | "time";
  /** What is drawn while there is no value. */
  placeholder?: string;
};

/** `2026-10-01` → `01/10/2026`; `2026-10-01T14:30` → `01/10/2026 · 14:30`; `14:30` → `14:30`. */
export function formatFieldValue(type: DateFieldProps["type"], value: string): string {
  if (!value) return "";
  if (type === "time") return value.slice(0, 5);
  const [day, time] = value.split("T");
  const parts = day.split("-");
  const date = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : day;
  return type === "datetime-local" && time ? `${date} · ${time.slice(0, 5)}` : date;
}

export function DateField({
  type = "date",
  value,
  defaultValue,
  onChange,
  onClick,
  className,
  placeholder,
  disabled,
  ...rest
}: DateFieldProps) {
  // The value a form-only field (no `value`) holds, so the drawing follows it.
  const [own, setOwn] = useState(defaultValue == null ? "" : String(defaultValue));
  const shown = value !== undefined ? (value == null ? "" : String(value)) : own;
  const Icon = type === "time" ? Clock : CalendarDays;
  return (
    <span
      data-date-field
      className={cn(
        className,
        "relative inline-flex min-w-0 items-center justify-between gap-2 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <span
        aria-hidden
        dir="ltr"
        className={cn("pointer-events-none min-w-0 truncate tabular-nums", !shown && "text-muted")}
      >
        {shown ? formatFieldValue(type, shown) : (placeholder ?? "—")}
      </span>
      <Icon className="pointer-events-none size-4 shrink-0 text-muted" aria-hidden />
      <input
        {...rest}
        type={type}
        value={value}
        defaultValue={defaultValue}
        disabled={disabled}
        onChange={(event) => {
          if (value === undefined) setOwn(event.target.value);
          onChange?.(event);
        }}
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented || disabled) return;
          try {
            event.currentTarget.showPicker?.();
          } catch {
            /* Already open, or a browser that opens it by itself. */
          }
        }}
        className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
      />
    </span>
  );
}

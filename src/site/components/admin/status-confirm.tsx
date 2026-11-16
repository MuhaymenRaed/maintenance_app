"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { statusTone, TONE_VAR } from "@/lib/data/status-tone";

/**
 * "Move this ticket to ‹ready›?" — asked before any status changes.
 *
 * ---------------------------------------------------------------------------
 * Why every status button now asks
 * ---------------------------------------------------------------------------
 * A status is the one field on a ticket the customer is told about. Moving an
 * order to "shipped" or a repair to "waiting for the customer" sends a
 * notification, a WhatsApp template and a push, and some moves do more: an
 * accepted order takes its units off the shelf, a cancelled one gives them
 * back. Those are not things to do by brushing the wrong button in a row of
 * eight, and the shop asked for it in so many words — a confirmation before
 * every status change, so a mis-press can be taken back before anybody hears
 * about it.
 *
 * One hook for every board that moves a status, so the wording, the two
 * coloured pills and the "Go back" default are the same on the repair desk,
 * the orders queue, the replacement queue and the requests board.
 *
 * ⚠️ The board's optimistic update and its server call both run **after**
 * the confirm, never before — the row must not change colour behind a dialog
 * that is still asking whether it should.
 */
export type StatusChange = {
  /** What is moving — a ticket code, an order code, "3 orders". */
  subject: string;
  /** The current status as a key, for its colour; and as the reader's words. */
  from?: { key: string; label: string };
  to: { key: string; label: string };
  /** The board's own move: optimistic update, then the server. */
  run: () => void;
  /** An extra sentence — what the move will do beyond the label. */
  note?: string;
};

export function useStatusConfirm(): {
  request: (change: StatusChange) => void;
  dialog: ReactNode;
} {
  const t = useTranslations("Admin");
  const [change, setChange] = useState<StatusChange | null>(null);

  const danger =
    change?.to.key === "cancelled" ||
    change?.to.key === "declined" ||
    change?.to.key === "rejected";

  const dialog = (
    <ConfirmDialog
      open={change !== null}
      title={t("statusConfirmTitle")}
      body={
        change
          ? change.from
            ? t("statusConfirmBody", {
                subject: change.subject,
                from: change.from.label,
                to: change.to.label,
              })
            : t("statusConfirmBodyTo", { subject: change.subject, to: change.to.label })
          : undefined
      }
      confirmLabel={t("statusConfirmYes")}
      cancelLabel={t("statusConfirmNo")}
      tone={danger ? "danger" : "normal"}
      onConfirm={() => {
        const pending = change;
        setChange(null);
        pending?.run();
      }}
      onCancel={() => setChange(null)}
    >
      {change && (
        <>
          <p className="flex flex-wrap items-center gap-2">
            {change.from && (
              <>
                <Pill keyName={change.from.key} label={change.from.label} muted />
                <ArrowLeft className="size-4 shrink-0 text-muted ltr:rotate-180" aria-hidden />
              </>
            )}
            <Pill keyName={change.to.key} label={change.to.label} />
          </p>
          {change.note && (
            <p className="rounded-card border border-warning/35 bg-warning/6 px-3 py-2 text-[0.76rem] font-bold leading-relaxed text-warning">
              {change.note}
            </p>
          )}
        </>
      )}
    </ConfirmDialog>
  );

  return { request: setChange, dialog };
}

function Pill({ keyName, label, muted }: { keyName: string; label: string; muted?: boolean }) {
  const colour = TONE_VAR[statusTone(keyName)];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-chip border px-2.5 py-1 text-[0.76rem] font-extrabold"
      style={
        muted
          ? { borderColor: "var(--line)", color: "var(--muted)" }
          : {
              borderColor: `color-mix(in srgb, ${colour} 45%, transparent)`,
              background: `color-mix(in srgb, ${colour} 12%, transparent)`,
              color: colour,
            }
      }
    >
      <span className="size-2 rounded-full" style={{ background: colour }} aria-hidden />
      {label}
    </span>
  );
}

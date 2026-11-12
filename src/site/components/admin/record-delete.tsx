"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deleteRecord, type RecordKind } from "@/lib/actions/records";

/**
 * "Delete this record" — the owner's control, on every queue that has one.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ Absent, never disabled
 * ---------------------------------------------------------------------------
 * `canDelete` is `records.delete`, which only the two owner roles carry. A
 * greyed-out delete button asks every member of staff who ever opens an order
 * to work out why they may not press it, and the answer is a fact about them
 * rather than about the order — which is exactly the case this codebase
 * hides a control for. The one place it stays and goes disabled is the
 * notification composer, where what is missing is a field the reader can fill
 * in from the screen in front of them.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ The dialog says what else happens, because deleting an order is not only
 * deleting an order
 * ---------------------------------------------------------------------------
 * `delete_record` cancels a live order first, which puts its units back on the
 * shelf, returns the coupon use and releases an approved trade-in. That is the
 * right behaviour — a hidden order still holding a handset is the fault
 * `20260824_cancel_order_releases_holds.sql` exists for — and it is invisible
 * from this screen unless the confirmation says so. Hence a per-kind body.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ `onDeleted` rather than a router refresh
 * ---------------------------------------------------------------------------
 * These boards hold their rows in state and apply status moves optimistically.
 * The action revalidates the page, but the dialog the reader is looking at is
 * open *over* that board and would sit there describing a row that is gone.
 * The caller drops the row and closes the dialog on the same frame.
 */
export function RecordDelete({
  kind,
  id,
  label,
  canDelete,
  onDeleted,
  className,
}: {
  kind: RecordKind;
  id: string;
  /** What it is called on the board — the code, for the trail and the prompt. */
  label: string;
  canDelete: boolean;
  onDeleted: () => void;
  className?: string;
}) {
  const t = useTranslations("Admin");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!canDelete) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className={
          className ??
          "inline-flex items-center gap-1.5 rounded-control border border-brand/35 px-3 py-2 text-[0.75rem] font-extrabold text-brand transition-colors hover:bg-brand/8"
        }
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : (
          <Trash2 className="size-3.5" aria-hidden />
        )}
        {t("deleteRecord")}
      </button>

      {/* The refusal is drawn beside the button rather than inside the dialog,
          which has closed by the time it arrives. `delete_unavailable` is the
          migration not having run on this deployment — a different sentence
          from "it failed", for the reason `getPromoRows` draws that line. */}
      {error && (
        <p role="alert" className="mt-2 text-[0.72rem] font-bold text-brand">
          {t.has(`recordErr_${error}`)
            ? t(`recordErr_${error}` as "recordErr_forbidden")
            : t("updateFailed")}
        </p>
      )}

      <ConfirmDialog
        open={open}
        title={t("deleteRecordTitle", { label })}
        body={t(`deleteRecordBody_${kind}` as "deleteRecordBody_order")}
        confirmLabel={t("deleteRecord")}
        cancelLabel={t("cancel")}
        pending={pending}
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          start(async () => {
            const result = await deleteRecord({ kind, id, label });
            setOpen(false);
            if (result.ok) onDeleted();
            else setError(result.error);
          });
        }}
      />
    </>
  );
}

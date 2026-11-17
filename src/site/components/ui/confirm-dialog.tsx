"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOwnerDocument } from "@/lib/windows/owner-document";

/**
 * "Are you sure?", as a dialog rather than as a button that changes its mind.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ Why the arming pattern had to go
 * ---------------------------------------------------------------------------
 * Every destructive control in the back office used to confirm itself by
 * *becoming* the confirmation: press Delete, the button turns solid red and
 * reads "Confirm delete", press again and the row is gone. The reasoning for
 * it is in CLAUDE.md and the half about `window.confirm` is still right — a
 * native dialog cannot be translated, ignores every token in `globals.css`,
 * and on Windows draws a system panel over a themed one.
 *
 * The half that was wrong is that a button which arms itself is safe. It is
 * the *same button, in the same place*, and the only thing between the two
 * presses is however long the reader takes to notice the label changed. A
 * double press — a mis-click, a trackpad, a phone registering two taps, an
 * impatient second press on a control that appeared not to respond — sails
 * straight through both states and deletes the thing. The guard is defeated by
 * exactly the input it exists to guard against.
 *
 * A dialog cannot be double-clicked through: it opens somewhere else, the
 * confirming control is not under the cursor, and it says what is about to
 * happen in words rather than asking the reader to notice a colour change.
 *
 * Escape, the overlay and Cancel all dismiss without acting, and the
 * confirming button is deliberately **not** focused on open, so a stray Return
 * lands on nothing.
 *
 * ---------------------------------------------------------------------------
 * Nested inside an editor, on purpose
 * ---------------------------------------------------------------------------
 * Most of these are raised from inside an `EntityDialog` that is already open,
 * and that editor has to stay on screen behind: the reader needs to see *what*
 * they are deleting while they decide. So this takes its own two rungs of the
 * stacking scale, above a dialog's content — see the scale at the top of
 * `globals.css` — rather than reusing them, or the editor would paint over its
 * own confirmation.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  pending,
  tone = "danger",
  children,
}: {
  open: boolean;
  title: string;
  /** One sentence naming what is about to happen, and to what. */
  body?: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  pending?: boolean;
  /** `danger` is the red, irreversible act; `normal` is everything else. */
  tone?: "danger" | "normal";
  /** Choices that belong to the act — a switch, a reason — drawn under the body. */
  children?: React.ReactNode;
}) {
  const owner = useOwnerDocument();
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onCancel()}>
      {/* In the window it was asked from — a detached ticket's own, not the
          dashboard's behind it. See `lib/windows/owner-document.tsx`. */}
      <Dialog.Portal container={owner?.body}>
        <Dialog.Overlay className="fixed inset-0 z-85 bg-scrim/55 data-[state=open]:[animation:dialog-overlay-in_120ms_ease-out]" />
        <Dialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => event.preventDefault()}
          className="fixed start-1/2 top-1/2 z-88 w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-panel border border-line bg-surface p-6 shadow-lift focus:outline-none data-[state=open]:[animation:dialog-content-in_160ms_ease-out] rtl:translate-x-1/2"
          style={{ ["--dialog-content-x" as string]: "-50%" }}
        >
          <span
            className={cn(
              "mb-3 flex size-10 items-center justify-center rounded-card",
              tone === "danger"
                ? "bg-brand/12 text-brand"
                : "bg-info/12 text-info",
            )}
            aria-hidden
          >
            <TriangleAlert className="size-5" />
          </span>

          <Dialog.Title className="text-[1rem] font-black tracking-[-0.02em] text-ink">
            {title}
          </Dialog.Title>
          {body && (
            <p className="mt-1.5 text-[0.82rem] font-medium leading-relaxed text-muted">
              {body}
            </p>
          )}

          {children && <div className="mt-4 space-y-3">{children}</div>}

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-control px-4 py-2.5 text-[0.78rem] font-extrabold text-muted transition-colors hover:bg-subtle hover:text-ink"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={pending}
              className={cn(
                "inline-flex items-center gap-2 rounded-control px-5 py-2.5 text-[0.78rem] font-extrabold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                tone === "danger"
                  ? "bg-brand shadow-brand-lift hover:bg-brand-hover"
                  : "bg-info hover:brightness-95",
              )}
            >
              {pending && (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              )}
              {confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

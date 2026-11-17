"use client";

import { createContext, useContext, useId, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useTranslations } from "next-intl";
import { KeyRound, Loader2, LockKeyhole } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { dialogOverlay } from "@/components/ui/dialog-chrome";
import { useOwnerDocument } from "@/lib/windows/owner-document";
import { cn } from "@/lib/utils";

/**
 * The desk's password: what stands between a shared counter PC and the parts
 * of the repair desk only a manager should open.
 *
 * ---------------------------------------------------------------------------
 * Why, and where
 * ---------------------------------------------------------------------------
 * The shop, 2026-11-17: the desktop app is used by several people on one
 * account, a technician among them, so editing a ticket, reading the figures
 * and the reports, and opening the settings are behind a password — asked
 * **every time**, the shop's own answer to "how long should it stay
 * unlocked". Cancelling is always possible and leaves the reader doing
 * whatever needs no password.
 *
 * The site draws these same components and never asks: there every member of
 * staff signs in as themselves, and what they may open is their account's
 * business (`lib/permissions.ts`). So the default gate is open, and only the
 * desktop app provides one that asks — through `DeskGateProvider`, with a
 * `verify` that checks the password where it is kept, in the app's main
 * process. Nothing here knows the password or how it is stored.
 *
 * ⚠️ This is a lock on the app's own screens, not the security boundary. What
 * an account may read and write is still decided by the database; the password
 * only decides which of the shop account's screens a person at the counter may
 * open.
 */
export type DeskGate = {
  /** Whether the protected parts ask for the password here at all. */
  required: boolean;
  /** True when `password` is the desk's. */
  verify: (password: string) => Promise<boolean>;
};

export type GateReason = "edit" | "stats" | "settings";

const OPEN: DeskGate = { required: false, verify: async () => true };
const GateContext = createContext<DeskGate>(OPEN);

export function DeskGateProvider({ value, children }: { value: DeskGate; children: ReactNode }) {
  return <GateContext.Provider value={value}>{children}</GateContext.Provider>;
}

export function useDeskGate(): DeskGate {
  return useContext(GateContext);
}

/**
 * Runs `action` once the password has been given — or at once, where the gate
 * is open. `prompt` must be rendered by the caller; it is the dialog.
 *
 * ⚠️ The action runs from the unlock press, which is what lets an editor that
 * opens as a window of its own (`lib/windows/detached.ts`) still count as the
 * reader's own act: a browser opens a pop-up only while a press is fresh.
 */
export function useGuardedAction(): {
  run: (reason: GateReason, action: () => void) => void;
  prompt: ReactNode;
} {
  const gate = useDeskGate();
  const [asking, setAsking] = useState<{ reason: GateReason; action: () => void } | null>(null);

  function run(reason: GateReason, action: () => void) {
    if (!gate.required) {
      action();
      return;
    }
    setAsking({ reason, action });
  }

  const prompt = asking ? (
    <PasswordDialog
      reason={asking.reason}
      verify={gate.verify}
      onCancel={() => setAsking(null)}
      onUnlocked={() => {
        const action = asking.action;
        setAsking(null);
        action();
      }}
    />
  ) : null;

  return { run, prompt };
}

/**
 * A panel behind the password, asked inline each time the panel is opened:
 * the unlock lives in this component's own state, so leaving the panel locks
 * it again. Where the gate is open it is simply the panel.
 *
 * `cancelHref` is the way out the dialog's cancel button gives — "if you don't
 * know the password you can quit and do the normal thing" (the shop) — as a
 * link, because leaving a panel is a change of page rather than closing a box.
 */
export function LockedPanel({
  reason,
  children,
  cancelHref,
}: {
  reason: GateReason;
  children: ReactNode;
  cancelHref?: string;
}) {
  const gate = useDeskGate();
  const [open, setOpen] = useState(false);
  if (!gate.required || open) return <>{children}</>;
  return (
    <section className="mx-auto max-w-md rounded-panel border border-line bg-surface p-6 shadow-card">
      <PasswordForm reason={reason} verify={gate.verify} onUnlocked={() => setOpen(true)} cancelHref={cancelHref} />
    </section>
  );
}

const cancelClass =
  "rounded-control px-3.5 py-2 text-[0.8rem] font-bold text-muted transition-colors hover:text-ink";

function PasswordDialog({
  reason,
  verify,
  onCancel,
  onUnlocked,
}: {
  reason: GateReason;
  verify: DeskGate["verify"];
  onCancel: () => void;
  onUnlocked: () => void;
}) {
  const owner = useOwnerDocument();
  return (
    <Dialog.Root open onOpenChange={(next) => !next && onCancel()}>
      <Dialog.Portal container={owner?.body}>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed start-1/2 top-1/2 z-80 w-[min(24rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 rounded-panel border border-line bg-surface p-5 shadow-lift focus:outline-none data-[state=open]:[animation:dialog-content-in_180ms_ease-out] rtl:translate-x-1/2"
          style={{ ["--dialog-content-x" as string]: "-50%" }}
        >
          <PasswordForm reason={reason} verify={verify} onUnlocked={onUnlocked} onCancel={onCancel} inDialog />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PasswordForm({
  reason,
  verify,
  onUnlocked,
  onCancel,
  cancelHref,
  inDialog = false,
}: {
  reason: GateReason;
  verify: DeskGate["verify"];
  onUnlocked: () => void;
  onCancel?: () => void;
  cancelHref?: string;
  inDialog?: boolean;
}) {
  const t = useTranslations("Admin");
  const id = useId();
  const [value, setValue] = useState("");
  const [checking, setChecking] = useState(false);
  const [wrong, setWrong] = useState(false);

  async function submit() {
    if (!value || checking) return;
    setChecking(true);
    setWrong(false);
    let ok = false;
    try {
      ok = await verify(value);
    } catch {
      ok = false;
    }
    setChecking(false);
    if (ok) {
      onUnlocked();
      return;
    }
    setWrong(true);
    setValue("");
  }

  const Title = inDialog ? Dialog.Title : "h2";
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="space-y-3.5"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-brand/10 text-brand">
          <LockKeyhole className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <Title className="text-[0.98rem] font-black text-ink">{t(`gateTitle_${reason}` as "gateTitle_edit")}</Title>
          <p className="mt-0.5 text-[0.78rem] font-medium leading-relaxed text-muted">{t("gateBody")}</p>
        </div>
      </div>

      <label htmlFor={id} className="block">
        <span className="mb-1 block text-[0.74rem] font-bold text-ink">{t("gatePassword")}</span>
        <span className="relative block">
          <KeyRound className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            id={id}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            dir="ltr"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setWrong(false);
            }}
            aria-invalid={wrong || undefined}
            className={cn(
              "w-full rounded-control border bg-canvas py-2.5 ps-9 pe-3 text-[0.95rem] font-bold tracking-[0.3em] text-ink outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/20",
              wrong ? "border-brand" : "border-line",
            )}
          />
        </span>
        {wrong && (
          <span role="alert" className="mt-1.5 block text-[0.74rem] font-bold text-brand">
            {t("gateWrong")}
          </span>
        )}
      </label>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {onCancel ? (
          <button type="button" onClick={onCancel} className={cancelClass}>
            {t("gateCancel")}
          </button>
        ) : cancelHref ? (
          <Link href={cancelHref} className={cancelClass}>
            {t("gateCancel")}
          </Link>
        ) : null}
        <button
          type="submit"
          disabled={!value || checking}
          className="press inline-flex items-center gap-2 rounded-control bg-brand px-4 py-2 text-[0.82rem] font-extrabold text-white transition-colors hover:bg-brand-hover disabled:opacity-60"
        >
          {checking && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {t("gateUnlock")}
        </button>
      </div>
    </form>
  );
}

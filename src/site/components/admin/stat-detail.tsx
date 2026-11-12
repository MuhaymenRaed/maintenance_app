"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUpRight, X } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { dialogOverlay } from "@/components/ui/dialog-chrome";
import { cn } from "@/lib/utils";

/**
 * "What is behind this number?"
 *
 * Every figure on the dashboard is now a press. Where a section already
 * answers the question in full — customers, orders, inventory — the card is
 * a link to it (`href`). Where none does, the card opens this: the figure,
 * how it was arrived at, the parts it is made of, and a link onward when one
 * makes sense. A figure that cannot be pressed is a dead end pretending to
 * be a control, which is the objection the account page's stat tiles were
 * rebuilt on.
 *
 * ⚠️ Everything here arrives as finished strings. The overview is a Server
 * Component with `getTranslations` in hand; a formatter cannot cross into
 * this Client Component (the "Functions cannot be passed directly" trap
 * CLAUDE.md records three times), so each row is `label`/`value`/`hint`
 * already resolved.
 */

export type StatDetail = {
  title: string;
  /** What the figure means, and what is excluded — one or two sentences. */
  body?: string;
  rows?: { label: string; value: string; hint?: string; tone?: "brand" | "success" | "warning" | "info" | "muted" }[];
  /** Somewhere the figure can be acted on. */
  link?: { label: string; href: string };
};

export function DetailDialog({
  detail,
  open,
  onOpenChange,
  closeLabel,
}: {
  detail: StatDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  closeLabel: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-80 flex max-h-[88dvh] flex-col overflow-hidden rounded-t-panel border-t border-line bg-surface shadow-lift",
            "sm:inset-x-auto sm:start-1/2 sm:top-1/2 sm:bottom-auto sm:w-[min(28rem,calc(100vw-2rem))] sm:rounded-panel sm:border",
            "sm:[--dialog-content-x:-50%] sm:rtl:[--dialog-content-x:50%]",
            "sm:-translate-y-1/2 sm:translate-x-[var(--dialog-content-x)]",
            "max-sm:data-[state=open]:[animation:sheet-up_240ms_cubic-bezier(0.32,0.72,0,1)]",
            "sm:data-[state=open]:[animation:dialog-content-in_200ms_cubic-bezier(0.32,0.72,0,1)]",
            "focus:outline-none",
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="text-[0.95rem] font-black text-ink">
                {detail.title}
              </Dialog.Title>
              {detail.body && (
                <Dialog.Description className="mt-1 text-[0.78rem] font-medium leading-relaxed text-muted">
                  {detail.body}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label={closeLabel}
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-subtle hover:text-ink"
              >
                <X className="size-4" aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          {detail.rows && detail.rows.length > 0 && (
            <dl className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-3">
              {detail.rows.map((row) => (
                <div
                  key={row.label}
                  className="flex items-baseline justify-between gap-4 border-b border-line/70 py-2.5 last:border-b-0"
                >
                  <dt className="min-w-0">
                    <span className="block text-[0.8rem] font-bold text-ink">
                      {row.label}
                    </span>
                    {row.hint && (
                      <span className="block text-[0.7rem] font-medium text-muted">
                        {row.hint}
                      </span>
                    )}
                  </dt>
                  <dd
                    className={cn(
                      "shrink-0 text-[0.9rem] font-black",
                      row.tone === "brand" && "text-brand",
                      row.tone === "success" && "text-success",
                      row.tone === "warning" && "text-warning",
                      row.tone === "info" && "text-info",
                      row.tone === "muted" && "text-muted",
                      !row.tone && "text-ink",
                    )}
                    data-numeric
                  >
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          {detail.link && (
            <div className="border-t border-line px-5 py-3">
              <Link
                href={detail.link.href}
                onClick={() => onOpenChange(false)}
                className="inline-flex items-center gap-1.5 text-[0.82rem] font-extrabold text-brand hover:underline"
              >
                {detail.link.label}
                <ArrowUpRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
              </Link>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Makes any card a press. Given `href` it is a link; given `detail` it opens
 * the dialog; given neither it renders the children inert. The children are
 * the card's *body*; this supplies the interactive shell so every stat card
 * on the dashboard answers a press the same way.
 */
export function StatPress({
  href,
  detail,
  closeLabel,
  className,
  children,
}: {
  href?: string;
  detail?: StatDetail;
  closeLabel: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const interactive =
    "group/stat press cursor-pointer text-start transition-[border-color,box-shadow] hover:border-brand/40 hover:shadow-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

  if (href) {
    return (
      <Link href={href} className={cn(className, interactive)}>
        {children}
      </Link>
    );
  }
  if (detail) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(className, interactive, "w-full")}
        >
          {children}
        </button>
        <DetailDialog
          detail={detail}
          open={open}
          onOpenChange={setOpen}
          closeLabel={closeLabel}
        />
      </>
    );
  }
  return <div className={className}>{children}</div>;
}

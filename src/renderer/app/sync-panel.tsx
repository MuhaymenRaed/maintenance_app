import { useEffect, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  AlertTriangle,
  CheckCircle2,
  CloudDownload,
  CloudUpload,
  Loader2,
  RefreshCw,
  RotateCcw,
  Trash2,
  WifiOff,
} from "lucide-react";
import { EntityDialog } from "@/components/admin/form-kit";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatDayTime } from "@/lib/data/datetime";
import { cn } from "@/lib/utils";
import type { OpKind, OutboxItem } from "../../shared/contract";
import { openTicket } from "../lib/router";
import { syncNow, useSync } from "../lib/sync";

/**
 * Everything this computer still owes the server, and what the server said no to.
 *
 * ---------------------------------------------------------------------------
 * Why a panel, and why every row is readable
 * ---------------------------------------------------------------------------
 * The desk saves to this computer first and the server second, so between the
 * two there is a list — "the price of RP-00041", "a new ticket for Ali, Galaxy
 * A17" — and the reader is entitled to see it. Most of the time it is empty or
 * drains in a second. When the line is down it is a day's work, and when the
 * server refuses a change (somebody on the dashboard took the ticket back, the
 * account lost a permission) it is the one place that says which change and
 * why.
 *
 * ⚠️ A refused change is **never retried on its own**. The engine backs off a
 * dropped line for ever, because a dropped line comes back; it stops on a
 * refusal, because asking the same question again gets the same answer. The
 * reader decides — retry it (a permission restored, a ticket handed back) or
 * discard it, which puts the ticket back to what the server holds.
 */

let open = false;
const listeners = new Set<() => void>();
const setOpen = (next: boolean) => {
  open = next;
  for (const listener of listeners) listener();
};
export const openSyncPanel = () => setOpen(true);
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function SyncPanelHost() {
  const isOpen = useSyncExternalStore(subscribe, () => open, () => false);
  return isOpen ? <SyncPanel onClose={() => setOpen(false)} /> : null;
}

const KIND_LABEL: Record<OpKind, string> = {
  create: "opCreate",
  update: "opUpdate",
  finance: "opFinance",
  assign: "opAssign",
  photos: "opPhotos",
  delete: "opDelete",
  faults: "opFaults",
  details: "opDetails",
  handover: "opHandover",
  decide: "opDecide",
};

/** The fields an `update` or `finance` change carries, in words. */
const FIELD_KEYS: Record<string, string> = {
  status: "fieldStatus",
  price: "fieldPrice",
  warranty: "fieldWarranty",
  warrantyDays: "fieldWarrantyDays",
  warrantyStart: "fieldWarrantyStart",
  quoteNotes: "fieldQuoteNotes",
  costPrice: "fieldCostPrice",
  collected: "fieldCollected",
  paymentTerms: "fieldPaymentTerms",
  brandCode: "fieldBrand",
  deviceModel: "fieldDevice",
  customerName: "fieldCustomerName",
  customerPhone: "fieldPhone",
  customerPhone2: "fieldPhone2",
};

function SyncPanel({ onClose }: { onClose: () => void }) {
  const t = useTranslations("Desk");
  const tAdmin = useTranslations("Admin");
  const locale = useLocale();
  const sync = useSync();
  const [items, setItems] = useState<OutboxItem[] | null>(null);
  const [working, setWorking] = useState<number | "sync" | "redownload" | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "discard"; item: OutboxItem } | { kind: "redownload" } | null>(null);

  // The list is re-read whenever the engine reports a change of state —
  // which is every send, every refusal and every arrival of the line.
  const version = `${sync.pending}:${sync.failed}:${sync.lastPushAt ?? ""}:${sync.state}`;
  useEffect(() => {
    let alive = true;
    void window.desk.outbox().then((list) => {
      if (alive) setItems(list);
    });
    return () => {
      alive = false;
    };
  }, [version]);

  const when = (iso: string | null) => (iso ? formatDayTime(locale, iso) : t("never"));

  const describe = (item: OutboxItem) => {
    if (item.kind === "update" || item.kind === "finance" || item.kind === "details") {
      return item.detail
        .split(", ")
        .filter(Boolean)
        .map((field) => (FIELD_KEYS[field] ? t(FIELD_KEYS[field]) : field))
        .join(locale === "ar" ? "، " : ", ");
    }
    if (item.kind === "photos") return t("opPhotosCount", { count: Number(item.detail) || 0 });
    if (item.kind === "handover") return t(item.detail === "on" ? "opHandoverOn" : "opHandoverOff");
    if (item.kind === "decide") return t(item.detail === "accept" ? "opDecideAccept" : "opDecideRefuse");
    return item.detail;
  };

  async function retry(item: OutboxItem) {
    setWorking(item.id);
    await window.desk.retryOp(item.id);
    setItems(await window.desk.outbox());
    setWorking(null);
  }

  async function discard(item: OutboxItem) {
    setWorking(item.id);
    await window.desk.discardOp(item.id);
    setItems(await window.desk.outbox());
    setWorking(null);
    setConfirm(null);
  }

  async function now() {
    setWorking("sync");
    await syncNow();
    setItems(await window.desk.outbox());
    setWorking(null);
  }

  async function redownload() {
    setWorking("redownload");
    setConfirm(null);
    await window.desk.redownload();
    setItems(await window.desk.outbox());
    setWorking(null);
  }

  const failed = items?.filter((item) => item.state === "failed") ?? [];
  const pending = items?.filter((item) => item.state === "pending") ?? [];

  return (
    <>
      <EntityDialog
        title={t("syncTitle")}
        subtitle={sync.account ? `${sync.account.name} · ${sync.account.email}` : undefined}
        closeLabel={tAdmin("close")}
        onClose={onClose}
        width={680}
        accent={sync.failed > 0 ? "var(--brand)" : sync.online ? "var(--success)" : "var(--warning)"}
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setConfirm({ kind: "redownload" })}
              disabled={working !== null || !sync.online}
              className="inline-flex items-center gap-2 rounded-control px-3 py-2 text-[0.76rem] font-extrabold text-muted transition-colors hover:bg-subtle hover:text-ink disabled:opacity-50"
            >
              {working === "redownload" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <CloudDownload className="size-4" aria-hidden />
              )}
              {t("redownload")}
            </button>
            <button
              type="button"
              onClick={() => void now()}
              disabled={working !== null}
              className="press inline-flex items-center gap-2 rounded-control bg-brand px-5 py-2.5 text-[0.8rem] font-extrabold text-white transition-colors hover:bg-brand-hover disabled:opacity-60"
            >
              {working === "sync" || sync.state === "syncing" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="size-4" aria-hidden />
              )}
              {t("syncNow")}
            </button>
          </div>
        }
      >
        <div className="space-y-5">
          <dl className="grid grid-cols-2 gap-2.5 max-sm:grid-cols-1">
            <Fact
              label={t("syncConnection")}
              value={
                sync.online && sync.state !== "offline" ? (
                  <span className="inline-flex items-center gap-1.5 text-success">
                    <CheckCircle2 className="size-4" aria-hidden />
                    {sync.state === "auth" ? t("stateAuth") : t("stateOnline")}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-warning">
                    <WifiOff className="size-4" aria-hidden />
                    {t("stateOffline")}
                  </span>
                )
              }
            />
            <Fact label={t("syncTickets")} value={<span data-numeric>{sync.ticketCount}</span>} />
            <Fact label={t("syncLastPull")} value={when(sync.lastPullAt)} />
            <Fact label={t("syncLastPush")} value={when(sync.lastPushAt)} />
          </dl>

          {sync.lastError && (
            <p className="rounded-card border border-warning/30 bg-warning/8 px-3.5 py-2.5 text-[0.76rem] font-bold text-warning">
              {t("syncLastError")}{" "}
              <span dir="ltr" className="font-mono font-medium">
                {sync.lastError}
              </span>
            </p>
          )}

          {items === null ? (
            <p className="flex items-center gap-2 text-[0.8rem] font-bold text-muted">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {t("loading")}
            </p>
          ) : items.length === 0 ? (
            <p className="flex items-center gap-2 rounded-card border border-success/30 bg-success/6 px-4 py-3 text-[0.82rem] font-bold text-success">
              <CheckCircle2 className="size-4" aria-hidden />
              {t("outboxEmpty")}
            </p>
          ) : (
            <>
              {failed.length > 0 && (
                <OutboxList
                  title={t("outboxFailed", { count: failed.length })}
                  tone="brand"
                  items={failed}
                  describe={describe}
                  when={when}
                  working={working}
                  onOpen={(item) => {
                    onClose();
                    openTicket(item.ticketId);
                  }}
                  onRetry={(item) => void retry(item)}
                  onDiscard={(item) => setConfirm({ kind: "discard", item })}
                />
              )}
              {pending.length > 0 && (
                <OutboxList
                  title={t(sync.online ? "outboxPending" : "outboxPendingOffline", { count: pending.length })}
                  tone="info"
                  items={pending}
                  describe={describe}
                  when={when}
                  working={working}
                  onOpen={(item) => {
                    onClose();
                    openTicket(item.ticketId);
                  }}
                  onDiscard={(item) => setConfirm({ kind: "discard", item })}
                />
              )}
            </>
          )}
        </div>
      </EntityDialog>

      <ConfirmDialog
        open={confirm?.kind === "discard"}
        title={t("discardTitle")}
        body={
          confirm?.kind === "discard"
            ? confirm.item.kind === "create"
              ? t("discardCreateBody", { code: confirm.item.ticketCode })
              : t("discardBody", { code: confirm.item.ticketCode })
            : undefined
        }
        confirmLabel={t("discard")}
        cancelLabel={t("cancel")}
        pending={typeof working === "number"}
        onConfirm={() => confirm?.kind === "discard" && void discard(confirm.item)}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm?.kind === "redownload"}
        title={t("redownloadTitle")}
        body={pending.length + failed.length > 0 ? t("redownloadBodyPending", { count: pending.length + failed.length }) : t("redownloadBody")}
        confirmLabel={t("redownload")}
        cancelLabel={t("cancel")}
        tone="normal"
        onConfirm={() => void redownload()}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-canvas px-3.5 py-2.5">
      <dt className="text-[0.68rem] font-bold text-muted">{label}</dt>
      <dd className="mt-0.5 text-[0.84rem] font-extrabold text-ink">{value}</dd>
    </div>
  );
}

function OutboxList({
  title,
  tone,
  items,
  describe,
  when,
  working,
  onOpen,
  onRetry,
  onDiscard,
}: {
  title: string;
  tone: "brand" | "info";
  items: OutboxItem[];
  describe: (item: OutboxItem) => string;
  when: (iso: string | null) => string;
  working: number | "sync" | "redownload" | null;
  onOpen: (item: OutboxItem) => void;
  onRetry?: (item: OutboxItem) => void;
  onDiscard: (item: OutboxItem) => void;
}) {
  const t = useTranslations("Desk");
  return (
    <section className="space-y-2">
      <h3 className={cn("flex items-center gap-2 text-[0.82rem] font-black", tone === "brand" ? "text-brand" : "text-ink")}>
        {tone === "brand" ? (
          <AlertTriangle className="size-4" aria-hidden />
        ) : (
          <CloudUpload className="size-4 text-info" aria-hidden />
        )}
        {title}
      </h3>
      <ul className="divide-y divide-line/70 overflow-hidden rounded-card border border-line">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 bg-surface px-3.5 py-2.5">
            <button
              type="button"
              onClick={() => onOpen(item)}
              className="min-w-0 flex-1 text-start"
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="rounded-chip bg-subtle px-2 py-0.5 text-[0.7rem] font-extrabold text-ink" data-numeric>
                  {item.ticketCode || "—"}
                </span>
                <span className="text-[0.8rem] font-extrabold text-ink">{t(KIND_LABEL[item.kind])}</span>
                {item.attempts > 0 && (
                  <span className="text-[0.68rem] font-bold text-muted">{t("attempts", { count: item.attempts })}</span>
                )}
              </span>
              <span className="mt-0.5 block truncate text-[0.74rem] font-medium text-muted">
                {describe(item)} · {when(item.createdAt)}
              </span>
              {item.error && (
                <span dir="ltr" className="mt-1 block truncate font-mono text-[0.68rem] text-brand">
                  {item.error}
                </span>
              )}
            </button>
            <span className="flex shrink-0 items-center gap-1">
              {onRetry && (
                <button
                  type="button"
                  onClick={() => onRetry(item)}
                  disabled={working !== null}
                  className="inline-flex items-center gap-1.5 rounded-control border border-line px-2.5 py-1.5 text-[0.72rem] font-extrabold text-ink transition-colors hover:border-brand hover:text-brand disabled:opacity-50"
                >
                  {working === item.id ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <RotateCcw className="size-3.5" aria-hidden />
                  )}
                  {t("retry")}
                </button>
              )}
              <button
                type="button"
                onClick={() => onDiscard(item)}
                disabled={working !== null}
                aria-label={t("discard")}
                title={t("discard")}
                className="inline-flex size-8 items-center justify-center rounded-control text-muted transition-colors hover:bg-brand/8 hover:text-brand disabled:opacity-50"
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

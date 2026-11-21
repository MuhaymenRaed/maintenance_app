"use client";

import { useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import {
  Banknote,
  ChevronDown,
  Cpu,
  Eye,
  HandCoins,
  ImageOff,
  ImagePlus,
  Loader2,
  MapPin,
  Pencil,
  PencilLine,
  RotateCcw,
  Phone,
  Printer,
  Receipt,
  ShieldCheck,
  Smartphone,
  Store,
  UserCheck,
  UserRound,
  UserX,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { StatusPill } from "@/components/account/status-pill";
import { OriginMark } from "@/components/admin/origin-mark";
import {
  EntityDialog,
  Field,
  input,
  NumberInput,
  Section,
  SelectField,
  MoneyInput,
} from "@/components/admin/form-kit";
import {
  ContactPanel,
  WhatsAppButton,
} from "@/components/admin/contact-actions";
import { DayRule } from "@/components/admin/day-rule";
import { RecordDelete } from "@/components/admin/record-delete";
import toast from "react-hot-toast";
import {
  RepairWarrantyDialog,
  TICKET_RUN,
  type RepairPrintFacts,
} from "@/components/admin/repair-print";
import { toRepairPrintFacts } from "@/lib/data/repair-print-facts";
import { isPrinting, printStation, startPrint } from "@/lib/print/station";
import { ImageLightbox } from "@/components/ui/image-lightbox";
import { addRepairPhotos, updateRepair } from "@/lib/actions/sections";
import { assignRepair, updateRepairFinance } from "@/lib/actions/repair-desk";
import { groupByDay } from "@/lib/data/queue-window";
import {
  repairMoney,
  repairTotal,
  settlesOnStatus,
  techMayMoveFrom,
  techMaySet,
  warrantyEnd,
  type DeskRank,
  type PaymentTerms,
} from "@/lib/data/repair-desk";
import { uploadPhotos } from "@/lib/upload";
import { REPAIR_FLOW } from "@/lib/data/orders";
import { StatusHistory } from "@/components/admin/status-history";
import { useStatusConfirm } from "@/components/admin/status-confirm";
import { useDeskGate, useGuardedAction } from "@/components/admin/desk-gate";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useEditConfirm } from "@/components/admin/edit-confirm";
import { TicketFaults } from "@/components/admin/fault-picker";
import type { RecentFault } from "@/lib/data/repair-faults";
import { windowStore } from "@/lib/windows/window-store";
import { statusTone, TONE_VAR } from "@/lib/data/status-tone";
import { formatPrice } from "@/lib/format";
import type { DeskRow } from "@/lib/queries/repair-desk";

type RepairCard = DeskRow;
import type { RepairStatus } from "@/lib/data/orders";
import { cn } from "@/lib/utils";
import { formatDayTime } from "@/lib/data/datetime";
import { liveDocument, OwnerDocumentProvider } from "@/lib/windows/owner-document";
import { DateField, formatFieldValue } from "@/components/ui/date-field";

/** Somebody a ticket may be handed to. */
export type DeskHolder = { id: string; name: string; rank: DeskRank };

/**
 * The repair bench.
 *
 * The busiest queue in the shop and the one with the most state: a ticket
 * carries a device, a fault list, a customer waiting on a price, a person it
 * belongs to, and photographs taken before and after.
 *
 * Eight statuses is too many for a row of buttons, so the flow is a stepper:
 * where the ticket is, and the one place it usually goes next.
 *
 * ---------------------------------------------------------------------------
 * Every row says what this reader may do to it
 * ---------------------------------------------------------------------------
 * `control` arrives on the row from the server, worked out once from who holds
 * the ticket: `full` is a manager's everything, `own` is a technician working a
 * ticket in their name, `none` is reading it. This board only decides what to
 * draw; the actions ask again and the database decides.
 */
export function RepairsBoard({
  rows: initial,
  holders,
  viewerId,
  manages,
  seesMoney,
  isTechnician,
  financeAvailable = false,
  warrantyAvailable = false,
  canDelete = false,
  showDays = false,
  todayDay,
  initialOpenId = null,
  flow = REPAIR_FLOW.filter((step) => step !== "waiting_parts" && step !== "work_done"),
  issues = [],
  recentFaults = [],
  faultsEditable = false,
}: {
  /** The bench's faults, for a manager changing a ticket's. */
  issues?: { code: string; name: string }[];
  /** The bench's faults by their last ticket, newest first. */
  recentFaults?: RecentFault[];
  /**
   * A ticket's faults can be changed after it is opened — false until
   * 20261116_repair_faults_editable.sql runs, and the faults are then read
   * only rather than an editor that every save refuses.
   */
  faultsEditable?: boolean;
  /**
   * The steps this deployment can store, in order — the page passes
   * `liveFlow(REPAIR_FLOW, …)`. Without 20261107_status_steps.sql
   * "waiting for parts" is not offered, because the database would refuse it.
   */
  flow?: readonly RepairStatus[];
  rows: RepairCard[];
  /** Who this reader may hand a ticket to. Empty for a technician. */
  holders: DeskHolder[];
  viewerId: string;
  /** Prints the card, and everything a ticket's `control` then allows. */
  manages: boolean;
  /** Never a technician. */
  seesMoney: boolean;
  isTechnician: boolean;
  /** `repair_ticket_finance` exists — the staff-only money can be saved. */
  financeAvailable?: boolean;
  /** `warranty_price` exists on this deployment. */
  warrantyAvailable?: boolean;
  /** `records.delete` — owner roles only. Absent, the control is not drawn. */
  canDelete?: boolean;
  /** Draw a rule where the day changes — the window spans more than today. */
  showDays?: boolean;
  /** Today's Baghdad day, from the server: the day rule, a warranty's first day. */
  todayDay: string;
  /**
   * `?open=<id>` — the dialog to open on arrival. A new-work alert links here,
   * so pressing it lands on the item rather than on a list to find it in.
   */
  initialOpenId?: string | null;
}) {
  const t = useTranslations("Admin");
  const tTrack = useTranslations("Track");
  const locale = useLocale();

  const [rows, setRows] = useState(initial);
  // A fresh read wins: after a save, a live update or a colleague's change the
  // server hands down new rows, and an edit made by somebody else must not sit
  // behind what this tab remembers. Set during render, not in an effect, so the
  // stale list is never painted.
  const [held, setHeld] = useState(initial);
  if (initial !== held) {
    setHeld(initial);
    setRows(initial);
  }
  /*
   * Every ticket open in a window, oldest first. Several at once is the point
   * — see `components/admin/app-window.tsx` — and a ticket already open is
   * brought to the front rather than opened a second time.
   *
   * `pinned` keeps the row each window was opened on, so a window survives a
   * filter that no longer lists its ticket: the reader changed what the list
   * shows, not what they were working on.
   */
  /*
   * ⚠️ An arrival by `?open=<id>` goes through the same door as a press. In
   * the desk app that is a Windows notification, the bell or the sync panel;
   * on the site, a staff alert. Where the desk's password is asked (the app,
   * signed in as the shop) the arrival opens the **short view**, and the
   * pencil asks from there. It used to fill `openIds` directly, which put
   * the full editor on screen without the password — found by a security
   * review, 2026-11-17. Where nothing is asked (the site, a technician's app)
   * it opens the editor, as it always did.
   */
  const arriveInEditor = !useDeskGate().required;
  const [openIds, setOpenIds] = useState<string[]>(initialOpenId && arriveInEditor ? [initialOpenId] : []);
  const [pinned, setPinned] = useState<Record<string, RepairCard>>({});
  /**
   * The ticket whose short view is open. A press anywhere on a row opens it —
   * the device, the customer and the price, nothing to change — and the full
   * editor is the pencil (the shop, 2026-11-17).
   */
  const [quickId, setQuickId] = useState<string | null>(initialOpenId && !arriveInEditor ? initialOpenId : null);
  /*
   * The board is no longer remounted by a filter change (its windows would go
   * with it), so a later `?open=<id>` — a staff alert pressed while the board
   * is already on screen — has to be heard here, during render.
   */
  const [seenOpen, setSeenOpen] = useState(initialOpenId);
  if (initialOpenId !== seenOpen) {
    setSeenOpen(initialOpenId);
    if (initialOpenId && !arriveInEditor) {
      setQuickId(initialOpenId);
    } else if (initialOpenId && !openIds.includes(initialOpenId)) {
      setOpenIds([...openIds, initialOpenId]);
    }
  }
  const [error, setError] = useState<string | null>(null);
  const [warrantyId, setWarrantyId] = useState<string | null>(null);
  /** The window the warranty was asked for from, where its form opens. */
  const [warrantyFrom, setWarrantyFrom] = useState<Document | null>(null);
  /** The editor is behind the desk's password where there is one: the app. */
  const guard = useGuardedAction();
  /*
   * The print station's run — read only to show which ticket is printing. The
   * run itself lives in `lib/print/station.ts`, outside this board, so closing
   * the ticket or leaving the page cannot tear it out from under the printer.
   */
  const station = useSyncExternalStore(printStation.subscribe, printStation.snapshot, printStation.server);
  const [, startTransition] = useTransition();

  const openRows = openIds.flatMap((id) => {
    const row = rows.find((candidate) => candidate.id === id) ?? pinned[id];
    return row ? [row] : [];
  });
  const warrantyRow =
    rows.find((row) => row.id === warrantyId) ?? (warrantyId ? pinned[warrantyId] : undefined) ?? null;
  const quickRow = rows.find((row) => row.id === quickId) ?? null;

  function openTicket(row: RepairCard) {
    if (openIds.includes(row.id)) {
      windowStore.focus(`repair:${row.id}`);
      return;
    }
    setPinned((current) => ({ ...current, [row.id]: row }));
    setOpenIds((current) => [...current, row.id]);
  }

  /**
   * The full editor. In the desktop app it asks for the desk's password first,
   * every time (`components/admin/desk-gate.tsx`); on the site, and for a
   * technician's own app, it opens at once.
   */
  function editTicket(row: RepairCard) {
    // Already open: bring it forward — never a second window on one ticket,
    // and no password asked again for a window already unlocked.
    if (openIds.includes(row.id)) {
      setQuickId(null);
      windowStore.focus(`repair:${row.id}`);
      return;
    }
    guard.run("edit", () => {
      setQuickId(null);
      openTicket(row);
    });
  }

  /**
   * One ticket, one window (the shop, 2026-11-18): a press on a row whose
   * editor is already open brings that editor forward instead of opening the
   * short view beside it.
   */
  function viewTicket(row: RepairCard) {
    if (openIds.includes(row.id)) {
      windowStore.focus(`repair:${row.id}`);
      return;
    }
    setQuickId(row.id);
  }

  function closeTicket(id: string) {
    setOpenIds((current) => current.filter((candidate) => candidate !== id));
    setPinned((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  /**
   * One press: both receipts to the A5 printer, then the label to the label
   * printer — no dialog on a PC running the print agent, the browser's dialog on
   * one without. The station reads the ticket fresh before printing, so the facts
   * here are only what the dialog path falls back to.
   *
   * The date on the paper is stamped by the press — reading the clock during
   * render is impure, and it is when the desk asked for it.
   */
  function printTicket(row: RepairCard, printedAt: number, from: Document) {
    const started = startPrint({
      ticketId: row.id,
      facts: printFacts(row),
      printedAt,
      papers: TICKET_RUN,
      locale,
      from,
    });
    if (started === "busy") toast(t("psBusy"));
  }
  const printingCode = station.run && isPrinting() ? station.run.code : null;

  function patch(id: string, next: Partial<RepairCard>) {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...next } : row)),
    );
    setPinned((current) =>
      current[id] ? { ...current, [id]: { ...current[id], ...next } } : current,
    );
  }

  /** Optimistic, reverted in place from the snapshot taken before the call. */
  function apply(
    id: string,
    next: Partial<RepairCard>,
    send: () => Promise<{ ok: boolean; error?: string }>,
  ) {
    const before = rows.find((row) => row.id === id) ?? pinned[id];
    if (!before) return;
    setError(null);
    patch(id, next);
    startTransition(async () => {
      const result = await send();
      if (!result.ok) {
        patch(id, before);
        setError(result.error ?? "updateFailed");
      }
    });
  }

  return (
    <div className="space-y-3">
      {error && (
        <p
          role="alert"
          className="rounded-card bg-brand/10 px-4 py-2.5 text-[0.8rem] font-bold text-brand"
        >
          {t.has(error) ? t(error as "updateFailed") : t("updateFailed")}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="rounded-panel border border-dashed border-line px-6 py-16 text-center text-[0.9rem] font-bold text-muted">
          {t("noData")}
        </p>
      ) : (
        <div className="space-y-2.5">
          {groupByDay(rows, (row) => row.createdAt).map((group) => (
          <section key={group.day} className="space-y-2.5">
          {showDays && (
            <DayRule
              day={group.day}
              locale={locale}
              count={t("dayCount", { count: group.rows.length })}
              todayDay={todayDay}
              todayLabel={t("dayToday")}
              yesterdayLabel={t("dayYesterday")}
            />
          )}
        <ul className="space-y-2.5">
          {group.rows.map((row) => {
            const price = repairCost(row);
            const faults = [...row.issues, ...row.customFaults];
            // Cash or deferred, and what is still owed — the desk's own
            // bookkeeping, never shown to the customer or a technician.
            const owes =
              seesMoney && financeAvailable
                ? repairMoney({
                    price: row.price,
                    warranty: row.warrantyPrice,
                    cost: row.costPrice,
                    collected: row.collected,
                    terms: row.paymentTerms,
                  }).remaining
                : 0;
            return (
            <li key={row.id}>
              {/*
                ⚠️ Customer first — the shop, 2026-11-17: "the ticket row must
                show the name and the personal information of the client …
                from the ticket row all the needed information will be
                gathered". The counter rings a person, not a code, so the name
                and the number lead and are the largest things on the row; the
                device and its faults follow, and the ticket's own facts close
                it.
              */}
              <article className="relative flex items-stretch gap-3 rounded-panel border border-line bg-surface p-3 shadow-card transition-colors hover:border-brand/45 sm:gap-3.5 sm:p-3.5">
                <span
                  className="w-1.5 shrink-0 rounded-full"
                  style={{ background: TONE_VAR[statusTone(row.status)] }}
                  aria-hidden
                />

                {/* ⚠️ The row's button is a **stretched overlay**, not a wrapper,
                    so the controls at the end of the row can stay real buttons
                    beside it rather than nested inside it — a `<button>` inside
                    a `<button>` is unnested by the parser, and that is a
                    hydration error rather than a style bug. A press anywhere
                    on the row opens its short view; changing it is the pencil. */}
                <button
                  type="button"
                  onClick={() => viewTicket(row)}
                  aria-label={t("deskQuickOpen", { name: row.customerName, code: row.code })}
                  className="absolute inset-0 z-0 rounded-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                />

                <div className="pointer-events-none relative z-1 min-w-0 flex-1 space-y-1 text-start">
                  <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <UserRound className="size-4 shrink-0 text-muted" aria-hidden />
                      <span className="truncate text-[0.95rem] font-black text-ink">{row.customerName}</span>
                    </span>
                    {/* ⚠️ The gap is on the parent. On a `dir="ltr"` span
                        `ms-` resolves to that span's own start — the far side
                        of the number on an Arabic page — and the name ran
                        into it. */}
                    {row.customerPhone && (
                      <span className="inline-flex items-center gap-1 text-[0.8rem] font-bold text-ink">
                        <Phone className="size-3.5 shrink-0 text-muted" aria-hidden />
                        <span dir="ltr" data-numeric>
                          {row.customerPhone}
                        </span>
                      </span>
                    )}
                    {row.customerPhone2 && (
                      <span className="text-[0.74rem] font-semibold text-muted">
                        <span dir="ltr" data-numeric>
                          {row.customerPhone2}
                        </span>
                      </span>
                    )}
                  </p>

                  {/* Wraps rather than truncating the faults to «· ال…» beside a
                      long model name on a phone; the short view lists them all. */}
                  <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[0.82rem]">
                    {row.service === "software" ? (
                      <Cpu className="size-3.5 shrink-0 text-muted" aria-hidden />
                    ) : (
                      <Smartphone className="size-3.5 shrink-0 text-muted" aria-hidden />
                    )}
                    <span className="shrink-0 font-extrabold text-ink">{row.deviceModel}</span>
                    {faults.length > 0 && (
                      <span className="min-w-0 max-w-full truncate font-medium text-muted">· {faults.join("، ")}</span>
                    )}
                  </p>

                  <p className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <span className="text-[0.74rem] font-extrabold text-info" data-numeric>
                      {row.code}
                    </span>
                    <span className="text-[0.68rem] font-medium text-muted">
                      {formatDayTime(locale, row.createdAt)}
                    </span>
                    <OriginMark origin={row.origin} />
                    {/* Something it says was changed after it was opened —
                        what the «المعدّلة» tab lists (2026-11-18). */}
                    {row.editedAt && (
                      <span
                        title={t("deskEditedHint", { when: formatDayTime(locale, row.editedAt) })}
                        className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-chip bg-brand/10 px-1.5 py-0.5 text-[0.62rem] font-extrabold text-brand"
                      >
                        <PencilLine className="size-3" aria-hidden />
                        {t("deskEditedMark")}
                      </span>
                    )}
                    {!isTechnician && <HolderChip row={row} viewerId={viewerId} />}
                    {seesMoney && financeAvailable && (
                      <TermsChip
                        terms={row.paymentTerms}
                        remaining={owes}
                        cashLabel={t("termsCash")}
                        deferredLabel={t("termsDeferred")}
                      />
                    )}
                    {seesMoney && (row.warrantyPrice ?? 0) > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-chip bg-info/10 px-2 py-0.5 text-[0.64rem] font-extrabold text-info">
                        <ShieldCheck className="size-3" aria-hidden />
                        {t("warrantyTitle")} <span data-numeric>{formatPrice(row.warrantyPrice!)}</span>
                      </span>
                    )}
                    {/* What is still missing from the ticket's money, in words
                        (the shop, 2026-11-20): a purchase price nobody typed —
                        the figures count it as zero — and, on a deferred
                        ticket, what was paid. */}
                    {seesMoney && financeAvailable && row.status !== "cancelled" && price != null && row.costPrice == null && (
                      <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-chip border border-dashed border-warning/60 px-1.5 py-0.5 text-[0.62rem] font-extrabold text-warning">
                        <Receipt className="size-3" aria-hidden />
                        {t("deskNoCostMark")}
                      </span>
                    )}
                    {seesMoney && financeAvailable && row.status !== "cancelled" && row.paymentTerms === "deferred" && row.collected == null && (
                      <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-chip border border-dashed border-warning/60 px-1.5 py-0.5 text-[0.62rem] font-extrabold text-warning">
                        <HandCoins className="size-3" aria-hidden />
                        {t("deskNoCollectedMark")}
                      </span>
                    )}
                    {/* «راجع» — its money changed in the period on a later day
                        than it was opened (the shop, 2026-11-21): counted on
                        the day of the change, its own day left as it was. */}
                    {seesMoney && row.returned && (
                      <span
                        title={t("deskReturnedHint", {
                          opened: formatDayTime(locale, row.createdAt),
                          when: formatDayTime(locale, row.returned.at),
                        })}
                        className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-chip bg-gold/15 px-1.5 py-0.5 text-[0.62rem] font-extrabold text-gold-ink"
                      >
                        <RotateCcw className="size-3" aria-hidden />
                        {t(row.returned.price < 0 || (row.returned.price === 0 && row.returned.base < 0) ? "deskReturnedMarkDown" : "deskReturnedMarkUp")}{" "}
                        <span
                          data-numeric
                          className={row.returned.price < 0 ? "text-brand" : row.returned.price > 0 ? "text-success" : undefined}
                        >
                          {row.returned.price > 0 ? "+" : row.returned.price < 0 ? "-" : ""}
                          {formatPrice(Math.abs(row.returned.price))}
                        </span>
                      </span>
                    )}
                    {/* Opened on an earlier day, on today's list because its
                        money came in today (the shop, 2026-11-20). */}
                    {seesMoney && row.paidWithin != null && row.paidWithin !== 0 && (
                      <span
                        title={t("deskOpenedOn", { when: formatDayTime(locale, row.createdAt) })}
                        className={cn(
                          "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-chip px-1.5 py-0.5 text-[0.62rem] font-extrabold",
                          row.paidWithin > 0 ? "bg-success/12 text-success" : "bg-brand/10 text-brand",
                        )}
                      >
                        <Banknote className="size-3" aria-hidden />
                        {/* A refund — a cancellation of an earlier day's ticket (2026-11-21). */}
                        {row.paidWithin > 0 ? t("deskPaidHereMark") : t("deskRefundedHereMark")}{" "}
                        <span data-numeric>
                          {row.paidWithin < 0 && "-"}
                          {formatPrice(Math.abs(row.paidWithin))}
                        </span>
                      </span>
                    )}
                  </p>
                </div>

                <div className="relative z-1 flex shrink-0 flex-col items-end justify-between gap-2">
                  <span className="pointer-events-none flex flex-col items-end gap-1">
                    <StatusPill
                      status={row.status}
                      label={tTrack(`status_${row.status}` as "status_received")}
                    />
                    {price != null && (
                      <span className="text-[0.95rem] font-black text-brand" data-numeric>
                        {formatPrice(price)}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-1.5">
                    {/* Ringing the customer is the most common thing anyone does
                        from this queue, so it does not cost opening the ticket.
                        Absent where the number was not sent to this reader. */}
                    {row.customerPhone && (
                      <WhatsAppButton
                        phone={row.customerPhone}
                        message={repairMessage(
                          row,
                          t,
                          tTrack(`status_${row.status}` as "status_received"),
                        )}
                        label={`${t("whatsappContact")} — ${row.customerName}`}
                        variant="icon"
                      />
                    )}
                    {manages && (
                      <button
                        type="button"
                        onClick={(event) => printTicket(row, Date.now(), event.currentTarget.ownerDocument)}
                        disabled={printingCode !== null}
                        aria-busy={printingCode === row.code}
                        aria-label={`${t("deskPrint")} — ${row.code}`}
                        title={t("deskPrint")}
                        className="press flex size-9 shrink-0 items-center justify-center rounded-control border border-line text-muted transition-colors hover:border-brand hover:text-brand disabled:cursor-wait disabled:opacity-60"
                      >
                        {printingCode === row.code ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden />
                        ) : (
                          <Printer className="size-4" aria-hidden />
                        )}
                      </button>
                    )}
                    {/* The full editor — beside WhatsApp and print, the shop's
                        own placement. Absent where this reader may change
                        nothing on the ticket; the short view still opens. */}
                    {row.control !== "none" && (
                      <button
                        type="button"
                        onClick={() => editTicket(row)}
                        aria-label={`${t("deskEditTicket")} — ${row.code}`}
                        title={t("deskEditTicket")}
                        className="press flex size-9 shrink-0 items-center justify-center rounded-control border border-brand/40 bg-brand/8 text-brand transition-colors hover:bg-brand hover:text-white"
                      >
                        <Pencil className="size-4" aria-hidden />
                      </button>
                    )}
                  </span>
                </div>
              </article>
            </li>
            );
          })}
        </ul>
          </section>
          ))}
        </div>
      )}

      {openRows.map((open) =>
        // A technician gets his own editor: the status within his steps, and
        // the device, the customer and the price to read — nothing else.
        isTechnician ? (
          <TechTicketDialog
            key={open.id}
            windowId={`repair:${open.id}`}
            repair={open}
            flow={flow}
            error={error}
            onClose={() => closeTicket(open.id)}
            onApply={(next, send) => apply(open.id, next, send)}
          />
        ) : (
        <RepairDialog
          key={open.id}
          windowId={`repair:${open.id}`}
          repair={open}
          flow={flow}
          holders={holders}
          viewerId={viewerId}
          manages={manages}
          seesMoney={seesMoney}
          isTechnician={isTechnician}
          financeAvailable={financeAvailable}
          warrantyAvailable={warrantyAvailable}
          canDelete={canDelete}
          error={error}
          issues={issues}
          recentFaults={recentFaults}
          faultsEditable={faultsEditable}
          onPatch={(next) => patch(open.id, next)}
          onClose={() => closeTicket(open.id)}
          onApply={(next, send) => apply(open.id, next, send)}
          onPrint={(from) => printTicket(open, Date.now(), from)}
          printing={printingCode !== null}
          onWarranty={(from) => {
            setWarrantyId(open.id);
            setWarrantyFrom(from);
          }}
          onDeleted={() => {
            /*
             * The row and the dialog go on the same frame — see the note on
             * the orders board.
             *
             * ⚠️ `held` is deliberately **not** touched. It holds the *props*
             * this board last saw, and the "a fresh read wins" check above is
             * `initial !== held` by reference — so writing a filtered copy
             * into it would make that comparison true on the very next
             * render and restore `initial`, putting the deleted ticket
             * straight back. Leaving it alone keeps the check false until the
             * server genuinely hands down a new list, which by then no longer
             * contains the row.
             */
            setRows((current) => current.filter((row) => row.id !== open.id));
            closeTicket(open.id);
          }}
        />
        ),
      )}

      {quickRow && (
        <RepairQuickView
          repair={quickRow}
          seesMoney={seesMoney}
          onClose={() => setQuickId(null)}
          onEdit={quickRow.control !== "none" ? () => editTicket(quickRow) : undefined}
        />
      )}
      {guard.prompt}

      {warrantyRow && (
        <OwnerDocumentProvider document={liveDocument(warrantyFrom)}>
          <RepairWarrantyDialog
            facts={printFacts(warrantyRow)}
            ticketId={warrantyRow.id}
            canEdit={warrantyRow.control === "full"}
            warrantyAvailable={warrantyAvailable}
            today={todayDay}
            onClose={() => setWarrantyId(null)}
          />
        </OwnerDocumentProvider>
      )}
    </div>
  );
}

/* ---------------------------- shared wording ---------------------------- */

/** What the papers print, from one ticket — the mapping every printer of a ticket shares. */
function printFacts(row: RepairCard): RepairPrintFacts {
  return toRepairPrintFacts({
    code: row.code,
    customerName: row.customerName,
    deviceModel: row.deviceModel,
    issues: row.issues,
    customFaults: row.customFaults,
    price: row.price,
    warrantyPrice: row.warrantyPrice,
    costPrice: row.costPrice,
    collected: row.collected,
    paymentTerms: row.paymentTerms,
    createdAt: row.createdAt,
    warrantyDays: row.warrantyDays,
    warrantyStart: row.warrantyStart,
  });
}

/**
 * Who holds a ticket, by name — the person the counter handed it to (the shop,
 * 2026-11-18: "the guy the card is assigned to must be shown to managers by his
 * name"). A disc with their initial and the name beside it; the reader's own
 * tickets say «لك» in the brand colour; nobody is a dashed «غير مسند».
 *
 * ⚠️ No timer and no «مؤقتاً»: nothing is timed, and the word read as a ticket
 * that would move on by itself. A technician is not shown it at all — every
 * ticket on his list is his.
 */
function HolderChip({ row, viewerId }: { row: RepairCard; viewerId: string }) {
  const t = useTranslations("Admin");
  if (!row.holderId) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-chip border border-dashed border-line-strong px-2 py-0.5 text-[0.64rem] font-extrabold text-muted">
        <UserX className="size-3 shrink-0" aria-hidden />
        {t("unassigned")}
      </span>
    );
  }
  const mine = row.holderId === viewerId;
  const name = row.holderName ?? t("workColleague");
  const initial = Array.from(name.trim())[0] ?? "؟";
  return (
    <span
      title={t("deskHeldBy", { name })}
      className={cn(
        "inline-flex min-w-0 max-w-56 items-center gap-1.5 rounded-full py-0.5 ps-0.5 pe-2.5 text-[0.66rem] font-extrabold",
        mine ? "bg-brand/10 text-brand" : "bg-info/10 text-ink",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-[1.15rem] shrink-0 items-center justify-center rounded-full text-[0.6rem] font-black text-white",
          mine ? "bg-brand" : row.holderRank === "technician" ? "bg-success" : "bg-info",
        )}
      >
        {mine ? <UserCheck className="size-2.5" /> : initial}
      </span>
      <span className="truncate">{mine ? t("workMine") : name}</span>
    </span>
  );
}

/** نقد / آجل on the row, with what is still owed when anything is. */
function TermsChip({
  terms,
  remaining,
  cashLabel,
  deferredLabel,
}: {
  terms: PaymentTerms;
  remaining: number;
  cashLabel: string;
  deferredLabel: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-chip px-2 py-0.5 text-[0.64rem] font-extrabold",
        terms === "deferred" ? "bg-warning/12 text-warning" : "bg-success/10 text-success",
        // Still owing: the one chip on the row that asks for something.
        terms === "deferred" && remaining > 0 && "ring-1 ring-warning/60",
      )}
    >
      {terms === "deferred" && remaining > 0 && <HandCoins className="size-3" aria-hidden />}
      {terms === "deferred" ? deferredLabel : cashLabel}
      {remaining > 0 && (
        <span data-numeric>· {formatPrice(remaining)}</span>
      )}
    </span>
  );
}

/** A worked-out figure in the money section — remaining, profit. */
function MoneyFact({
  label,
  value,
  tone,
  empty,
  hint,
}: {
  label: string;
  value: number | null;
  tone: "warning" | "success" | "brand" | "muted";
  empty?: string;
  /** What the figure is measured on, where the name alone cannot say it. */
  hint?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-card border px-3 py-2",
        tone === "warning" && "border-warning/40 bg-warning/6",
        tone === "success" && "border-success/35 bg-success/6",
        tone === "brand" && "border-brand/35 bg-brand/6",
        tone === "muted" && "border-line bg-subtle",
      )}
    >
      <dt className="text-[0.68rem] font-bold text-muted">{label}</dt>
      <dd
        className={cn(
          "text-[1rem] font-black",
          tone === "warning" && "text-warning",
          tone === "success" && "text-success",
          tone === "brand" && "text-brand",
          tone === "muted" && "text-muted",
        )}
      >
        {value == null ? (
          <span className="text-[0.74rem] font-bold">{empty}</span>
        ) : (
          <span data-numeric>{formatPrice(value)}</span>
        )}
      </dd>
      {hint && <p className="mt-0.5 text-[0.64rem] font-bold leading-tight text-muted">{hint}</p>}
    </div>
  );
}

/**
 * What the repair comes to: the figure the bench entered, or — for a ticket
 * written before the quote step was removed (2026-10-26) — the figure it was
 * quoted. The same `coalesce(actual_cost, quote_amount)` `pay_repair` settles,
 * so the board, the tracker and the till can never show three numbers.
 */
function repairCost(repair: RepairCard): number | null {
  return repair.actualCost ?? repair.quoteAmount ?? null;
}
/**
 * One submitted fact.
 *
 * A `<dl>` rather than stacked `<div>`s so a screen reader announces
 * "Appointment: Tuesday 15:30" as one thing. `wide` spans both columns for the
 * two fields that are prose — the problem the customer described and a street
 * address — because wrapping those into a half-width column turns four words
 * into four lines.
 *
 * ⚠️ `data-numeric` wraps the *value*, never the `<dd>`: it sets
 * `direction: ltr` and `display: inline-block`, so on a block it shrink-wraps
 * and on an Arabic sentence it drags the full stop to the wrong edge.
 */
function Fact({
  label,
  value,
  numeric,
  wide,
}: {
  label: string;
  value: string;
  numeric?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={cn("min-w-0", wide && "sm:col-span-2")}>
      <dt className="text-[0.68rem] font-bold text-muted">{label}</dt>
      <dd className="text-[0.82rem] font-bold leading-snug text-ink">
        {numeric ? <span data-numeric>{value}</span> : value}
      </dd>
    </div>
  );
}

/**
 * What the customer is about to read: the ticket's status, built from the row
 * rather than typed so the code is the one on the ticket, and pre-filled
 * rather than sent — see `contact-actions.tsx`.
 */
function repairMessage(
  repair: RepairCard,
  t: ReturnType<typeof useTranslations<"Admin">>,
  statusLabel: string,
): string {
  return t("waRepair", {
    name: repair.customerName,
    code: repair.code,
    device: repair.deviceModel,
    status: statusLabel,
  });
}

/* ------------------------------ the ticket ------------------------------- */

function RepairDialog({
  windowId,
  repair,
  flow,
  holders,
  viewerId,
  manages,
  seesMoney,
  isTechnician,
  financeAvailable,
  warrantyAvailable,
  canDelete,
  error,
  issues,
  recentFaults,
  faultsEditable,
  onPatch,
  onClose,
  onApply,
  onPrint,
  printing,
  onWarranty,
  onDeleted,
}: {
  windowId: string;
  issues: { code: string; name: string }[];
  recentFaults: RecentFault[];
  faultsEditable: boolean;
  /** Writes what the database answered onto the board's row. */
  onPatch: (next: Partial<RepairCard>) => void;
  repair: RepairCard;
  flow: readonly RepairStatus[];
  holders: DeskHolder[];
  viewerId: string;
  manages: boolean;
  seesMoney: boolean;
  isTechnician: boolean;
  financeAvailable: boolean;
  warrantyAvailable: boolean;
  canDelete: boolean;
  /** A refused save, drawn inside the dialog — the board's copy is behind it. */
  error: string | null;
  onClose: () => void;
  onApply: (
    next: Partial<RepairCard>,
    send: () => Promise<{ ok: boolean; error?: string }>,
  ) => void;
  /** Takes the document the press was made in, so the print reports there. */
  onPrint: (from: Document) => void;
  /** A print run is going; the button waits rather than starting a second. */
  printing: boolean;
  /** Opens the warranty paper, which asks for a length and a start date. */
  onWarranty: (from: Document) => void;
  onDeleted: () => void;
}) {
  const t = useTranslations("Admin");
  const tTrack = useTranslations("Track");
  const tRepair = useTranslations("Repair");
  const locale = useLocale();

  /** A manager's everything. */
  const full = repair.control === "full";
  /** A manager, or a technician on a ticket in their own name. */
  const handles = repair.control !== "none";

  // `quote_notes` is the column, and it has always been the one note the
  // customer reads on their ticket — so it is what became of the device, now
  // that there is no quote for it to accompany.
  const [note, setNote] = useState(repair.quoteNotes ?? "");
  const [base, setBase] = useState<number | null>(repair.basePrice);
  const [warranty, setWarranty] = useState<number | null>(repair.warrantyPrice);
  const [warrantyDays, setWarrantyDays] = useState<number | null>(repair.warrantyDays);
  const [warrantyStart, setWarrantyStart] = useState(repair.warrantyStart ?? "");
  const [costPrice, setCostPrice] = useState<number | null>(repair.costPrice);
  const [collected, setCollected] = useState<number | null>(repair.collected);
  const total = repairTotal(base, warranty);
  const money = repairMoney({
    price: total,
    warranty,
    cost: costPrice,
    collected,
    terms: repair.paymentTerms,
  });
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState<{
    urls: string[];
    at: number;
  } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const step = flow.indexOf(repair.status);
  const statusLabel = tTrack(`status_${repair.status}` as "status_received");
  const rankLabel = (rank: DeskRank) => t(`rank_${rank}`);
  /** Asked before any status moves — see `status-confirm.tsx`. */
  const confirm = useStatusConfirm();
  /**
   * Asked before any edit inside the ticket is saved — see `edit-confirm.tsx`.
   * Every field below goes through `askEdit`; «تراجع» puts it back.
   */
  const edits = useEditConfirm();
  const shown = (value: number | null | undefined) => (value == null ? t("editEmpty") : formatPrice(value));
  function askEdit(field: string, from: string, to: string, run: () => void, revert?: () => void) {
    edits.request({ subject: repair.code, field, from, to, run, revert });
  }
  /** The fee is required; clearing it is refused rather than saved. */
  const [priceMissing, setPriceMissing] = useState(false);
  /** Folded until asked for — the shop, 2026-11-17. A summary shows on the fold. */
  const [warrantyOpen, setWarrantyOpen] = useState(false);
  /** «تسديد الباقي» asks once before it records money. */
  const [payingRest, setPayingRest] = useState(false);

  function moveTo(status: RepairStatus) {
    // «تم التسليم» on a deferred ticket settles what it still owes — the
    // shop's rule of 2026-11-17 (`settlesOnStatus`). Said in the confirm, and
    // drawn on the frame the move lands; the server writes it after the
    // status, so a move that fails leaves the ticket owing.
    const settles =
      full &&
      financeAvailable &&
      total != null &&
      money.remaining > 0 &&
      settlesOnStatus(status, repair.paymentTerms);
    confirm.request({
      subject: repair.code,
      from: { key: repair.status, label: statusLabel },
      to: { key: status, label: tTrack(`status_${status}` as "status_received") },
      note:
        status === "cancelled"
          ? t("statusConfirmCancelRepair")
          : settles
            ? t("deskSettleOnDelivery", { amount: formatPrice(money.remaining) })
            : undefined,
      run: () => {
        if (settles) setCollected(total);
        onApply(settles ? { status, collected: total } : { status }, () =>
          updateRepair(repair.id, { status }),
        );
      },
    });
  }

  /** Fills «الباقي» in one press, instead of retyping «الواصل» as the total. */
  function payRest() {
    if (total == null) return;
    setCollected(total);
    onApply({ collected: total }, () => updateRepairFinance(repair.id, { collected: total }));
  }

  const profitFact = (
    <MoneyFact
      label={t("financeProfit")}
      value={money.settled ? money.profit : null}
      tone={money.profit == null || !money.settled ? "muted" : money.profit < 0 ? "brand" : "success"}
      empty={money.settled ? t("financeNoCost") : t("financeProfitWaits")}
      hint={money.warranty > 0 ? t("financeProfitHint") : undefined}
    />
  );

  function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    void (async () => {
      const urls = await uploadPhotos(Array.from(files), "repair");
      setUploading(false);
      if (urls.length === 0) return;
      onApply({ photosAfter: [...repair.photosAfter, ...urls] }, () =>
        addRepairPhotos(repair.id, urls),
      );
    })();
  }

  function assign(value: string) {
    const holderId = value || null;
    const person = holders.find((holder) => holder.id === holderId);
    onApply(
      {
        holderId,
        holderName: person?.name ?? null,
        holderRank: person?.rank ?? null,
        technicianName: person?.name ?? null,
      },
      () => assignRepair(repair.id, holderId),
    );
  }

  // Whoever holds it stays in the list even if they have left this reader's
  // reach, or the picker would show nothing and read as nobody holding it.
  const holderOptions = [
    { value: "", label: t("unassigned") },
    ...holders.map((holder) => ({
      value: holder.id,
      label:
        holder.id === viewerId
          ? t("deskAssignSelf", { rank: rankLabel(holder.rank) })
          : `${holder.name} — ${rankLabel(holder.rank)}`,
    })),
    ...(repair.holderId && !holders.some((holder) => holder.id === repair.holderId)
      ? [{ value: repair.holderId, label: repair.holderName ?? t("workColleague") }]
      : []),
  ];

  return (
    <>
      <EntityDialog
        // A programming job is not a repair — "مركز الصيانة" over a system
        // install read as the wrong desk.
        windowId={windowId}
        title={`${repair.service === "software" ? t("programmingJob") : tRepair("title")} · ${repair.code}`}
        subtitle={repair.deviceModel}
        closeLabel={t("close")}
        onClose={onClose}
        width={660}
        // A window of its own on the desktop, which stays when the dashboard
        // is minimised — the shop's instruction of 2026-11-17.
        detach
        accent={TONE_VAR[statusTone(repair.status)]}
        footer={
          <>
            <p className="text-[0.72rem] font-medium text-muted">
              {formatDayTime(locale, repair.createdAt)}
            </p>
            {/* ⚠️ On the far side of the footer from "print" and "WhatsApp",
                which are the two controls pressed on nearly every ticket. A
                destructive control next to a routine one is how a mis-click
                becomes a deleted record. Owners only, and absent otherwise. */}
            <RecordDelete
              kind="repair"
              id={repair.id}
              label={repair.code}
              canDelete={canDelete}
              onDeleted={onDeleted}
            />
            <div className="ms-auto flex items-center gap-2">
              {manages && (
                <>
                  {/* One press: the customer's two receipts, then the label.
                      The warranty is the one paper that asks a question, so
                      it keeps a control of its own. */}
                  <button
                    type="button"
                    onClick={(event) => onPrint(event.currentTarget.ownerDocument)}
                    disabled={printing}
                    aria-busy={printing}
                    className="press inline-flex items-center gap-2 rounded-control border border-line px-3.5 py-2 text-[0.78rem] font-extrabold text-ink transition-colors hover:border-brand hover:text-brand disabled:cursor-wait disabled:opacity-60"
                  >
                    {printing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Printer className="size-4" aria-hidden />}
                    {t("deskPrint")}
                  </button>
                  <button
                    type="button"
                    onClick={(event) => onWarranty(event.currentTarget.ownerDocument)}
                    className="press inline-flex items-center gap-2 rounded-control border border-line px-3.5 py-2 text-[0.78rem] font-extrabold text-ink transition-colors hover:border-info hover:text-info"
                  >
                    <ShieldCheck className="size-4" aria-hidden />
                    {t("printWarrantyPaper")}
                  </button>
                </>
              )}
              {repair.customerPhone && (
                <WhatsAppButton
                  phone={repair.customerPhone}
                  message={repairMessage(repair, t, statusLabel)}
                  label={t("whatsappContact")}
                />
              )}
            </div>
          </>
        }
      >
        {error && (
          <p role="alert" className="rounded-card bg-brand/10 px-3.5 py-2.5 text-[0.78rem] font-bold text-brand">
            {t.has(error) ? t(error as "updateFailed") : t("updateFailed")}
          </p>
        )}

        {/* A ticket this reader cannot change says so first, so the greyed
            controls below read as a decision and not as a fault. */}
        {!handles && (
          <p className="flex items-center gap-2 rounded-card border border-line bg-subtle px-3.5 py-2.5 text-[0.78rem] font-bold text-muted">
            <Eye className="size-4 shrink-0" aria-hidden />
            {t(isTechnician ? "deskReadOnlyTech" : "deskReadOnlyManager")}
          </p>
        )}

        {/*
          Who holds it. A manager hands a ticket to anybody in reach, to
          themselves included, and moves it again at any time; nothing here is
          automatic and nobody takes one. Everybody else reads the name.
        */}
        <Section title={t("workTitle")} hint={full ? t("deskAssignChangeHint") : undefined}>
          {full ? (
            <Field label={t("deskHolder")}>
              <SelectField
                value={repair.holderId ?? ""}
                onChange={assign}
                options={holderOptions}
                ariaLabel={t("deskHolder")}
              />
            </Field>
          ) : (
            <HolderChip row={repair} viewerId={viewerId} />
          )}
        </Section>

        {/*
          What the customer actually sent, before anything staff can change.

          ⚠️ Every field below was already on `RepairCard` and none of it was on
          screen. The dialog opened straight onto the status stepper, so the
          person deciding what to do with a ticket could see where it was in the
          process and not *what was wrong with the phone* — the problem the
          customer typed, the slot they picked, which branch they are coming to,
          or the second number to try when the first does not answer. All of it
          was one query away and none of it was drawn.

          It goes first because it is what the reader came for. The controls
          below are what they do *after* reading it, and a form that opens on
          its own inputs asks somebody to decide before they have the facts.
        */}
        <Section title={t("repairSubmission")}>
          <dl className="grid gap-x-4 gap-y-2.5 sm:grid-cols-2">
            <Fact label={t("repairDevice")} value={repair.deviceModel} />
            {/* Whoever runs the ticket changes its faults here, in place — a
                second fault found on the bench belongs on this ticket, not on
                a new one. Everybody else reads them. */}
            {full && faultsEditable ? (
              <div className="min-w-0 sm:col-span-2">
                <dt className="mb-1 text-[0.68rem] font-bold text-muted">{t("repairIssues")}</dt>
                <dd>
                  <TicketFaults
                    repair={repair}
                    issues={issues}
                    recent={recentFaults}
                    onPatch={onPatch}
                  />
                </dd>
              </div>
            ) : (
              <>
                {repair.issues.length > 0 && (
                  <Fact
                    label={t("repairIssues")}
                    value={repair.issues.join(" · ")}
                  />
                )}
                {repair.customFaults.length > 0 && (
                  <Fact
                    label={t("repairCustomIssues")}
                    value={repair.customFaults.join(" · ")}
                  />
                )}
              </>
            )}
            {repair.notes && (
              <Fact
                label={t("repairProblem")}
                value={repair.notes}
                wide
              />
            )}
            {repair.preferredAt && (
              <Fact
                label={t("repairAppointment")}
                numeric
                value={formatDayTime(locale, repair.preferredAt)}
              />
            )}
            {repair.branchName && (
              <Fact label={t("repairBranch")} value={repair.branchName} />
            )}
            {repair.addressLine && (
              <Fact label={t("repairAddress")} value={repair.addressLine} wide />
            )}
            <Fact label={t("repairCustomer")} value={repair.customerName} />
            {repair.customerPhone && (
              <Fact
                label={t("repairPhone")}
                value={repair.customerPhone}
                numeric
              />
            )}
            {repair.customerPhone2 && (
              <Fact
                label={t("repairPhoneAlt")}
                value={repair.customerPhone2}
                numeric
              />
            )}
          </dl>
        </Section>

        {/*
          Where the ticket is, and anywhere it needs to go.

          ── ⚠️ Every step is reachable, deliberately ──

          This used to be `Math.abs(index - step) === 1` — only the immediate
          neighbours were enabled, on the reasoning that a ticket does not jump
          from "received" to "ready". True of the happy path and wrong as a
          *rule*, because the bench does not only move forwards:

          - A device marked "ready" that fails its final check has to go back to
            "in_repair", which is four steps back from "completed" and two from
            "ready".
          - A ticket advanced by a mis-click could only be undone one step per
            save, and not at all once two had stacked up.
          - `cancelled` is not in `REPAIR_FLOW`, so `step` was `-1` for a
            cancelled ticket and the only enabled button was "received" —
            reinstating a ticket meant walking it forward one save at a time.

          The stepper still *says* where the ticket is and which step is next;
          it simply no longer refuses the rest. Guidance, not a gate — the
          person holding the screwdriver knows more about the device than an
          array index does.
        */}
        <Section title={t("setStatus")} hint={handles ? t("setStatusHint") : undefined}>
          <ol className="flex flex-wrap gap-1.5">
            {flow.map((status, index) => {
              const active = repair.status === status;
              // The one the happy path goes to next. Marked, never enforced.
              const suggested = handles && index === step + 1;
              return (
                <li key={status}>
                  <button
                    type="button"
                    disabled={!handles || active}
                    onClick={() => moveTo(status)}
                    aria-current={active ? "step" : undefined}
                    className={cn(
                      "press rounded-control border px-2.5 py-1.5 text-[0.7rem] font-extrabold transition-colors",
                      active
                        ? "border-transparent text-white"
                        : suggested
                          ? "border-brand/60 text-brand hover:bg-brand/8"
                          : "border-line text-muted hover:border-brand hover:text-brand",
                      !handles && !active && "cursor-not-allowed opacity-45",
                    )}
                    style={
                      active
                        ? { background: TONE_VAR[statusTone(status)] }
                        : undefined
                    }
                  >
                    {tTrack(`status_${status}` as "status_received")}
                  </button>
                </li>
              );
            })}
            {/*
              The state that ends the story rather than sitting on the path,
              kept apart by a rule because drawing it in line would imply it
              is a step. `declined` went with the quote (2026-10-26): it was
              only ever the customer refusing a price.
            */}
            <li aria-hidden className="mx-1 w-px self-stretch bg-line" />
            {(["cancelled"] as const).map((status) => (
              <li key={status}>
                <button
                  type="button"
                  disabled={!handles || repair.status === status}
                  onClick={() => moveTo(status as RepairStatus)}
                  aria-current={repair.status === status ? "step" : undefined}
                  className={cn(
                    "press rounded-control border px-2.5 py-1.5 text-[0.7rem] font-extrabold transition-colors disabled:opacity-40",
                    repair.status === status
                      ? "border-transparent text-white disabled:opacity-100"
                      : "border-brand/35 text-brand hover:bg-brand/8",
                  )}
                  style={
                    repair.status === status
                      ? { background: TONE_VAR[statusTone(status)] }
                      : undefined
                  }
                >
                  {tTrack(`status_${status}` as "status_received")}
                </button>
              </li>
            ))}
          </ol>
        </Section>

        {/* How it got here, with when — the answer to "you told me it was
            ready on Tuesday". */}
        <StatusHistory
          kind="repair"
          id={repair.id}
          status={repair.status}
          label={(status) =>
            tTrack.has(`status_${status}`)
              ? tTrack(`status_${status}` as "status_received")
              : status
          }
        />

        {/* What the job comes to, and what became of the device. Both save on
            blur rather than per keystroke — a price is a decision, not a live
            figure. A technician types the price here and never sees what a
            manager adds to it. */}
        {handles ? (
          <Section title={t("repairCostTitle")} hint={t("repairCostHint")}>
            {/* A technician is never told about the warranty, so to them this
                is simply the amount. A manager reads it as the part before it. */}
            <Field label={`${t(seesMoney ? "financeBasePrice" : "financePrice")} *`}>
              <MoneyInput
                value={base}
                clearable
                onChange={(next) => {
                  setBase(next);
                  if (next != null && next > 0) setPriceMissing(false);
                }}
                onCommit={() => {
                  // ⚠️ Required: a ticket's fee can be changed, never emptied.
                  // An empty or zero fee is put back as it was and said so,
                  // rather than saved as a ticket that costs nothing.
                  if (base == null || base <= 0) {
                    if (repair.basePrice != null && repair.basePrice > 0) setBase(repair.basePrice);
                    setPriceMissing(true);
                    return;
                  }
                  if (base !== repair.basePrice) {
                    askEdit(
                      t(seesMoney ? "financeBasePrice" : "financePrice"),
                      shown(repair.basePrice),
                      shown(base),
                      () =>
                        onApply({ basePrice: base, actualCost: total, price: total }, () =>
                          updateRepair(repair.id, { price: base }),
                        ),
                      () => setBase(repair.basePrice),
                    );
                  }
                }}
                min={0}
              />
              {priceMissing && (
                <span role="alert" className="mt-1 block text-[0.72rem] font-bold text-brand">
                  {t("deskPriceRequired")}
                </span>
              )}
            </Field>
            <Field label={t("repairResult")}>
              <textarea
                rows={2}
                value={note}
                placeholder={t("repairResultPlaceholder")}
                onChange={(event) => setNote(event.target.value)}
                onBlur={() =>
                  note !== (repair.quoteNotes ?? "") &&
                  askEdit(
                    t("repairResult"),
                    repair.quoteNotes || t("editEmpty"),
                    note || t("editEmpty"),
                    () => onApply({ quoteNotes: note }, () => updateRepair(repair.id, { quoteNotes: note })),
                    () => setNote(repair.quoteNotes ?? ""),
                  )
                }
                className={cn(input, "resize-y")}
              />
            </Field>
          </Section>
        ) : (
          (repair.quoteNotes || (seesMoney && repair.basePrice != null)) && (
            <Section title={t("repairCostTitle")}>
              <dl className="grid gap-x-4 gap-y-2.5 sm:grid-cols-2">
                {seesMoney && repair.basePrice != null && (
                  <Fact label={t("financeBasePrice")} value={formatPrice(repair.basePrice)} numeric />
                )}
                {repair.quoteNotes && (
                  <Fact label={t("repairResult")} value={repair.quoteNotes} wide />
                )}
              </dl>
            </Section>
          )
        )}

        {/*
          The warranty, in a block of its own because it is a separate decision
          with its own price. It is added to what the customer pays — everything
          downstream counts the total — and only a manager ever sees the split.
        */}
        {seesMoney && (
          <section className="rounded-card border-2 border-info/40 bg-info/6">
            {/* Folded, with what it holds on the fold, so a ticket with a
                warranty says so without opening it. */}
            <button
              type="button"
              onClick={() => setWarrantyOpen((value) => !value)}
              aria-expanded={warrantyOpen}
              className="flex w-full items-center gap-2 px-3.5 py-3 text-start"
            >
              <ShieldCheck className="size-4 shrink-0 text-info" aria-hidden />
              <span className="flex-1 text-[0.85rem] font-black text-ink">{t("warrantyTitle")}</span>
              <span className="text-[0.72rem] font-extrabold text-info">
                {(warranty ?? 0) > 0
                  ? `${formatPrice(warranty!)} ${t("currency")}${warrantyDays ? ` · ${t("warrantyDaysShort", { days: String(warrantyDays) })}` : ""}`
                  : t("warrantyNone")}
              </span>
              <ChevronDown
                className={cn("size-4 shrink-0 text-muted transition-transform duration-150", warrantyOpen && "rotate-180")}
                aria-hidden
              />
            </button>
            {warrantyOpen && (
            <div className="space-y-2.5 border-t border-info/25 px-3.5 pt-3 pb-3.5">
            <p className="text-[0.74rem] font-medium leading-relaxed text-muted">
              {t("warrantyHint")}
            </p>
            {!warrantyAvailable ? (
              <p className="rounded-card border border-dashed border-warning/50 bg-warning/6 px-3 py-2.5 text-[0.78rem] font-bold text-warning">
                {t("warrantyUnavailable")}
              </p>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label={t("warrantyPrice")}>
                    <MoneyInput
                      value={warranty}
                      clearable
                      onChange={setWarranty}
                      onCommit={() =>
                        warranty !== repair.warrantyPrice &&
                        askEdit(
                          t("warrantyPrice"),
                          shown(repair.warrantyPrice),
                          shown(warranty),
                          () =>
                            onApply({ warrantyPrice: warranty, actualCost: total, price: total }, () =>
                              updateRepair(repair.id, { warranty }),
                            ),
                          () => setWarranty(repair.warrantyPrice),
                        )
                      }
                      min={0}
                      disabled={!full}
                    />
                  </Field>
                  <Field label={t("warrantyDurationField")}>
                    <NumberInput
                      value={warrantyDays}
                      clearable
                      onChange={setWarrantyDays}
                      onCommit={() =>
                        warrantyDays !== repair.warrantyDays &&
                        askEdit(
                          t("warrantyDurationField"),
                          repair.warrantyDays == null ? t("editEmpty") : String(repair.warrantyDays),
                          warrantyDays == null ? t("editEmpty") : String(warrantyDays),
                          () => onApply({ warrantyDays }, () => updateRepair(repair.id, { warrantyDays })),
                          () => setWarrantyDays(repair.warrantyDays),
                        )
                      }
                      min={1}
                      max={3650}
                      disabled={!full}
                    />
                  </Field>
                  <Field label={t("warrantyFrom")}>
                    <DateField
                      type="date"
                      value={warrantyStart}
                      onChange={(event) => setWarrantyStart(event.target.value)}
                      onBlur={() =>
                        warrantyStart !== (repair.warrantyStart ?? "") &&
                        askEdit(
                          t("warrantyFrom"),
                          repair.warrantyStart ? formatFieldValue("date", repair.warrantyStart) : t("editEmpty"),
                          warrantyStart ? formatFieldValue("date", warrantyStart) : t("editEmpty"),
                          () =>
                            onApply({ warrantyStart: warrantyStart || null }, () =>
                              updateRepair(repair.id, { warrantyStart: warrantyStart || null }),
                            ),
                          () => setWarrantyStart(repair.warrantyStart ?? ""),
                        )
                      }
                      disabled={!full}
                      className={input}
                    />
                  </Field>
                </div>
                {warrantyStart && warrantyDays != null && warrantyDays > 0 && (
                  <p className="text-[0.76rem] font-bold text-ink">
                    {t("warrantyTo")}: <span data-numeric>{warrantyEnd(warrantyStart, warrantyDays)}</span>
                  </p>
                )}
                <dl className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-control bg-surface px-2 py-1.5">
                    <dt className="text-[0.64rem] font-bold text-muted">{t("warrantyBase")}</dt>
                    <dd className="text-[0.84rem] font-black text-ink" data-numeric>{formatPrice(base ?? 0)}</dd>
                  </div>
                  <div className="rounded-control bg-surface px-2 py-1.5">
                    <dt className="text-[0.64rem] font-bold text-muted">{t("warrantyTitle")}</dt>
                    <dd className="text-[0.84rem] font-black text-info" data-numeric>{formatPrice(warranty ?? 0)}</dd>
                  </div>
                  <div className="rounded-control bg-surface px-2 py-1.5">
                    <dt className="text-[0.64rem] font-bold text-muted">{t("warrantyTotal")}</dt>
                    <dd className="text-[0.84rem] font-black text-brand" data-numeric>{formatPrice(total ?? 0)}</dd>
                  </div>
                </dl>
                {base == null && (warranty ?? 0) > 0 && (
                  <p className="text-[0.72rem] font-bold text-warning">{t("warrantyNeedsPrice")}</p>
                )}
              </>
            )}
            </div>
            )}
          </section>
        )}

        {/*
          The desk's own bookkeeping — what the part cost, what the customer
          has paid, cash or deferred. Saved to `repair_ticket_finance`, which a
          customer can never read and a technician is refused. Remaining and
          profit are worked out here, never typed.
        */}
        {seesMoney && (
          <Section title={t("financeTitle")} hint={t("financeHint")}>
            {!financeAvailable ? (
              <p className="rounded-card border border-dashed border-warning/50 bg-warning/6 px-3 py-2.5 text-[0.78rem] font-bold text-warning">
                {t("financeUnavailable")}
              </p>
            ) : (
              <>
                <Field label={t("financeTerms")}>
                  <div className="inline-flex rounded-control border border-line p-0.5" role="radiogroup" aria-label={t("financeTerms")}>
                    {(["cash", "deferred"] as PaymentTerms[]).map((terms) => (
                      <button
                        key={terms}
                        type="button"
                        role="radio"
                        aria-checked={repair.paymentTerms === terms}
                        disabled={!full}
                        onClick={() => {
                          if (repair.paymentTerms === terms) return;
                          askEdit(
                            t("financeTerms"),
                            t(repair.paymentTerms === "cash" ? "termsCash" : "termsDeferred"),
                            t(terms === "cash" ? "termsCash" : "termsDeferred"),
                            () => {
                              // Cash is paid in full, so the figure goes with the switch.
                              if (terms === "cash") {
                                setCollected(null);
                                onApply({ paymentTerms: terms, collected: null }, () =>
                                  updateRepairFinance(repair.id, { paymentTerms: terms, collected: null }),
                                );
                              } else {
                                onApply({ paymentTerms: terms }, () => updateRepairFinance(repair.id, { paymentTerms: terms }));
                              }
                            },
                          );
                        }}
                        className={cn(
                          "rounded-[calc(var(--radius-control)-2px)] px-3.5 py-1.5 text-[0.76rem] font-extrabold transition-colors",
                          repair.paymentTerms === terms
                            ? terms === "deferred"
                              ? "bg-warning text-white"
                              : "bg-success text-white"
                            : "text-muted hover:text-ink",
                        )}
                      >
                        {t(terms === "cash" ? "termsCash" : "termsDeferred")}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label={t("financeCost")}>
                  <MoneyInput
                    value={costPrice}
                    clearable
                    onChange={(value) => setCostPrice(value)}
                    onCommit={() =>
                      costPrice !== repair.costPrice &&
                      askEdit(
                        t("financeCost"),
                        shown(repair.costPrice),
                        shown(costPrice),
                        () => onApply({ costPrice }, () => updateRepairFinance(repair.id, { costPrice })),
                        () => setCostPrice(repair.costPrice),
                      )
                    }
                    min={0}
                    disabled={!full}
                  />
                </Field>
                {repair.paymentTerms === "deferred" ? (
                  /* ⚠️ Only on a deferred ticket — the shop, 2026-11-17: "the
                     آجل must show its fields only when the user chooses it".
                     A cash ticket is paid in full at the counter. */
                  <div className="space-y-2.5 rounded-card border border-warning/35 bg-warning/5 p-3">
                    <Field label={t("financeCollected")}>
                      <MoneyInput
                        value={collected}
                        clearable
                        onChange={(value) => setCollected(value)}
                        onCommit={() =>
                          collected !== repair.collected &&
                          askEdit(
                            t("financeCollected"),
                            shown(repair.collected),
                            shown(collected),
                            () => onApply({ collected }, () => updateRepairFinance(repair.id, { collected })),
                            () => setCollected(repair.collected),
                          )
                        }
                        min={0}
                        disabled={!full}
                      />
                    </Field>
                    <dl className="grid grid-cols-2 gap-2">
                      <MoneyFact label={t("financeRemaining")} value={money.remaining} tone={money.remaining > 0 ? "warning" : "success"} />
                      {profitFact}
                    </dl>
                    {/* The rest in one press, rather than retyping «الواصل» as
                        the total — and it settles by itself at «تم التسليم». */}
                    {full && money.remaining > 0 && total != null && (
                      <button
                        type="button"
                        onClick={() => setPayingRest(true)}
                        className="press inline-flex w-full items-center justify-center gap-2 rounded-control bg-success px-4 py-2.5 text-[0.82rem] font-extrabold text-white transition-opacity hover:opacity-90"
                      >
                        <HandCoins className="size-4" aria-hidden />
                        {t("financePayRest", { amount: formatPrice(money.remaining) })}
                      </button>
                    )}
                    <p className="text-[0.7rem] font-bold leading-relaxed text-muted">{t("financeSettleNote")}</p>
                  </div>
                ) : (
                  <>
                    <p className="flex items-center gap-2 rounded-card border border-success/30 bg-success/6 px-3 py-2 text-[0.76rem] font-bold text-success">
                      <Banknote className="size-4 shrink-0" aria-hidden />
                      {t("financeCashPaid")}
                    </p>
                    <dl className="grid gap-2 sm:grid-cols-2">{profitFact}</dl>
                  </>
                )}
              </>
            )}
          </Section>
        )}

        {repair.customerPhone && (
          <Section title={t("customer")}>
            <ContactPanel
              name={repair.customerName}
              phone={repair.customerPhone}
              phone2={repair.customerPhone2}
              whatsappMessage={repairMessage(repair, t, statusLabel)}
              whatsappLabel={t("whatsappContact")}
              callLabel={t("callCustomer")}
            >
              <div className="space-y-1.5 border-t border-line/70 pt-3">
                {(repair.branchName || repair.addressLine) && (
                  <p className="flex items-start gap-1.5 text-[0.8rem] font-medium text-ink">
                    {repair.branchName ? (
                      <Store className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden />
                    ) : (
                      <MapPin className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden />
                    )}
                    <span>{repair.branchName ?? repair.addressLine}</span>
                  </p>
                )}
                {(repair.issues.length > 0 || repair.customFaults.length > 0) && (
                  <p className="flex items-start gap-1.5 text-[0.8rem] font-medium text-muted">
                    <Wrench className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    {[...repair.issues, ...repair.customFaults].join("، ")}
                  </p>
                )}
                {repair.preferredAt && (
                  <p className="text-[0.78rem] font-medium text-muted">
                    {formatDayTime(locale, repair.preferredAt)}
                  </p>
                )}
                {repair.notes && (
                  <p className="text-[0.75rem] italic text-muted">
                    “{repair.notes}”
                  </p>
                )}
              </div>
            </ContactPanel>
          </Section>
        )}

        {/* Damage photos belong to a broken device. A programming job has
            none to send, and an always-empty "damage" frame on every one of
            them is noise — so the section is drawn only when there are some. */}
        {(repair.service !== "software" || repair.photosBefore.length > 0) && (
        <PhotoGrid
          label={tRepair("damagePhotos")}
          urls={repair.photosBefore}
          emptyLabel={t("noPhotos")}
          onOpen={(at) => setLightbox({ urls: repair.photosBefore, at })}
        />
        )}

        <Section title={t("photosAfter")}>
          <div className="flex flex-wrap gap-2.5">
            {repair.photosAfter.map((url, index) => (
              <button
                key={url}
                type="button"
                onClick={() =>
                  setLightbox({ urls: repair.photosAfter, at: index })
                }
                className="relative size-20 overflow-hidden rounded-card border border-line transition-opacity hover:opacity-85"
              >
                <Image
                  src={url}
                  alt=""
                  fill
                  sizes="80px"
                  className="object-cover"
                />
              </button>
            ))}

            {handles && (
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={uploading}
                className="flex size-20 flex-col items-center justify-center gap-1 rounded-card border-2 border-dashed border-line text-muted transition-colors hover:border-brand hover:text-brand disabled:opacity-50"
              >
                {uploading ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <ImagePlus className="size-4" aria-hidden />
                )}
                <span className="text-[0.58rem] font-bold">
                  {uploading ? t("uploading") : t("addPhotos")}
                </span>
              </button>
            )}

            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => {
                addPhotos(event.target.files);
                event.target.value = "";
              }}
            />
          </div>
        </Section>

        {/* ⚠️ Inside the window, never beside it. The ticket is a window of
            its own on the desktop (`detach`), and anything drawn beside it is
            drawn in the dashboard: a status confirm or a photograph opening
            behind the ticket that asked for it, or in a dashboard minimised to
            the taskbar where nobody can answer it. */}
        {lightbox && (
          <ImageLightbox
            images={lightbox.urls.map((url) => ({
              url,
              alt: repair.deviceModel,
            }))}
            startIndex={lightbox.at}
            onClose={() => setLightbox(null)}
          />
        )}

        {confirm.dialog}
        {edits.dialog}

        <ConfirmDialog
          open={payingRest}
          title={t("financePayRestTitle")}
          body={t("financePayRestBody", { amount: formatPrice(money.remaining) })}
          confirmLabel={t("financePayRestConfirm")}
          cancelLabel={t("cancel")}
          tone="normal"
          onCancel={() => setPayingRest(false)}
          onConfirm={() => {
            setPayingRest(false);
            payRest();
          }}
        />
      </EntityDialog>
    </>
  );
}

/* ------------------------- the ticket at a glance ------------------------ */

/**
 * What a press anywhere on a row opens.
 *
 * The shop, 2026-11-17: the row's press shows "just the information of the
 * device (model, problems) and the information of the customer, and the price
 * of repairing only"; changing anything is the pencil beside WhatsApp and
 * print. So nothing here is an input, and its one control is the way into the
 * editor — which, in the desktop app, asks for the desk's password.
 */
function RepairQuickView({
  repair,
  seesMoney,
  onClose,
  onEdit,
}: {
  repair: RepairCard;
  seesMoney: boolean;
  onClose: () => void;
  /** Absent where this reader may change nothing on the ticket. */
  onEdit?: () => void;
}) {
  const t = useTranslations("Admin");
  const tTrack = useTranslations("Track");
  const price = repairCost(repair);
  const faults = [...repair.issues, ...repair.customFaults];

  return (
    <EntityDialog
      windowId={`repair-view:${repair.id}`}
      title={repair.customerName}
      subtitle={`${repair.code} · ${repair.deviceModel}`}
      closeLabel={t("close")}
      onClose={onClose}
      width={460}
      confirmClose={false}
      accent={TONE_VAR[statusTone(repair.status)]}
      footer={
        <>
          <StatusPill status={repair.status} label={tTrack(`status_${repair.status}` as "status_received")} />
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="press ms-auto inline-flex items-center gap-2 rounded-control bg-brand px-4 py-2 text-[0.8rem] font-extrabold text-white transition-colors hover:bg-brand-hover"
            >
              <Pencil className="size-4" aria-hidden />
              {t("deskEditTicket")}
            </button>
          )}
        </>
      }
    >
      <div className="space-y-3">
        <QuickBlock icon={repair.service === "software" ? Cpu : Smartphone} title={t("quickDevice")}>
          <p className="text-[1rem] font-black text-ink">{repair.deviceModel}</p>
          {faults.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {faults.map((fault) => (
                <li
                  key={fault}
                  className="rounded-chip border border-line bg-surface px-2.5 py-1 text-[0.74rem] font-bold text-ink"
                >
                  {fault}
                </li>
              ))}
            </ul>
          )}
          {repair.notes && (
            <p className="mt-2 text-[0.76rem] font-medium italic leading-relaxed text-muted">“{repair.notes}”</p>
          )}
        </QuickBlock>

        <QuickBlock icon={UserRound} title={t("quickCustomer")}>
          <p className="text-[1rem] font-black text-ink">{repair.customerName}</p>
          {repair.customerPhone && (
            <p className="mt-1 flex items-center gap-1.5 text-[0.88rem] font-bold text-ink">
              <Phone className="size-3.5 shrink-0 text-muted" aria-hidden />
              <span dir="ltr" data-numeric>
                {repair.customerPhone}
              </span>
            </p>
          )}
          {repair.customerPhone2 && (
            <p className="mt-0.5 flex items-center gap-1.5 text-[0.8rem] font-semibold text-muted">
              <Phone className="size-3.5 shrink-0" aria-hidden />
              <span dir="ltr" data-numeric>
                {repair.customerPhone2}
              </span>
            </p>
          )}
        </QuickBlock>

        <QuickBlock icon={Banknote} title={t("quickPrice")}>
          {price != null ? (
            <p className="text-[1.35rem] font-black leading-tight text-brand">
              <span data-numeric>{formatPrice(price)}</span>{" "}
              <span className="text-[0.8rem] font-extrabold">{t("currency")}</span>
            </p>
          ) : (
            <p className="text-[0.82rem] font-bold text-muted">{t("quickNoPrice")}</p>
          )}
          {seesMoney && (repair.warrantyPrice ?? 0) > 0 && (
            <p className="mt-0.5 text-[0.72rem] font-bold text-info">
              {t("quickIncludesWarranty", { amount: formatPrice(repair.warrantyPrice!) })}
            </p>
          )}
        </QuickBlock>
      </div>
    </EntityDialog>
  );
}

function QuickBlock({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-card border border-line bg-canvas p-3.5">
      <h3 className="mb-2 flex items-center gap-1.5 text-[0.72rem] font-extrabold text-muted">
        <Icon className="size-3.5" aria-hidden />
        {title}
      </h3>
      {children}
    </section>
  );
}

/* --------------------------- a technician's ticket ------------------------ */

/**
 * The shop, 2026-11-17: a technician's ticket shows "only the status, the
 * device info, the customer info, the maintenance cost". He moves the work
 * along `TECH_STATUSES` — ending on «انتهاء عمل الصيانة», his word to the
 * manager that his part is done — and reads the rest. Accepting, cancelling
 * and handing the device back are the manager's, and the server refuses
 * anything else he might send (`updateRepair`).
 */
function TechTicketDialog({
  windowId,
  repair,
  flow,
  error,
  onClose,
  onApply,
}: {
  windowId: string;
  repair: RepairCard;
  flow: readonly RepairStatus[];
  error: string | null;
  onClose: () => void;
  onApply: (
    next: Partial<RepairCard>,
    send: () => Promise<{ ok: boolean; error?: string }>,
  ) => void;
}) {
  const t = useTranslations("Admin");
  const tTrack = useTranslations("Track");
  const tRepair = useTranslations("Repair");
  const locale = useLocale();
  const confirm = useStatusConfirm();

  const mine = repair.control === "own";
  // His to move only while it is in his hands — see `techMayMoveFrom`. Once
  // the manager has it, the steps are not drawn at all: a row of buttons that
  // would all be refused is a question he cannot answer.
  const movable = mine && techMayMoveFrom(repair.status);
  const statusLabel = tTrack(`status_${repair.status}` as "status_received");
  const steps = flow.filter((status) => techMaySet(status));
  const price = repairCost(repair);
  const faults = [...repair.issues, ...repair.customFaults];

  function moveTo(status: RepairStatus) {
    confirm.request({
      subject: repair.code,
      from: { key: repair.status, label: statusLabel },
      to: { key: status, label: tTrack(`status_${status}` as "status_received") },
      run: () => onApply({ status }, () => updateRepair(repair.id, { status })),
    });
  }

  return (
    <EntityDialog
      windowId={windowId}
      title={`${repair.service === "software" ? t("programmingJob") : tRepair("title")} · ${repair.code}`}
      subtitle={repair.deviceModel}
      closeLabel={t("close")}
      onClose={onClose}
      width={560}
      // Nothing here is typed — every status move asks for itself.
      confirmClose={false}
      detach
      accent={TONE_VAR[statusTone(repair.status)]}
      footer={
        <>
          <p className="text-[0.72rem] font-medium text-muted">
            {formatDayTime(locale, repair.createdAt)}
          </p>
          {repair.customerPhone && (
            <div className="ms-auto">
              <WhatsAppButton
                phone={repair.customerPhone}
                message={repairMessage(repair, t, statusLabel)}
                label={t("whatsappContact")}
              />
            </div>
          )}
        </>
      }
    >
      {error && (
        <p role="alert" className="rounded-card bg-brand/10 px-3.5 py-2.5 text-[0.78rem] font-bold text-brand">
          {t.has(error) ? t(error as "updateFailed") : t("updateFailed")}
        </p>
      )}

      {!mine && (
        <p className="flex items-center gap-2 rounded-card border border-line bg-subtle px-3.5 py-2.5 text-[0.78rem] font-bold text-muted">
          <Eye className="size-4 shrink-0" aria-hidden />
          {t("deskReadOnlyTech")}
        </p>
      )}

      <Section title={t("setStatus")} hint={mine ? t("techStatusHint") : undefined}>
        <p className="mb-2.5 flex flex-wrap items-center gap-2 text-[0.76rem] font-bold text-muted">
          {t("techNow")}
          <StatusPill status={repair.status} label={statusLabel} />
        </p>
        {mine && !movable ? (
          <p className="rounded-card border border-line bg-subtle px-3.5 py-2.5 text-[0.78rem] font-bold text-muted">
            {t("techStatusLocked")}
          </p>
        ) : (
        <ol className="flex flex-wrap gap-1.5">
          {steps.map((status) => {
            const active = repair.status === status;
            return (
              <li key={status}>
                <button
                  type="button"
                  disabled={!mine || active}
                  onClick={() => moveTo(status)}
                  aria-current={active ? "step" : undefined}
                  className={cn(
                    "press rounded-control border px-2.5 py-1.5 text-[0.72rem] font-extrabold transition-colors",
                    active
                      ? "border-transparent text-white"
                      : status === "work_done"
                        ? "border-success/60 text-success hover:bg-success/8"
                        : "border-line text-muted hover:border-brand hover:text-brand",
                    !mine && !active && "cursor-not-allowed opacity-45",
                  )}
                  style={active ? { background: TONE_VAR[statusTone(status)] } : undefined}
                >
                  {tTrack(`status_${status}` as "status_received")}
                </button>
              </li>
            );
          })}
        </ol>
        )}
        <p className="mt-2.5 text-[0.7rem] font-semibold leading-relaxed text-muted">{t("techStatusManager")}</p>
      </Section>

      <Section title={t("quickDevice")}>
        <dl className="grid gap-x-4 gap-y-2.5 sm:grid-cols-2">
          <Fact label={t("repairDevice")} value={repair.deviceModel} />
          {faults.length > 0 && <Fact label={t("repairIssues")} value={faults.join(" · ")} />}
          {repair.notes && <Fact label={t("repairProblem")} value={repair.notes} wide />}
        </dl>
      </Section>

      <Section title={t("quickCustomer")}>
        <dl className="grid gap-x-4 gap-y-2.5 sm:grid-cols-2">
          <Fact label={t("repairCustomer")} value={repair.customerName} />
          {repair.customerPhone && <Fact label={t("repairPhone")} value={repair.customerPhone} numeric />}
          {repair.customerPhone2 && <Fact label={t("repairPhoneAlt")} value={repair.customerPhone2} numeric />}
        </dl>
      </Section>

      <Section title={t("quickPrice")}>
        {price != null ? (
          <p className="text-[1.2rem] font-black text-brand">
            <span data-numeric>{formatPrice(price)}</span>{" "}
            <span className="text-[0.78rem] font-extrabold">{t("currency")}</span>
          </p>
        ) : (
          <p className="text-[0.8rem] font-bold text-muted">{t("quickNoPrice")}</p>
        )}
      </Section>

      {confirm.dialog}
    </EntityDialog>
  );
}

/**
 * The customer's photographs, and — when there are none — the fact that there
 * are none.
 *
 * This used to return `null` on an empty set, so a ticket with no photos had no
 * photo section at all. From behind the counter those two states look
 * identical: "the customer sent nothing" and "this dialog does not show
 * photos". Staff read it as the second, which is how a feature that works ends
 * up reported as broken — and it is not a rare state either, because
 * `book_repair` rejects a non-empty `p_photos` outright and the wizard has to
 * attach them in a second write that can fail on its own.
 *
 * So the heading is always drawn, and an empty set says so in the frame where
 * the pictures would be.
 */
function PhotoGrid({
  label,
  urls,
  emptyLabel,
  onOpen,
}: {
  label: string;
  urls: string[];
  emptyLabel: string;
  onOpen: (index: number) => void;
}) {
  if (urls.length === 0) {
    return (
      <Section title={label}>
        <p className="flex items-center gap-2 rounded-card border border-dashed border-line px-4 py-5 text-[0.8rem] font-medium text-muted">
          <ImageOff className="size-4 shrink-0" aria-hidden strokeWidth={1.5} />
          {emptyLabel}
        </p>
      </Section>
    );
  }

  return (
    <Section title={label}>
      <div className="flex flex-wrap gap-2.5">
        {urls.map((url, index) => (
          <button
            key={url}
            type="button"
            onClick={() => onOpen(index)}
            className="relative size-20 cursor-zoom-in overflow-hidden rounded-card border border-line transition-opacity hover:opacity-85"
          >
            <Image
              src={url}
              alt=""
              fill
              sizes="80px"
              className="object-cover"
            />
          </button>
        ))}
      </div>
    </Section>
  );
}

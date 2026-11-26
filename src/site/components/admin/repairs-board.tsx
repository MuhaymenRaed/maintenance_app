"use client";

import { useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import {
  Activity,
  Banknote,
  Check,
  CheckCircle2,
  ChevronDown,
  Cpu,
  Eye,
  HandCoins,
  ImageOff,
  ImagePlus,
  Loader2,
  Pencil,
  PencilLine,
  RotateCcw,
  Save,
  Undo2,
  Phone,
  Printer,
  Receipt,
  ShieldCheck,
  Smartphone,
  UserCheck,
  UserRound,
  UserX,
  Wrench,
  Globe2,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { StatusPill } from "@/components/account/status-pill";
import {
  EntityDialog,
  Field,
  Grid,
  input,
  NumberInput,
  Section,
  SelectField,
  MoneyInput,
} from "@/components/admin/form-kit";
import {
  HandedOverMark,
  HandedOverToggle,
  OwedLine,
  PriceRows,
  STAGE_LOOK,
  StagePill,
  TechStepTag,
  TicketCard,
  WebRequestMark,
} from "@/components/admin/repair-ticket/ticket-parts";
import { DeviceFields } from "@/components/admin/repair-ticket/device-fields";
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
import {
  assignRepair,
  decideRepairRequest,
  setRepairHandedOver,
  updateRepairDetails,
  updateRepairFaults,
  updateRepairFinance,
} from "@/lib/actions/repair-desk";
import { groupByDay } from "@/lib/data/queue-window";
import { completionStatus, settledStatus, stageOf, techStepOf } from "@/lib/data/repair-stage";
import type { StockModel } from "@/lib/data/device-catalogue";
import type { RecentDevice } from "@/lib/data/recent-devices";
import {
  repairMoney,
  repairTotal,
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
import { savedFaultValues, TicketFaults } from "@/components/admin/fault-picker";
import { faultText, splitFaults, type RecentFault } from "@/lib/data/repair-faults";
import {
  changedKeys,
  draftView,
  planTicketSave,
  STEP_FIELDS,
  withoutFields,
  type ChangeKey,
  type TicketDraft,
  type TicketFields,
} from "@/lib/data/ticket-draft";
import { windowStore } from "@/lib/windows/window-store";
import { statusTone, TONE_VAR } from "@/lib/data/status-tone";
import { formatPrice } from "@/lib/format";
import type { DeskRow } from "@/lib/queries/repair-desk";

type RepairCard = DeskRow;
import type { RepairStatus } from "@/lib/data/orders";
import { cn } from "@/lib/utils";
import { formatDay, formatDayTime } from "@/lib/data/datetime";
import { liveDocument, OwnerDocumentProvider } from "@/lib/windows/owner-document";
import { DateField, formatFieldValue } from "@/components/ui/date-field";
import { Select } from "@/components/ui/select";

/** Somebody a ticket may be handed to. */
export type DeskHolder = { id: string; name: string; rank: DeskRank };

/** إدارة الورشة's two pickers on a row — `Select` carries no skin of its own. */
const ROW_PICKER =
  "h-8 rounded-control border border-line bg-canvas px-2.5 text-[0.74rem] font-bold text-ink transition-colors hover:border-brand/45";

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
  brands = [],
  stock = {},
  recentDevices = [],
  dayOf,
  workshop = false,
}: {
  /**
   * The instant a row is filed under in the day rules — when it was opened,
   * unless the list is of something else: «مكتمل» is the day it completed.
   */
  dayOf?: (row: RepairCard) => string;
  /**
   * إدارة الورشة's rows: who holds it and the technician's step, set from the
   * row itself (the shop, 2026-11-24) — each asks first, as in the window.
   */
  workshop?: boolean;
  /** The makes, the shop's own models and the bench's latest devices — the editor's device lists. */
  brands?: { code: string; name: string }[];
  stock?: Record<string, StockModel[]>;
  recentDevices?: RecentDevice[];
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
  /** Accepting or refusing a website request from its row asks first. */
  const rowConfirm = useStatusConfirm();

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

  /** A website request, accepted onto the bench or refused — from its row. */
  function decide(row: RepairCard, accept: boolean) {
    rowConfirm.request({
      subject: row.code,
      from: { key: row.status, label: t("stage_request") },
      to: { key: accept ? "approved" : "cancelled", label: t(accept ? "stage_accepted" : "stage_cancelled") },
      note: accept ? t("requestAcceptNote") : t("requestRefuseNote"),
      run: () => apply(row.id, { status: accept ? "approved" : "cancelled" }, () => decideRepairRequest(row.id, accept)),
    });
  }

  /** إدارة الورشة: the ticket handed to somebody else, from its row. */
  function handTo(row: RepairCard, value: string) {
    const holderId = value || null;
    if (holderId === row.holderId) return;
    const person = holders.find((holder) => holder.id === holderId);
    apply(
      row.id,
      { holderId, holderName: person?.name ?? null, holderRank: person?.rank ?? null, technicianName: person?.name ?? null },
      () => assignRepair(row.id, holderId),
    );
  }

  /** إدارة الورشة: the technician's step, from its row — asked first. */
  function stepTo(row: RepairCard, status: RepairStatus) {
    if (status === row.status) return;
    rowConfirm.request({
      subject: row.code,
      from: { key: row.status, label: tTrack(`status_${row.status}` as "status_received") },
      to: { key: status, label: tTrack(`status_${status}` as "status_received") },
      run: () => apply(row.id, { status }, () => updateRepair(row.id, { status })),
    });
  }
  const steps = flow.filter((step) => techStepOf(step) !== null);
  const rankWord = (rank: DeskRank) => t(`rank_${rank}`);
  const handOptions = [
    { value: "", label: t("unassigned") },
    ...holders.map((holder) => ({
      value: holder.id,
      label: holder.id === viewerId ? t("deskAssignSelf", { rank: rankWord(holder.rank) }) : `${holder.name} — ${rankWord(holder.rank)}`,
    })),
  ];

  /** «تم التسليم للزبون» from the row — a badge, so no question is asked. */
  function handOver(row: RepairCard, handed: boolean) {
    const me = holders.find((holder) => holder.id === viewerId)?.name ?? null;
    apply(
      row.id,
      { handedOverAt: handed ? new Date().toISOString() : null, handedOverName: handed ? me : null },
      () => setRepairHandedOver(row.id, handed),
    );
  }

  return (
    <div className="space-y-3">
      {rowConfirm.dialog}
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
          {groupByDay(rows, dayOf ?? ((row) => row.createdAt)).map((group) => (
          <section key={group.day} className="space-y-2.5">
          {showDays && (
            <DayRule
              day={group.day}
              locale={locale}
              count={t("dayTicketCount", { count: group.rows.length })}
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
            // ⚠️ آجل only, and never on a cancelled ticket: a نقد ticket is paid
            // its whole price the moment it completes, so before that it is
            // not a debt, and a cancelled ticket owes nothing.
            const owes =
              seesMoney && financeAvailable && row.paymentTerms === "deferred" && stageOf(row.status) !== "cancelled"
                ? repairMoney({
                    price: row.price,
                    warranty: row.warrantyPrice,
                    cost: row.costPrice,
                    collected: row.collected,
                    terms: row.paymentTerms,
                    completed: row.status === "completed",
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
                  style={{ background: STAGE_LOOK[stageOf(row.status)].stripe }}
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
                    {(row.origin === "web" || row.status === "requested") && <WebRequestMark />}
                    {!isTechnician && <TechStepTag status={row.status} />}
                    <HandedOverMark at={row.handedOverAt} />
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
                    {/* Opened in this period, «مكتمل» on a later day: still
                        this day's ticket, its money that day's (2026-11-25). */}
                    {row.completedLater && (
                      <span
                        title={t("deskCompletedLaterHint")}
                        className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-chip bg-success/12 px-1.5 py-0.5 text-[0.62rem] font-extrabold text-success"
                      >
                        <CheckCircle2 className="size-3" aria-hidden />
                        {t("deskCompletedLaterMark", { when: formatDay(locale, row.completedLater) })}
                      </span>
                    )}
                  </p>

                  {/* إدارة الورشة: who holds it, and the step it is on — from
                      the row. Raised above the row's own button. */}
                  {workshop && !isTechnician && row.control === "full" && (stageOf(row.status) === "accepted" || stageOf(row.status) === "waiting") && (
                    <div className="pointer-events-auto flex flex-wrap items-center gap-2 pt-1.5">
                      <label className="flex min-w-0 items-center gap-1.5 text-[0.7rem] font-bold text-muted">
                        <UserRound className="size-3.5 shrink-0" aria-hidden />
                        <Select
                          value={row.holderId ?? ""}
                          onChange={(value) => handTo(row, value)}
                          options={
                            row.holderId && !holders.some((holder) => holder.id === row.holderId)
                              ? [...handOptions, { value: row.holderId, label: row.holderName ?? t("workColleague") }]
                              : handOptions
                          }
                          aria-label={`${t("deskHolder")} — ${row.code}`}
                          className="w-48"
                          triggerClassName={ROW_PICKER}
                        />
                      </label>
                      {stageOf(row.status) === "accepted" && steps.length > 0 && (
                        <label className="flex min-w-0 items-center gap-1.5 text-[0.7rem] font-bold text-muted">
                          <Wrench className="size-3.5 shrink-0" aria-hidden />
                          <Select
                            value={techStepOf(row.status) ? row.status : ""}
                            onChange={(value) => stepTo(row, value as RepairStatus)}
                            placeholder={t("techStepLabel")}
                            options={steps.map((step) => ({ value: step, label: tTrack(`status_${step}` as "status_received") }))}
                            aria-label={`${t("techStepLabel")} — ${row.code}`}
                            className="w-44"
                            triggerClassName={ROW_PICKER}
                          />
                        </label>
                      )}
                    </div>
                  )}
                </div>

                <div className="relative z-1 flex shrink-0 flex-col items-end justify-between gap-2">
                  <span className="pointer-events-none flex flex-col items-end gap-1">
                    {isTechnician ? (
                      <StatusPill
                        status={row.status}
                        label={tTrack(`status_${row.status}` as "status_received")}
                      />
                    ) : (
                      <StagePill status={row.status} />
                    )}
                    {price != null && (
                      <span className="text-[0.95rem] font-black text-brand" data-numeric>
                        {formatPrice(price)}
                      </span>
                    )}
                  </span>
                  {row.status === "requested" && row.control === "full" && (
                    <span className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => decide(row, true)}
                        className="press inline-flex items-center gap-1.5 rounded-control bg-success px-3 py-1.5 text-[0.74rem] font-extrabold text-white hover:opacity-90"
                      >
                        <CheckCircle2 className="size-4" aria-hidden />
                        {t("requestAccept")}
                      </button>
                      <button
                        type="button"
                        onClick={() => decide(row, false)}
                        aria-label={`${t("requestRefuse")} — ${row.code}`}
                        title={t("requestRefuse")}
                        className="press flex size-8 items-center justify-center rounded-control border border-brand/40 text-brand hover:bg-brand/8"
                      >
                        <XCircle className="size-4" aria-hidden />
                      </button>
                    </span>
                  )}
                  {row.status !== "requested" && row.control !== "none" && stageOf(row.status) !== "cancelled" && (
                    <HandedOverToggle compact at={row.handedOverAt} onToggle={(handed) => handOver(row, handed)} />
                  )}
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
          brands={brands}
          stock={stock}
          recentDevices={recentDevices}
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
    completed: row.status === "completed",
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
  brands,
  stock,
  recentDevices,
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
  /** The makes, the shop's own models and this bench's latest devices — the device editor's lists. */
  brands: { code: string; name: string }[];
  stock: Record<string, StockModel[]>;
  recentDevices: RecentDevice[];
  /** Writes what the database answered onto the board's row. */
  onPatch: (next: Partial<RepairCard>) => void;
  repair: RepairCard;
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
  const stage = stageOf(repair.status);

  /*
   * ⚠️ **One draft, saved by «حفظ التغييرات»** (the shop, 2026-11-26: "let the
   * admin do all the changes he needs then … saved by a button of حفظ
   * التغييرات with a popup checking modal"). Every field used to ask "save
   * this change?" on blur and save on its own. Now nothing is sent until the
   * button and its review — see `lib/data/ticket-draft.ts`.
   *
   * The draft holds only what the reader touched; every other field reads the
   * ticket as it is now, so a change made elsewhere shows through rather than
   * being listed as an edit that would put the old value back.
   */
  const saved: TicketFields = {
    customerName: repair.customerName,
    customerPhone: repair.customerPhone,
    customerPhone2: repair.customerPhone2,
    brandCode: repair.brandCode,
    deviceModel: repair.deviceModel,
    // `quote_notes` is the column, and it has always been the one note the
    // customer reads on their ticket — so it is what became of the device.
    quoteNotes: repair.quoteNotes,
    basePrice: repair.basePrice,
    costPrice: repair.costPrice,
    paymentTerms: repair.paymentTerms,
    collected: repair.collected,
    warrantyPrice: repair.warrantyPrice,
    warrantyDays: repair.warrantyDays,
    warrantyStart: repair.warrantyStart,
    faults: savedFaultValues(repair),
    holderId: repair.holderId,
  };
  const [draft, setDraft] = useState<TicketDraft>({});
  const view = draftView(saved, draft);
  const changes = changedKeys(saved, draft);
  const dirty = changes.length > 0;
  /** The review before saving is open. */
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  /** What the last press of «حفظ التغييرات» came to — said in the save bar. */
  const [saveState, setSaveState] = useState<"saved" | { error: string } | null>(null);
  function edit(patch: TicketDraft) {
    setDraft((current) => ({ ...current, ...patch }));
    setSaveState(null);
  }

  const base = view.basePrice;
  const warranty = view.warrantyPrice;
  const warrantyDays = view.warrantyDays;
  const warrantyStart = view.warrantyStart ?? "";
  const collected = view.collected;
  const total = repairTotal(base, warranty);
  const money = repairMoney({
    price: total,
    warranty,
    cost: view.costPrice,
    collected,
    terms: view.paymentTerms,
    completed: repair.completedAt != null,
  });
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState<{ urls: string[]; at: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const statusLabel = t(`stage_${stage}`);
  const rankLabel = (rank: DeskRank) => t(`rank_${rank}`);
  /** Asked before any stage moves — see `status-confirm.tsx`. */
  const confirm = useStatusConfirm();
  const shown = (value: number | null | undefined) => (value == null ? t("editEmpty") : formatPrice(value));
  /** The fee is required; saving without it is refused and said under the row. */
  const [priceMissing, setPriceMissing] = useState(false);
  /** Folded until asked for — the shop, 2026-11-17. A summary shows on the fold. */
  const [warrantyOpen, setWarrantyOpen] = useState(false);
  const viewerName = holders.find((holder) => holder.id === viewerId)?.name ?? null;

  /** Where the money leaves the ticket once it lands — «تسديد الباقي» completes a waiting one. */
  function afterMoney(next: { collected?: number | null; terms?: PaymentTerms }): Partial<RepairCard> {
    const terms = next.terms ?? repair.paymentTerms;
    const paid = next.collected !== undefined ? next.collected : collected;
    const landed = settledStatus({
      status: repair.status,
      terms,
      remaining: Math.max(0, (total ?? 0) - Math.max(0, paid ?? 0)),
    });
    return landed ? { status: landed, completedAt: repair.completedAt ?? new Date().toISOString() } : {};
  }

  /**
   * The manager's three moves. «مكتمل» on an آجل that still owes lands on
   * «بانتظار الزبون» — always (the shop, 2026-11-24); the server decides the
   * same from the same money (`completionStatus`).
   */
  function moveStage(target: "accepted" | "completed" | "cancelled") {
    // A stage is decided from the ticket as saved; edits wait for their button.
    if (dirty) return;
    const status: RepairStatus = target === "accepted" ? "approved" : target;
    const landed: RepairStatus =
      status === "completed" ? completionStatus(repair.paymentTerms, money.remaining) : status;
    confirm.request({
      subject: repair.code,
      from: { key: repair.status, label: statusLabel },
      to: { key: landed, label: t(`stage_${stageOf(landed)}`) },
      note:
        status === "cancelled"
          ? t("statusConfirmCancelRepair")
          : landed !== status
            ? t("deskWaitsForRest", { amount: formatPrice(money.remaining) })
            : undefined,
      run: () =>
        onApply(
          {
            status: landed,
            completedAt: landed === "completed" ? (repair.completedAt ?? new Date().toISOString()) : repair.completedAt,
          },
          () => updateRepair(repair.id, { status }),
        ),
    });
  }

  /** A website request: accepted onto the bench, or refused. */
  function decide(accept: boolean) {
    if (dirty) return;
    confirm.request({
      subject: repair.code,
      from: { key: repair.status, label: statusLabel },
      to: { key: accept ? "approved" : "cancelled", label: t(accept ? "stage_accepted" : "stage_cancelled") },
      note: accept ? t("requestAcceptNote") : t("requestRefuseNote"),
      run: () =>
        onApply({ status: accept ? "approved" : "cancelled" }, () => decideRepairRequest(repair.id, accept)),
    });
  }

  function toggleHanded(handed: boolean) {
    onApply(
      { handedOverAt: handed ? new Date().toISOString() : null, handedOverName: handed ? viewerName : null },
      () => setRepairHandedOver(repair.id, handed),
    );
  }

  /**
   * «حفظ التغييرات»: checked first, so a refusal names the field before
   * anything is sent, then the review.
   */
  function review() {
    const result = planTicketSave(saved, draft);
    if (!result.ok) {
      if (result.error === "price_required") setPriceMissing(true);
      setSaveState({ error: result.error });
      return;
    }
    if (!result.changes.length) return;
    setSaveState(null);
    setReviewing(true);
  }

  /** Back to the ticket as it is saved. */
  function discard() {
    setDraft({});
    setSaveState(null);
    setPriceMissing(false);
  }

  /**
   * The review confirmed: every change, call by call, in the order
   * `planTicketSave` gives — the holder last, because handing the ticket up
   * takes it out of an assistant's control.
   *
   * ⚠️ Each call that lands is written onto the row and taken out of the
   * draft before the next is sent. A refusal therefore stops with what was
   * saved shown as saved and only the rest still waiting under the button —
   * never a whole batch drawn as failed after half of it reached the
   * database, which is what one optimistic patch reverted as a whole would show.
   */
  async function saveChanges() {
    const result = planTicketSave(saved, draft);
    if (!result.ok) {
      setReviewing(false);
      setSaveState({ error: result.error });
      return;
    }
    const { plan } = result;
    setSaving(true);
    const stop = (error?: string) => {
      setSaving(false);
      setReviewing(false);
      setSaveState({ error: error ?? "updateFailed" });
    };
    const settled = (fields: readonly (keyof TicketFields)[]) =>
      setDraft((current) => withoutFields(current, fields));

    if (plan.details) {
      const res = await updateRepairDetails(repair.id, plan.details);
      if (!res.ok) return stop(res.error);
      onPatch(plan.details);
      settled(STEP_FIELDS.details);
    }
    if (plan.repair) {
      const res = await updateRepair(repair.id, plan.repair);
      if (!res.ok) return stop(res.error);
      const priced = plan.repair.price !== undefined || plan.repair.warranty !== undefined;
      onPatch({
        ...(plan.repair.price !== undefined && { basePrice: plan.repair.price }),
        ...(plan.repair.warranty !== undefined && { warrantyPrice: plan.repair.warranty }),
        ...(plan.repair.warrantyDays !== undefined && { warrantyDays: plan.repair.warrantyDays }),
        ...(plan.repair.warrantyStart !== undefined && { warrantyStart: plan.repair.warrantyStart }),
        ...(plan.repair.quoteNotes !== undefined && { quoteNotes: plan.repair.quoteNotes }),
        ...(priced && { actualCost: total, price: total }),
      });
      settled(STEP_FIELDS.repair);
    }
    if (plan.finance) {
      const res = await updateRepairFinance(repair.id, plan.finance);
      if (!res.ok) return stop(res.error);
      onPatch({
        ...(plan.finance.costPrice !== undefined && { costPrice: plan.finance.costPrice }),
        ...(plan.finance.paymentTerms !== undefined && { paymentTerms: plan.finance.paymentTerms }),
        ...(plan.finance.collected !== undefined && { collected: plan.finance.collected }),
        // Paying the rest — or switching to نقد — completes a ticket that waited.
        ...afterMoney({ terms: plan.finance.paymentTerms, collected: plan.finance.collected }),
      });
      settled(STEP_FIELDS.finance);
    }
    if (plan.faults) {
      const picked = splitFaults(plan.faults);
      const res = await updateRepairFaults(repair.id, {
        codes: picked.codes,
        newFaults: picked.names,
        custom: picked.old,
        locale,
      });
      if (!res.ok) return stop(res.error);
      onPatch({
        faults: res.faults,
        issueCodes: res.faults.map((fault) => fault.code),
        issues: res.faults.map((fault) => fault.name),
        customFaults: res.custom,
      });
      settled(STEP_FIELDS.faults);
    }
    if (plan.holder) {
      const holderId = plan.holder.holderId;
      const res = await assignRepair(repair.id, holderId);
      if (!res.ok) return stop(res.error);
      const person = holders.find((holder) => holder.id === holderId);
      onPatch({
        holderId,
        holderName: person?.name ?? null,
        holderRank: person?.rank ?? null,
        technicianName: person?.name ?? null,
      });
    }

    // A field typed and typed back is in the draft and changes nothing.
    setDraft({});
    setSaving(false);
    setReviewing(false);
    setPriceMissing(false);
    setSaveState("saved");
  }

  /** One line of the review: the field, and what it was and becomes. */
  function changeLine(key: ChangeKey): { field: string; from: string; to: string } {
    const empty = t("editEmpty");
    const text = (value: string | null | undefined) => (value ?? "").trim() || empty;
    switch (key) {
      case "customerName":
        return { field: t("counterName"), from: text(saved.customerName), to: text(view.customerName) };
      case "customerPhone":
        return { field: t("counterPhone"), from: text(saved.customerPhone), to: text(view.customerPhone) };
      case "customerPhone2":
        return { field: t("counterPhone2"), from: text(saved.customerPhone2), to: text(view.customerPhone2) };
      case "device": {
        // The make is named only when it changed: the model names it already.
        const makeMoved = (saved.brandCode ?? "") !== (view.brandCode ?? "");
        const device = (fields: TicketFields) =>
          [makeMoved ? brands.find((item) => item.code === fields.brandCode)?.name : null, fields.deviceModel.trim()]
            .filter(Boolean)
            .join(" · ") || empty;
        return { field: t("repairDevice"), from: device(saved), to: device(view) };
      }
      case "faults":
        return { field: t("editFaults"), from: faultNames(saved.faults), to: faultNames(view.faults) };
      case "holderId":
        return { field: t("deskHolder"), from: holderName(saved.holderId), to: holderName(view.holderId) };
      case "quoteNotes":
        return { field: t("repairResult"), from: text(saved.quoteNotes), to: text(view.quoteNotes) };
      case "basePrice":
        return { field: t("priceMaintenance"), from: shown(saved.basePrice), to: shown(view.basePrice) };
      case "costPrice":
        return { field: t("priceCost"), from: shown(saved.costPrice), to: shown(view.costPrice) };
      case "paymentTerms": {
        const terms = (value: PaymentTerms) => t(value === "cash" ? "termsCash" : "termsDeferred");
        return { field: t("financeTerms"), from: terms(saved.paymentTerms), to: terms(view.paymentTerms) };
      }
      case "collected":
        return { field: t("financeCollected"), from: shown(saved.collected), to: shown(view.collected) };
      case "warrantyPrice":
        return { field: t("warrantyPrice"), from: shown(saved.warrantyPrice), to: shown(view.warrantyPrice) };
      case "warrantyDays":
        return {
          field: t("warrantyDurationField"),
          from: saved.warrantyDays == null ? empty : String(saved.warrantyDays),
          to: view.warrantyDays == null ? empty : String(view.warrantyDays),
        };
      case "warrantyStart":
        return {
          field: t("warrantyFrom"),
          from: saved.warrantyStart ? formatFieldValue("date", saved.warrantyStart) : empty,
          to: view.warrantyStart ? formatFieldValue("date", view.warrantyStart) : empty,
        };
    }
  }

  /** Fault values named — the bench's list, then the ticket's own, then the typed text. */
  function faultNames(values: readonly string[]) {
    const byCode = new Map<string, string>();
    for (const issue of issues) byCode.set(issue.code, issue.name);
    for (const fault of repair.faults) byCode.set(fault.code, fault.name);
    return values.map((value) => byCode.get(value) ?? faultText(value)).join("، ") || t("editEmpty");
  }

  function holderName(id: string | null) {
    if (!id) return t("unassigned");
    return (
      holders.find((holder) => holder.id === id)?.name ??
      (id === repair.holderId ? repair.holderName : null) ??
      t("workColleague")
    );
  }

  /** Fills «الباقي» in one press, instead of retyping «الواصل» as the total — saved with the rest. */
  function payRest() {
    if (total == null) return;
    edit({ collected: total });
  }

  function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    void (async () => {
      const urls = await uploadPhotos(Array.from(files), "repair");
      setUploading(false);
      if (urls.length === 0) return;
      onApply({ photosAfter: [...repair.photosAfter, ...urls] }, () => addRepairPhotos(repair.id, urls));
    })();
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

  const text = cn(input, "font-bold");
  const stages = [
    { key: "accepted" as const, icon: Wrench },
    { key: "completed" as const, icon: CheckCircle2 },
    { key: "cancelled" as const, icon: XCircle },
  ];

  return (
    <>
      <EntityDialog
        windowId={windowId}
        title={`${repair.service === "software" ? t("programmingJob") : tRepair("title")} · ${repair.code}`}
        subtitle={`${repair.customerName} · ${repair.deviceModel}`}
        closeLabel={t("close")}
        onClose={onClose}
        width={760}
        // A window of its own on the desktop, which stays when the dashboard
        // is minimised — the shop's instruction of 2026-11-17.
        detach
        accent={STAGE_LOOK[stage].stripe}
        footer={
          <>
            <p className="text-[0.72rem] font-medium text-muted">{formatDayTime(locale, repair.createdAt)}</p>
            {/* ⚠️ On the far side of the footer from "print" and "WhatsApp",
                which are pressed on nearly every ticket. Owners only. */}
            <RecordDelete kind="repair" id={repair.id} label={repair.code} canDelete={canDelete} onDeleted={onDeleted} />
            <div className="ms-auto flex flex-wrap items-center gap-2">
              {manages && (
                <>
                  {/* ⚠️ Not while edits wait: the papers read the ticket as
                      saved, so a receipt printed now would carry the old
                      price or name. */}
                  <button
                    type="button"
                    onClick={(event) => onPrint(event.currentTarget.ownerDocument)}
                    disabled={printing || dirty}
                    aria-busy={printing}
                    title={dirty ? t("ticketSaveFirst") : undefined}
                    className={cn(
                      "press inline-flex items-center gap-2 rounded-control border border-line px-3.5 py-2 text-[0.78rem] font-extrabold text-ink transition-colors hover:border-brand hover:text-brand disabled:opacity-50",
                      printing ? "disabled:cursor-wait" : "disabled:cursor-not-allowed",
                    )}
                  >
                    {printing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Printer className="size-4" aria-hidden />}
                    {t("deskPrint")}
                  </button>
                  <button
                    type="button"
                    onClick={(event) => onWarranty(event.currentTarget.ownerDocument)}
                    disabled={dirty}
                    title={dirty ? t("ticketSaveFirst") : undefined}
                    className="press inline-flex items-center gap-2 rounded-control border border-line px-3.5 py-2 text-[0.78rem] font-extrabold text-ink transition-colors hover:border-info hover:text-info disabled:cursor-not-allowed disabled:opacity-50"
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
            {/* «حفظ التغييرات» — its own row, the footer's last, so it sits
                under the thumb on a phone and is never pushed off by the
                buttons above. */}
            {handles && (
              <div
                className={cn(
                  "flex basis-full flex-wrap items-center gap-2 rounded-card border px-3 py-2 transition-colors",
                  dirty ? "border-warning/50 bg-warning/8" : "border-line bg-surface",
                )}
              >
                {/* Its own row on a phone: beside two buttons it was squeezed to
                    a word a line. */}
                <p
                  className="flex min-w-0 basis-full items-center gap-1.5 text-[0.76rem] font-extrabold sm:basis-auto sm:flex-1"
                  aria-live="polite"
                >
                  {saving ? (
                    <span className="inline-flex items-center gap-1.5 text-muted">
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      {t("ticketSaving")}
                    </span>
                  ) : saveState && saveState !== "saved" ? (
                    <span role="alert" className="text-brand">
                      {t.has(saveState.error) ? t(saveState.error as "updateFailed") : t("updateFailed")}
                    </span>
                  ) : dirty ? (
                    <span className="inline-flex items-center gap-1.5 text-warning">
                      <span className="size-2 shrink-0 rounded-full bg-warning" aria-hidden />
                      {t("ticketUnsaved", { count: changes.length, n: String(changes.length) })}
                    </span>
                  ) : saveState === "saved" ? (
                    <span className="inline-flex items-center gap-1.5 text-success">
                      <Check className="size-3.5" aria-hidden />
                      {t("ticketSaved")}
                    </span>
                  ) : (
                    <span className="font-medium text-muted">{t("ticketNoChanges")}</span>
                  )}
                </p>
                <div className="flex w-full gap-2 sm:w-auto">
                {dirty && !saving && (
                  <button
                    type="button"
                    onClick={discard}
                    className="press inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-control border border-line bg-surface px-3 py-2 text-[0.78rem] font-extrabold text-muted transition-colors hover:border-ink/30 hover:text-ink sm:flex-none"
                  >
                    <Undo2 className="size-4" aria-hidden />
                    {t("ticketDiscard")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={review}
                  disabled={!dirty || saving}
                  className="press inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-control bg-brand px-3 py-2 text-[0.82rem] font-black text-white shadow-brand-lift transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none sm:flex-none sm:px-4"
                >
                  {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
                  {t("ticketSave")}
                  {/* The count, beside the press; on a phone the line above says it. */}
                  {dirty && (
                    <span className="hidden rounded-chip bg-white/25 px-1.5 text-[0.7rem] sm:inline-block" data-numeric>
                      {changes.length}
                    </span>
                  )}
                </button>
                </div>
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

        {/* A ticket this reader cannot change says so first, so the greyed
            controls below read as a decision and not as a fault. */}
        {!handles && (
          <p className="flex items-center gap-2 rounded-card border border-line bg-subtle px-3.5 py-2.5 text-[0.78rem] font-bold text-muted">
            <Eye className="size-4 shrink-0" aria-hidden />
            {t(isTechnician ? "deskReadOnlyTech" : "deskReadOnlyManager")}
          </p>
        )}

        {/* ── 1. Where the ticket is — the four stages a manager reads ── */}
        <TicketCard
          icon={Activity}
          title={t("stageTitle")}
          tone="info"
          aside={
            <>
              <StagePill status={repair.status} size="lg" />
              <TechStepTag status={repair.status} />
              {repair.origin === "web" && <WebRequestMark />}
            </>
          }
        >
          {stage === "request" ? (
            <div className="space-y-3 rounded-card border border-gold-ink/30 bg-gold/10 p-3.5">
              <p className="flex items-start gap-2 text-[0.84rem] font-bold leading-relaxed text-ink">
                <Globe2 className="mt-0.5 size-4 shrink-0 text-gold-ink" aria-hidden />
                {t("requestBody")}
              </p>
              {full && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => decide(true)}
                    disabled={dirty}
                    className="press inline-flex items-center justify-center gap-2 rounded-control bg-success px-4 py-3 text-[0.88rem] font-black text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <CheckCircle2 className="size-5" aria-hidden />
                    {t("requestAccept")}
                  </button>
                  <button
                    type="button"
                    onClick={() => decide(false)}
                    disabled={dirty}
                    className="press inline-flex items-center justify-center gap-2 rounded-control border border-brand/45 bg-surface px-4 py-3 text-[0.88rem] font-black text-brand transition-colors hover:bg-brand/8 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <XCircle className="size-5" aria-hidden />
                    {t("requestRefuse")}
                  </button>
                </div>
              )}
              {full && dirty && (
                <p className="text-[0.72rem] font-bold leading-relaxed text-warning">{t("ticketSaveFirst")}</p>
              )}
            </div>
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-3" role="group" aria-label={t("stageTitle")}>
                {stages.map(({ key, icon: Icon }) => {
                  // «بانتظار الزبون» is reached through «مكتمل», so it lights that button.
                  const current = stage === key || (key === "completed" && stage === "waiting");
                  const look = STAGE_LOOK[key === "completed" && stage === "waiting" ? "waiting" : key];
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={!full || stage === key || dirty}
                      onClick={() => moveStage(key)}
                      aria-pressed={current}
                      className={cn(
                        "press flex items-center justify-center gap-2 rounded-control border px-3 py-3 text-[0.85rem] font-black transition-colors disabled:cursor-default",
                        current
                          ? cn("border-transparent", look.solid)
                          : "border-line bg-surface text-muted hover:border-ink/30 hover:text-ink",
                        (!full || dirty) && !current && "opacity-50",
                      )}
                    >
                      <Icon className="size-4.5" aria-hidden />
                      {key === "completed" && stage === "waiting" ? t("stage_waiting") : t(`stage_${key}`)}
                    </button>
                  );
                })}
              </div>
              {/* A stage is decided from the ticket as saved, so it waits for
                  «حفظ التغييرات» — said here, where the buttons went quiet. */}
              <p
                className={cn(
                  "text-[0.72rem] leading-relaxed",
                  full && dirty ? "font-bold text-warning" : "font-semibold text-muted",
                )}
              >
                {full && dirty ? t("ticketSaveFirst") : stage === "waiting" ? t("stageWaitingNote") : t("stageHint")}
              </p>
            </>
          )}
          {/* «تم التسليم للزبون» — a badge the bench sets, nothing to do with money. */}
          {stage !== "request" && (
            <HandedOverToggle
              at={repair.handedOverAt}
              by={repair.handedOverName}
              disabled={!handles}
              onToggle={toggleHanded}
            />
          )}
        </TicketCard>

        {/* ── 2. The customer and the device — corrected in place by a manager ── */}
        <TicketCard icon={UserRound} title={t("detailsTitle")} hint={full ? t("detailsHint") : undefined}>
          {full ? (
            <>
              <Grid cols={3}>
                <Field label={t("counterName")}>
                  <input
                    value={view.customerName}
                    onChange={(event) => edit({ customerName: event.target.value })}
                    className={text}
                  />
                </Field>
                <Field label={t("counterPhone")}>
                  <input
                    value={view.customerPhone}
                    onChange={(event) => edit({ customerPhone: event.target.value })}
                    inputMode="tel"
                    dir="ltr"
                    placeholder="07XXXXXXXXX"
                    className={text}
                    data-numeric
                  />
                </Field>
                <Field label={t("counterPhone2")}>
                  <input
                    value={view.customerPhone2 ?? ""}
                    onChange={(event) => edit({ customerPhone2: event.target.value })}
                    inputMode="tel"
                    dir="ltr"
                    placeholder="07XXXXXXXXX"
                    className={text}
                    data-numeric
                  />
                </Field>
              </Grid>
              {/* Changing the make clears the model; the save refuses until one
                  is picked, so the two always travel together. */}
              <DeviceFields
                brandCode={view.brandCode ?? ""}
                model={view.deviceModel}
                brands={brands}
                stock={stock}
                recent={recentDevices}
                onChange={(next) => edit({ brandCode: next.brandCode || null, deviceModel: next.model })}
              />
            </>
          ) : (
            <dl className="grid gap-x-4 gap-y-2.5 sm:grid-cols-3">
              <Fact label={t("repairCustomer")} value={repair.customerName} />
              {repair.customerPhone && <Fact label={t("repairPhone")} value={repair.customerPhone} numeric />}
              {repair.customerPhone2 && <Fact label={t("repairPhoneAlt")} value={repair.customerPhone2} numeric />}
              <Fact label={t("repairDevice")} value={repair.deviceModel} wide />
            </dl>
          )}
          {repair.customerPhone && (
            <ContactPanel
              name={repair.customerName}
              phone={repair.customerPhone}
              phone2={repair.customerPhone2}
              whatsappMessage={repairMessage(repair, t, statusLabel)}
              whatsappLabel={t("whatsappContact")}
              callLabel={t("callCustomer")}
            />
          )}
          {(repair.branchName || repair.addressLine || repair.preferredAt) && (
            <dl className="grid gap-x-4 gap-y-2.5 sm:grid-cols-3">
              {repair.branchName && <Fact label={t("repairBranch")} value={repair.branchName} />}
              {repair.preferredAt && (
                <Fact label={t("repairAppointment")} numeric value={formatDayTime(locale, repair.preferredAt)} />
              )}
              {repair.addressLine && <Fact label={t("repairAddress")} value={repair.addressLine} wide />}
            </dl>
          )}
        </TicketCard>

        {/* ── 3. What is wrong, who works it, and what became of it ── */}
        <TicketCard icon={Wrench} title={t("workCardTitle")}>
          {full && faultsEditable ? (
            <div className="min-w-0">
              <p className="mb-1 text-[0.72rem] font-bold text-muted">{t("repairIssues")}</p>
              <TicketFaults
                repair={repair}
                issues={issues}
                recent={recentFaults}
                values={view.faults}
                onChange={(next) => edit({ faults: next })}
              />
            </div>
          ) : (
            (repair.issues.length > 0 || repair.customFaults.length > 0) && (
              <dl className="grid gap-x-4 gap-y-2.5">
                {repair.issues.length > 0 && <Fact label={t("repairIssues")} value={repair.issues.join(" · ")} />}
                {repair.customFaults.length > 0 && (
                  <Fact label={t("repairCustomIssues")} value={repair.customFaults.join(" · ")} />
                )}
              </dl>
            )
          )}
          {repair.notes && (
            <p className="rounded-card border border-line bg-canvas px-3.5 py-2.5 text-[0.8rem] font-medium italic leading-relaxed text-muted">
              <span className="me-1.5 not-italic font-extrabold text-ink">{t("repairProblem")}:</span>“{repair.notes}”
            </p>
          )}
          <Grid>
            <Field label={t("deskHolder")}>
              {full ? (
                <SelectField
                  value={view.holderId ?? ""}
                  onChange={(value) => edit({ holderId: value || null })}
                  options={holderOptions}
                  ariaLabel={t("deskHolder")}
                />
              ) : (
                <HolderChip row={repair} viewerId={viewerId} />
              )}
            </Field>
            <Field label={t("repairResult")}>
              {handles ? (
                <textarea
                  rows={2}
                  value={view.quoteNotes ?? ""}
                  placeholder={t("repairResultPlaceholder")}
                  onChange={(event) => edit({ quoteNotes: event.target.value })}
                  className={cn(input, "resize-y")}
                />
              ) : (
                <p className="text-[0.82rem] font-bold text-ink">{repair.quoteNotes || t("editEmpty")}</p>
              )}
            </Field>
          </Grid>

          {/* Damage photos belong to a broken device; a programming job has
              none, so its frame is drawn only when there are some. */}
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
                  onClick={() => setLightbox({ urls: repair.photosAfter, at: index })}
                  className="relative size-20 overflow-hidden rounded-card border border-line transition-opacity hover:opacity-85"
                >
                  <Image src={url} alt="" fill sizes="80px" className="object-cover" />
                </button>
              ))}
              {handles && (
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  disabled={uploading}
                  className="flex size-20 flex-col items-center justify-center gap-1 rounded-card border-2 border-dashed border-line text-muted transition-colors hover:border-brand hover:text-brand disabled:opacity-50"
                >
                  {uploading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ImagePlus className="size-4" aria-hidden />}
                  <span className="text-[0.58rem] font-bold">{uploading ? t("uploading") : t("addPhotos")}</span>
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
        </TicketCard>

        {/* ── 4. The money — the two figures one above the other, then how it is paid ── */}
        {(seesMoney || handles) && (
          <TicketCard icon={Banknote} title={t("financeTitle")} hint={seesMoney ? t("financeCardHint") : undefined} tone="success">
            {/* ⚠️ Required: a fee can be changed, never emptied — refused by
                «حفظ التغييرات» and said under the row (`planTicketSave`). */}
            <PriceRows
              base={base}
              cost={view.costPrice}
              warranty={warranty ?? 0}
              showCost={seesMoney && financeAvailable}
              missing={priceMissing}
              baseDisabled={!handles}
              costDisabled={!full}
              onBase={(next) => {
                edit({ basePrice: next });
                if (next != null && next > 0) setPriceMissing(false);
              }}
              onCost={(next) => edit({ costPrice: next })}
            />

            {seesMoney && !financeAvailable && (
              <p className="rounded-card border border-dashed border-warning/50 bg-warning/6 px-3 py-2.5 text-[0.78rem] font-bold text-warning">
                {t("financeUnavailable")}
              </p>
            )}

            {seesMoney && financeAvailable && (
              <>
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("financeTerms")}>
                  {(["cash", "deferred"] as PaymentTerms[]).map((terms) => {
                    const on = view.paymentTerms === terms;
                    return (
                      <button
                        key={terms}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        disabled={!full}
                        // Cash is paid in full, so «الواصل» goes with the switch when it is saved.
                        onClick={() => !on && edit({ paymentTerms: terms })}
                        className={cn(
                          "press flex flex-col items-start gap-0.5 rounded-control border-2 px-3.5 py-2.5 text-start transition-colors disabled:cursor-not-allowed",
                          on
                            ? terms === "deferred"
                              ? "border-warning bg-warning/10"
                              : "border-success bg-success/10"
                            : "border-line bg-surface hover:border-ink/30",
                        )}
                      >
                        <span className={cn("text-[0.95rem] font-black", on ? (terms === "deferred" ? "text-warning" : "text-success") : "text-ink")}>
                          {t(terms === "cash" ? "termsCash" : "termsDeferred")}
                        </span>
                        <span className="text-[0.68rem] font-semibold leading-snug text-muted">
                          {t(terms === "cash" ? "termsCashHint" : "termsDeferredHint")}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {view.paymentTerms === "deferred" ? (
                  /* ⚠️ Only on a deferred ticket — the shop, 2026-11-17. */
                  <div className="space-y-2.5 rounded-card border border-warning/35 bg-warning/5 p-3">
                    <Field label={t("financeCollected")}>
                      <MoneyInput
                        value={collected}
                        clearable
                        onChange={(value) => edit({ collected: value })}
                        min={0}
                        disabled={!full}
                      />
                    </Field>
                    <OwedLine remaining={money.remaining}>
                      {full && money.remaining > 0 && total != null && (
                        <button
                          type="button"
                          onClick={payRest}
                          className="press inline-flex items-center gap-2 rounded-control bg-success px-3.5 py-2 text-[0.8rem] font-extrabold text-white transition-opacity hover:opacity-90"
                        >
                          <HandCoins className="size-4" aria-hidden />
                          {t("financePayRest", { amount: formatPrice(money.remaining) })}
                        </button>
                      )}
                    </OwedLine>
                    <p className="text-[0.7rem] font-bold leading-relaxed text-muted">{t("financeDeferredRule")}</p>
                  </div>
                ) : (
                  <p className="flex items-center gap-2 rounded-card border border-success/30 bg-success/6 px-3 py-2 text-[0.76rem] font-bold text-success">
                    <Banknote className="size-4 shrink-0" aria-hidden />
                    {t("financeCashRule")}
                  </p>
                )}

                {/* The warranty — its own decision with its own price, folded
                    with what it holds on the fold. Added to what the customer
                    pays; never profit. */}
                <section className="rounded-card border-2 border-info/40 bg-info/6">
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
                      <p className="text-[0.74rem] font-medium leading-relaxed text-muted">{t("warrantyHint")}</p>
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
                                onChange={(value) => edit({ warrantyPrice: value })}
                                min={0}
                                disabled={!full}
                              />
                            </Field>
                            <Field label={t("warrantyDurationField")}>
                              <NumberInput
                                value={warrantyDays}
                                clearable
                                onChange={(value) => edit({ warrantyDays: value })}
                                min={1}
                                max={3650}
                                disabled={!full}
                              />
                            </Field>
                            <Field label={t("warrantyFrom")}>
                              <DateField
                                type="date"
                                value={warrantyStart}
                                onChange={(event) => edit({ warrantyStart: event.target.value || null })}
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
              </>
            )}
          </TicketCard>
        )}

        {/* ── 5. How it got here, with when — folded until asked for ── */}
        <StatusHistory
          kind="repair"
          id={repair.id}
          status={repair.status}
          label={(status) => (tTrack.has(`status_${status}`) ? tTrack(`status_${status}` as "status_received") : status)}
        />

        {/* ⚠️ Inside the window, never beside it — see the note on detached windows. */}
        {lightbox && (
          <ImageLightbox
            images={lightbox.urls.map((url) => ({ url, alt: repair.deviceModel }))}
            startIndex={lightbox.at}
            onClose={() => setLightbox(null)}
          />
        )}

        {confirm.dialog}

        {/* The one question before anything is saved: every change, before
            and after, as two cells each — written as one Arabic sentence, a
            code, an arrow and two figures reorder into something nobody can
            read. */}
        <ConfirmDialog
          open={reviewing}
          tone="normal"
          title={t("ticketReviewTitle")}
          body={t("ticketReviewBody", { code: repair.code })}
          confirmLabel={t("ticketSave")}
          cancelLabel={t("ticketReviewBack")}
          pending={saving}
          onConfirm={() => void saveChanges()}
          onCancel={() => !saving && setReviewing(false)}
        >
          <ul className="max-h-[45dvh] space-y-2.5 overflow-y-auto overscroll-contain pe-1">
            {changes.map((key) => {
              const line = changeLine(key);
              return (
                <li key={key}>
                  <p className="mb-1 text-[0.74rem] font-black text-ink">{line.field}</p>
                  <dl className="grid grid-cols-2 gap-2">
                    <div className="rounded-card border border-line bg-subtle px-3 py-2">
                      <dt className="text-[0.66rem] font-bold text-muted">{t("editBefore")}</dt>
                      <dd className="mt-0.5 break-words text-[0.86rem] font-black text-muted">
                        <bdi>{line.from}</bdi>
                      </dd>
                    </div>
                    <div className="rounded-card border border-brand/30 bg-brand/6 px-3 py-2">
                      <dt className="text-[0.66rem] font-bold text-brand">{t("editAfter")}</dt>
                      <dd className="mt-0.5 break-words text-[0.86rem] font-black text-ink">
                        <bdi>{line.to}</bdi>
                      </dd>
                    </div>
                  </dl>
                </li>
              );
            })}
          </ul>
        </ConfirmDialog>
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
          <StagePill status={repair.status} />
          <TechStepTag status={repair.status} />
          <HandedOverMark at={repair.handedOverAt} />
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

      {/* «تم التسليم للزبون» — his to set on a ticket in his name; it moves no money. */}
      {mine && (
        <Section title={t("handedOver")} hint={t("handedOverHint")}>
          <HandedOverToggle
            at={repair.handedOverAt}
            by={repair.handedOverName}
            onToggle={(handed) =>
              onApply(
                { handedOverAt: handed ? new Date().toISOString() : null, handedOverName: null },
                () => setRepairHandedOver(repair.id, handed),
              )
            }
          />
        </Section>
      )}

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

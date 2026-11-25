"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  CheckCircle2,
  CircleCheckBig,
  ClipboardList,
  Globe2,
  HandCoins,
  Hourglass,
  ListFilter,
  PackageCheck,
  PencilLine,
  RotateCcw,
  Search,
  Target,
  UserRound,
  Wrench,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { RepairsBoard } from "@/components/admin/repairs-board";
import { Select } from "@/components/ui/select";
import { filterTickets, type TicketFilters } from "@/lib/data/desk-board";
import { owesMoney } from "@/lib/data/desk-figures";
import { stageOf } from "@/lib/data/repair-stage";
import type { DeskTotals } from "@/lib/data/repair-desk";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DeskRow } from "@/lib/queries/repair-desk";
import { ReturnsCard, TabHeading } from "@/components/admin/maintenance/figure-cards";
import type { DeskGoal, DeskShared } from "@/components/admin/maintenance/desk-shared";

/**
 * كشف التذاكر — every ticket the period holds, cut into the shop's lists
 * (2026-11-24):
 *
 * - **مكتمل** — completed in the period: نقد, and آجل paid in full.
 * - **غير مكتمل** — آجل غير واصل (waiting for the customer to pay the rest) and
 *   قيد الطلب (on the bench), opened in the period or paid in it; the open ones
 *   from earlier days are one press away.
 * - **ملغي**, **مرتجع** (with its card) and **طلبات الموقع** — the website's
 *   bookings, from any day, until a manager accepts or refuses them.
 * - **الديون** — every آجل ticket still owing, from any day: the way back to
 *   them (the shop, 2026-11-20), and where the safe's debts card lands.
 *
 * Every list, filter and word typed is worked out in the browser from the
 * period's rows (`lib/data/desk-board.ts`): nothing here asks the server.
 */
export type TicketList = "all" | "completed" | "incomplete" | "cancelled" | "returned" | "owing" | "requests";

export const TICKET_LISTS: readonly TicketList[] = ["all", "completed", "incomplete", "cancelled", "returned", "owing", "requests"];
type Part = "all" | "waiting" | "progress";

/** The pickers' field — `Select` carries no skin of its own. */
const pickerField = "h-10 rounded-control border border-line bg-canvas px-3 text-[0.8rem] font-bold text-ink transition-colors hover:border-brand/45 focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/20";

const NO_FILTERS: TicketFilters = { terms: null, holder: null, handed: null, edited: false, mine: false, search: "" };

const byCreated = (a: DeskRow, b: DeskRow) => b.createdAt.localeCompare(a.createdAt);
const byCompleted = (a: DeskRow, b: DeskRow) => (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt);
const byReturned = (a: DeskRow, b: DeskRow) =>
  (b.returned?.at ?? b.createdAt).localeCompare(a.returned?.at ?? a.createdAt);

export function TicketsTab({
  shared,
  totals,
  list,
  onList,
  openId,
  goal,
}: {
  shared: DeskShared;
  /** The period's figures — the «مرتجع» card reads them. */
  totals: DeskTotals | null;
  list: TicketList;
  onList: (list: TicketList) => void;
  openId: string | null;
  goal: DeskGoal | null;
}) {
  const t = useTranslations("Admin");
  const { data, lists, olderOpen, seesMoney } = shared;
  const { isTech, authority, viewer, desk } = data;

  const [filters, setFilters] = useState<TicketFilters>(NO_FILTERS);
  const [part, setPart] = useState<Part>("all");
  /** The open tickets from earlier days — a technician's list always holds them. */
  const [older, setOlder] = useState(isTech);

  // Every آجل ticket still owing, whatever day — a debt is a fact about now.
  const owing = useMemo(
    () => [...lists.waiting, ...olderOpen].filter((row) => owesMoney(row)).sort(byCreated),
    [lists.waiting, olderOpen],
  );

  // A list's rows, before the filters: each in the order that list is read in.
  const base = useMemo(() => {
    const incomplete = [...lists.incomplete, ...(older ? olderOpen : [])];
    switch (list) {
      case "completed":
        return [...lists.completed].sort(byCompleted);
      case "incomplete": {
        const wanted = part === "waiting" ? "waiting" : "accepted";
        const rows = part === "all" ? incomplete : incomplete.filter((row) => stageOf(row.status) === wanted);
        return [...rows].sort(byCreated);
      }
      case "cancelled":
        return [...lists.cancelled].sort(byCreated);
      case "returned":
        return [...lists.returned].sort(byReturned);
      case "requests":
        return [...lists.requests].sort(byCreated);
      case "owing":
        return owing;
      default: {
        const seen = new Set<string>();
        return [...lists.completed, ...incomplete, ...lists.cancelled, ...lists.returned]
          .filter((row) => (seen.has(row.id) ? false : (seen.add(row.id), true)))
          .sort(byCreated);
      }
    }
  }, [lists, olderOpen, older, list, part, owing]);

  const rows = useMemo(() => {
    const narrowed = filterTickets(base, filters, viewer.id);
    // A ticket asked for by address (an alert, the bell) is on the list even
    // when the list would not hold it, so its window can open.
    if (openId && !narrowed.some((row) => row.id === openId)) {
      const asked = desk.rows.find((row) => row.id === openId);
      if (asked) return [asked, ...narrowed];
    }
    return narrowed;
  }, [base, filters, viewer.id, openId, desk.rows]);

  // The count on each list's chip, after the filters.
  const count = (rowsOf: DeskRow[]) => filterTickets(rowsOf, filters, viewer.id).length;
  const incompleteAll = older ? [...lists.incomplete, ...olderOpen] : lists.incomplete;
  const allCount = (() => {
    const seen = new Set<string>();
    return filterTickets(
      [...lists.completed, ...incompleteAll, ...lists.cancelled, ...lists.returned].filter((row) =>
        seen.has(row.id) ? false : (seen.add(row.id), true),
      ),
      filters,
      viewer.id,
    ).length;
  })();

  const tabs: { key: TicketList; label: string; Icon: LucideIcon; count: number; tone: string }[] = [
    { key: "all", label: t("ticketsAll"), Icon: ClipboardList, count: allCount, tone: "text-ink" },
    { key: "completed", label: t("ticketsListCompleted"), Icon: CircleCheckBig, count: count(lists.completed), tone: "text-success" },
    { key: "incomplete", label: t("ticketsIncomplete"), Icon: Hourglass, count: count(incompleteAll), tone: "text-warning" },
    { key: "cancelled", label: t("ticketsCancelled"), Icon: XCircle, count: count(lists.cancelled), tone: "text-muted" },
    ...(seesMoney && desk.returns !== null
      ? [{ key: "returned" as const, label: t("ticketsReturned"), Icon: RotateCcw, count: count(lists.returned), tone: "text-gold-ink" }]
      : []),
    ...(seesMoney
      ? [{ key: "owing" as const, label: t("ticketsOwing"), Icon: HandCoins, count: count(owing), tone: "text-warning" }]
      : []),
    ...(!isTech
      ? [{ key: "requests" as const, label: t("ticketsRequests"), Icon: Globe2, count: lists.requests.length, tone: "text-info" }]
      : []),
  ];

  const active =
    filters.terms !== null ||
    filters.holder !== null ||
    filters.handed !== null ||
    filters.edited ||
    filters.mine ||
    filters.search.trim() !== "";
  const set = (patch: Partial<TicketFilters>) => setFilters((current) => ({ ...current, ...patch }));

  return (
    <div className="space-y-3.5">
      <TabHeading
        Icon={ClipboardList}
        title={t("deskTab_tickets")}
        hint={isTech ? t("ticketsTechHint") : t("ticketsHint")}
      />

      {isTech && goal && <GoalBar goal={goal} />}

      {/* The lists — one press each, with how many each holds. */}
      <nav
        aria-label={t("ticketsLists")}
        className="-mx-1 flex gap-2 overflow-x-auto overscroll-x-contain px-1 pb-1 sm:flex-wrap sm:overflow-visible"
      >
        {tabs.map((tab) => {
          const on = list === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => onList(tab.key)}
              aria-pressed={on}
              className={cn(
                "press inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-card border px-3.5 text-[0.82rem] font-extrabold transition-colors",
                on ? "border-brand bg-brand text-white shadow-sm" : "border-line bg-surface text-ink hover:border-brand/45",
              )}
            >
              <tab.Icon className={cn("size-4", on ? "text-white" : tab.tone)} aria-hidden />
              {tab.label}
              <span
                className={cn(
                  "min-w-6 rounded-full px-1.5 text-center text-[0.7rem] font-black",
                  on ? "bg-white/22 text-white" : "bg-subtle text-ink",
                )}
                data-numeric
              >
                {formatPrice(tab.count)}
              </span>
            </button>
          );
        })}
      </nav>

      {/* غير مكتمل has two halves, the shop's words for each. */}
      {list === "incomplete" && (
        <div role="group" aria-label={t("ticketsIncomplete")} className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ["all", t("all"), lists.incomplete.length + (older ? olderOpen.length : 0)],
              ["waiting", t("ticketsWaiting"), incompleteAll.filter((row) => stageOf(row.status) === "waiting").length],
              ["progress", t("ticketsProgress"), incompleteAll.filter((row) => stageOf(row.status) === "accepted").length],
            ] as [Part, string, number][]
          ).map(([key, label, n]) => (
            <button
              key={key}
              type="button"
              aria-pressed={part === key}
              onClick={() => setPart(key)}
              className={cn(
                "press inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[0.76rem] font-extrabold transition-colors",
                part === key ? "border-warning bg-warning/12 text-ink" : "border-line bg-canvas text-muted hover:text-ink",
              )}
            >
              {label}
              <span data-numeric className="font-black text-ink">
                {formatPrice(n)}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* What else narrows it — the words, the payment, who holds it, the badge. */}
      <section aria-label={t("filterTitle")} className="space-y-2 rounded-panel border border-line bg-surface p-3 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[14rem] flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input
              type="search"
              value={filters.search}
              onChange={(event) => set({ search: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Escape") set({ search: "" });
              }}
              placeholder={t("deskSearchPlaceholder")}
              aria-label={t("deskSearch")}
              className="h-10 w-full rounded-control border border-line bg-canvas ps-9 pe-3 text-[0.84rem] font-bold text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
          </label>
          {seesMoney && (
            <Select
              value={filters.terms ?? ""}
              onChange={(value) => set({ terms: value === "cash" || value === "deferred" ? value : null })}
              options={[
                { value: "", label: `${t("financeTerms")}: ${t("all")}` },
                { value: "cash", label: t("termsCash") },
                { value: "deferred", label: t("termsDeferred") },
              ]}
              aria-label={t("financeTerms")}
              className="w-40 max-sm:w-full"
              triggerClassName={pickerField}
            />
          )}
          {!isTech && (
            <Select
              value={filters.holder ?? ""}
              onChange={(value) => set({ holder: value || null })}
              options={shared.holderOptions.map((option) =>
                option.value === "" ? { ...option, label: `${t("deskTechnician")}: ${option.label}` } : option,
              )}
              aria-label={t("deskTechnician")}
              className="w-48 max-sm:w-full"
              triggerClassName={pickerField}
            />
          )}
          <Select
            value={filters.handed ?? ""}
            onChange={(value) => set({ handed: value === "yes" || value === "no" ? value : null })}
            options={[
              { value: "", label: t("ticketsHandedAll") },
              { value: "yes", label: t("handedOver") },
              { value: "no", label: t("handedOverNot") },
            ]}
            aria-label={t("handedOver")}
            className="w-52 max-sm:w-full"
              triggerClassName={pickerField}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Toggle on={filters.edited} onPress={() => set({ edited: !filters.edited })} Icon={PencilLine} label={t("deskTabEdited")} />
          {!isTech && authority.manages && (
            <Toggle on={filters.mine} onPress={() => set({ mine: !filters.mine })} Icon={UserRound} label={t("deskTabMine")} />
          )}
          {active && (
            <button
              type="button"
              onClick={() => setFilters(NO_FILTERS)}
              className="ms-auto inline-flex items-center gap-1 rounded-control px-2 py-1 text-[0.74rem] font-extrabold text-brand hover:underline"
            >
              <X className="size-3.5" aria-hidden />
              {t("ticketsResetFilters")}
            </button>
          )}
          <span className="ms-auto inline-flex items-center gap-1 text-[0.72rem] font-bold text-muted">
            <ListFilter className="size-3.5" aria-hidden />
            {t("deskListCount", { count: rows.length })}
          </span>
        </div>
      </section>

      {/* The open tickets from earlier days: one press puts them on the list. */}
      {(list === "incomplete" || list === "all") && olderOpen.length > 0 && !isTech && (
        <button
          type="button"
          onClick={() => setOlder((value) => !value)}
          aria-pressed={older}
          className="flex w-full flex-wrap items-center gap-2 rounded-card border border-warning/45 bg-warning/8 px-4 py-2.5 text-start text-[0.8rem] font-bold text-ink transition-colors hover:border-warning"
        >
          <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />
          {t("deskOlderOpen", { count: olderOpen.length })}
          <span className="ms-auto font-extrabold text-brand">{older ? t("ticketsOlderHide") : t("deskOlderOpenShow")}</span>
        </button>
      )}

      {list === "returned" && totals && (
        <ReturnsCard totals={totals} finance={desk.available.finance} warranty={desk.available.warranty} />
      )}

      {list === "owing" && (
        <p className="flex flex-wrap items-center gap-2 rounded-card border border-warning/45 bg-warning/8 px-4 py-2.5 text-[0.8rem] font-bold text-ink">
          <HandCoins className="size-4 shrink-0 text-warning" aria-hidden />
          {t("deskOwingBanner")}
        </p>
      )}

      {list === "requests" && (
        <p className="flex flex-wrap items-center gap-2 rounded-card border border-info/40 bg-info/6 px-4 py-2.5 text-[0.8rem] font-bold text-ink">
          <Globe2 className="size-4 shrink-0 text-info" aria-hidden />
          {t("ticketsRequestsHint")}
        </p>
      )}

      {list === "completed" && seesMoney && (
        <p className="flex flex-wrap items-center gap-2 rounded-card border border-success/35 bg-success/6 px-4 py-2.5 text-[0.78rem] font-bold text-ink">
          <PackageCheck className="size-4 shrink-0 text-success" aria-hidden />
          {t("ticketsCompletedHint")}
        </p>
      )}

      {desk.truncated && <p className="text-[0.75rem] font-bold text-warning">{t("deskTruncated")}</p>}

      <RepairsBoard
        flow={data.flow}
        rows={rows}
        initialOpenId={openId}
        holders={shared.holders}
        viewerId={viewer.id}
        manages={authority.manages}
        seesMoney={seesMoney}
        isTechnician={isTech}
        financeAvailable={desk.available.finance}
        warrantyAvailable={desk.available.warranty}
        canDelete={data.canDelete}
        showDays={desk.window.from !== desk.window.to || list === "requests" || older}
        dayOf={list === "completed" ? (row) => row.completedAt ?? row.createdAt : list === "returned" ? (row) => (row as DeskRow).returned?.at ?? row.createdAt : undefined}
        todayDay={data.today}
        issues={data.issues}
        recentFaults={data.recentFaults}
        faultsEditable={data.faultsEditable}
        brands={data.brands}
        stock={data.models}
        recentDevices={data.recentDevices}
      />
    </div>
  );
}

function Toggle({ on, onPress, Icon, label }: { on: boolean; onPress: () => void; Icon: LucideIcon; label: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onPress}
      className={cn(
        "press inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[0.76rem] font-extrabold transition-colors",
        on ? "border-brand bg-brand/10 text-brand" : "border-line bg-canvas text-muted hover:text-ink",
      )}
    >
      {on ? <CheckCircle2 className="size-3.5" aria-hidden /> : <Icon className="size-3.5" aria-hidden />}
      {label}
    </button>
  );
}

/** A technician's goal, set by his manager on the team page. */
function GoalBar({ goal }: { goal: DeskGoal }) {
  const t = useTranslations("Admin");
  return (
    <section className="rounded-panel border border-gold/45 bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[0.9rem] font-black text-ink">
          <Target className="size-4 text-gold-ink" aria-hidden />
          {t("goalTitle")}
        </h3>
        <span className="text-[0.8rem] font-extrabold text-ink">
          <span data-numeric>
            {formatPrice(goal.value)} / {formatPrice(goal.target)}
          </span>{" "}
          {goal.targetKind === "points" ? t("goalUnitPoints") : t("goalUnitJobs")}
        </span>
      </div>
      <div
        className="mt-3 h-3 overflow-hidden rounded-full bg-subtle"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={goal.target}
        aria-valuenow={goal.value}
        aria-label={t("goalTitle")}
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-500", goal.reached ? "bg-success" : "bg-gold")}
          style={{ width: `${Math.round(goal.progress * 100)}%` }}
        />
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-[0.78rem] font-bold text-muted">
        <Wrench className="size-3.5" aria-hidden />
        {goal.reached ? <span className="text-success">{t("goalReached")} </span> : null}
        {goal.reward}
      </p>
    </section>
  );
}

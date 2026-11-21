"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  Banknote,
  BarChart3,
  CalendarClock,
  ChevronDown,
  CircleCheckBig,
  CircleDollarSign,
  ClipboardList,
  HandCoins,
  History,
  Hourglass,
  ListChecks,
  Loader2,
  Plus,
  Receipt,
  RotateCcw,
  Search,
  ShieldCheck,
  Target,
  Ticket,
  TrendingUp,
  Wallet,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { FilterChips } from "@/components/admin/filter-chips";
import { QueueToolbar } from "@/components/admin/queue-toolbar";
import { RepairsBoard, type DeskHolder } from "@/components/admin/repairs-board";
import {
  ReportButtons,
  ReportPrintDialog,
  useProfitReport,
  type ProfitReport,
  type ReportContext,
  type ReportJob,
} from "@/components/admin/profit-report";
import { DeskTicketButton } from "@/components/admin/desk-ticket";
import { PrinterSetupButton } from "@/components/admin/printer-setup";
import { StatPress, type StatDetail } from "@/components/admin/stat-detail";
import { LockedPanel, useGuardedAction } from "@/components/admin/desk-gate";
import { searchDeskTickets } from "@/lib/actions/repair-desk";
import { formatDayNumeric, formatDayTime } from "@/lib/data/datetime";
import {
  repairMoney,
  worksTheBench,
  type DeskAuthority,
  type DeskTotals,
  type PaymentTerms,
  type RepairService,
} from "@/lib/data/repair-desk";
import { describeReturn, returnDirection, type MoneyFilter, type ReturnSummary, type StatsStatus } from "@/lib/data/desk-figures";
import { formatPrice } from "@/lib/format";
import { statMoney } from "@/lib/data/stat-money";
import { cn } from "@/lib/utils";
import type { RepairStatus } from "@/lib/data/orders";
import type { QueueWindow } from "@/lib/data/queue-window";
import type { RecentDevice } from "@/lib/data/recent-devices";
import type { RecentFault } from "@/lib/data/repair-faults";
import type { StockModel } from "@/lib/data/device-catalogue";
import type { DeskBoard, DeskPerson, DeskRow, DeskStats, DeskView } from "@/lib/queries/repair-desk";

/**
 * One bench's page, drawn — shared by the dashboard (`repair-desk-page.tsx`,
 * which reads the data on the server) and the desktop app (`desk-page.tsx`,
 * which reads it from its own database). Both used to carry a line-by-line
 * copy of this body, figures and per-person table included; one copy cannot
 * drift from the other.
 *
 * ---------------------------------------------------------------------------
 * Two panels
 * ---------------------------------------------------------------------------
 * The shop, 2026-11-17: the figures in a panel of their own, beside the
 * tickets.
 *
 * - **التذاكر** — adding a ticket, the filters and the search, the status
 *   chips and the list: everything about finding, opening and working a
 *   ticket. It is what the page opens on.
 * - **الإحصائيات** — the money cards with their own status filter, جرد الأرباح
 *   (A4 or A5 on the paper printer, or a PDF), a report of hand-picked
 *   tickets, the printer settings and the per-person table. A manager's only;
 *   in the desktop app it asks for the desk's password each time it is
 *   opened (`desk-gate.tsx`).
 *
 * ⚠️ **Moving between them is a press on this page, never a navigation**
 * (the shop, 2026-11-20: "the swapping takes a very long time"). Both panels
 * arrive with the page, from one read (`getRepairDesk`'s `stats`), so the
 * switch is a state change and `?panel=stats` is written with
 * `history.replaceState` — the address still says where the reader is, and a
 * reload or a filter still lands on the same panel.
 *
 * Ctrl+P on the page opens the report's print chooser instead of the
 * browser's (`ReportPrintDialog`) — in the desktop app only after the desk's
 * password.
 *
 * A technician has one panel and no money: only the tickets in his own name
 * (the server sends him nothing else), no add button, no tabs.
 */
export type RepairDeskViewData = {
  service: RepairService;
  basePath: string;
  viewer: { id: string; name: string };
  authority: DeskAuthority;
  people: DeskPerson[];
  isTech: boolean;
  defaultView: DeskView;
  view: DeskView;
  window: QueueWindow;
  search: string;
  status: string | null;
  /** The figures' own status filter (2026-11-20). Absent from an older desk app build. */
  statsStatus?: StatsStatus;
  /** "The tickets behind this card" — `?mf=`, pressed from a figures card. */
  moneyFilter?: MoneyFilter | null;
  /** The chips' statuses: the flow, then cancelled. */
  statuses: readonly RepairStatus[];
  /** The steps this deployment can store. */
  flow: readonly RepairStatus[];
  terms: PaymentTerms | null;
  tech: string | null;
  board: DeskBoard;
  counts: {
    mine: number;
    pending: number;
    olderOpen: number;
    /** Absent from an older desk app build. */
    edited?: number;
    /** Deferred tickets still owing, from any day. */
    owing?: number;
  };
  branches: { id: string; name: string }[];
  brands: { code: string; name: string }[];
  models: Record<string, StockModel[]>;
  recentDevices: RecentDevice[];
  recentFaults: RecentFault[];
  issues: { code: string; name: string }[];
  today: string;
  canDelete: boolean;
  faultsEditable: boolean;
  /**
   * The bench's default holder (`work_defaults`) — the counter's new-ticket
   * dialog opens on it. Null or absent: it opens on whoever is typing.
   */
  defaultHolderId?: string | null;
};

export type DeskPanel = "tickets" | "stats";

/** A technician's goal, as `getMyGoal` answers it. */
export type DeskGoal = {
  reward: string;
  value: number;
  target: number;
  progress: number;
  targetKind: "jobs" | "points";
  reached: boolean;
};

export function RepairDeskView({
  data,
  locale,
  panel: asked,
  openId,
  goal = null,
  notices,
}: {
  data: RepairDeskViewData;
  locale: string;
  panel: DeskPanel;
  openId: string | null;
  goal?: DeskGoal | null;
  /** What the app draws above the panels — work waiting to reach the server. */
  notices?: ReactNode;
}) {
  const t = useTranslations("Admin");
  const tStatus = useTranslations("Track");

  const {
    service,
    basePath,
    viewer,
    authority,
    people,
    isTech,
    defaultView,
    view,
    window,
    search,
    status,
    statuses,
    flow,
    terms,
    tech,
    board,
    counts,
    today,
  } = data;
  const statsStatus: StatsStatus = data.statsStatus ?? "all";
  const moneyFilter = data.moneyFilter ?? null;

  /** The figures are a manager's. Never a technician's, never somebody who reads no money. */
  const hasStats = authority.seesMoney && !isTech && Boolean(board.stats);

  /*
   * Which panel is showing — the address's answer, then the reader's presses.
   * Adjusted during render when a navigation lands, never in an effect copying
   * a prop into state.
   *
   * ⚠️ "A navigation landed" is any filter changing, not only `panel`. A
   * press switches the panel without telling the router (the desk app's
   * router does not hear `replaceState` at all), so the `panel` prop can be
   * the same before and after a link out of the figures — the debts card to
   * «الآجل», say — and comparing it alone would leave the reader where they
   * were. A refresh (a save, a sync pass) keeps every filter, and keeps the
   * panel the reader chose.
   */
  const landing = JSON.stringify([asked, view, window.query, status, search, terms, tech, statsStatus, moneyFilter]);
  const [chosen, setChosen] = useState<DeskPanel>(asked);
  const [seenLanding, setSeenLanding] = useState(landing);
  if (landing !== seenLanding) {
    setSeenLanding(landing);
    setChosen(asked);
  }
  const panel: DeskPanel = chosen === "stats" && hasStats ? "stats" : "tickets";

  function showPanel(next: DeskPanel) {
    setChosen(next);
    try {
      // `globalThis`, because `window` here is the period.
      const url = new URL(globalThis.location.href);
      if (next === "stats") url.searchParams.set("panel", "stats");
      else url.searchParams.delete("panel");
      globalThis.history.replaceState(null, "", url);
    } catch {
      /* The address is a convenience; the panel has already changed. */
    }
  }

  const report = useProfitReport();
  const guard = useGuardedAction();
  const [chooser, setChooser] = useState(false);

  // Every filter now in the address, so each control can carry the others.
  const params: Record<string, string> = {
    ...window.query,
    ...(view !== defaultView ? { view } : {}),
    ...(status ? { status } : {}),
    ...(search ? { q: search } : {}),
    ...(terms ? { terms } : {}),
    ...(tech ? { tech } : {}),
    ...(statsStatus !== "all" ? { sstatus: statsStatus } : {}),
    ...(moneyFilter ? { mf: moneyFilter } : {}),
  };
  const without = (...keys: string[]) =>
    Object.fromEntries(Object.entries(params).filter(([key]) => !keys.includes(key)));
  /** The figures keep every filter but a card's own, which only narrows the tickets. */
  const statsParams = { ...without("mf"), panel: "stats" };
  const href = (query: Record<string, string>) => {
    const search = new URLSearchParams(query).toString();
    return search ? `${basePath}?${search}` : basePath;
  };
  /**
   * From a figures card to the tickets behind its figure (the shop,
   * 2026-11-20): the figures' period, person, cash or deferred, words and
   * status carried over, and the card's own filter (`MONEY_FILTERS`).
   */
  const cardHref = (filter: MoneyFilter) =>
    href({
      ...(board.stats?.window.query ?? window.query),
      ...(search ? { q: search } : {}),
      ...(terms ? { terms } : {}),
      ...(tech ? { tech } : {}),
      ...(statsStatus !== "all" ? { status: statsStatus, sstatus: statsStatus } : {}),
      mf: filter,
    });
  /** From the «راجع» card to the «راجع» list, over the figures' period. */
  const returnsHref = href({
    ...(board.stats?.window.query ?? window.query),
    ...(search ? { q: search } : {}),
    ...(terms ? { terms } : {}),
    ...(tech ? { tech } : {}),
    view: "returned",
  });
  // The «راجع» ledger is on this deployment (20261121_repair_returns.sql).
  const returnsOn = Boolean(board.stats?.returns);

  const totalAll = Object.values(board.counts).reduce((sum, n) => sum + n, 0);
  const cur = t("currency");
  const money = (n: number) => `${formatPrice(Math.round(n))} ${cur}`;
  const nameOf = (userId: string) => people.find((person) => person.userId === userId)?.name;
  const statusName = (value: string) =>
    value === "all"
      ? t("all")
      : value === "progress"
        ? t("statsProgress")
        : tStatus(`status_${value}` as "status_received");

  // Whom this reader may hand a ticket to, themselves first, then the
  // managers, then the technicians — the order the choice is usually made in.
  const order = { manager: 1, assistant: 2, technician: 3 } as const;
  const holders: DeskHolder[] = authority.assignable
    .flatMap((id) => {
      const person = people.find((candidate) => candidate.userId === id);
      if (person) return [{ id, name: person.name, rank: person.rank }];
      return id === viewer.id ? [{ id, name: viewer.name, rank: "manager" as const }] : [];
    })
    .sort(
      (a, b) =>
        Number(b.id === viewer.id) - Number(a.id === viewer.id) ||
        order[a.rank] - order[b.rank] ||
        a.name.localeCompare(b.name),
    );

  // Which period a list or the cards are for, in words, so a figure can be read on its own.
  const day = (value: string) => formatDayNumeric(locale, `${value}T09:00:00Z`);
  const periodOf = (span: QueueWindow) =>
    span.when === "open"
      ? t("whenOpen")
      : span.when === "all"
        ? t("whenAll")
        : span.from === span.to
          ? span.from === today
            ? `${t("dayToday")} · ${day(today)}`
            : day(span.from!)
          : `${day(span.from!)} — ${day(span.to!)}`;
  const statsPeriod = board.stats ? periodOf(board.stats.window) : periodOf(window);

  const statsScope = tech
    ? t("deskScopeTech", { name: tech === "none" ? t("unassigned") : (nameOf(tech) ?? "") })
    : t("deskScopeAll");

  const techOptions = [
    { value: "", label: t("deskAllTechs") },
    // `visible`, not `people`: an owner's name is not offered to anybody below
    // them — see `deskAuthority`. Every person on the bench, managers too (the
    // shop, 2026-11-18): a ticket is held by a manager as often as by a
    // technician, and a filter that cannot find it hides it. The ones who
    // work at the bench come first.
    ...people
      .filter((person) => authority.visible.includes(person.userId))
      .sort((a, b) => Number(worksTheBench(b)) - Number(worksTheBench(a)))
      .map((person) => ({ value: person.userId, label: person.name })),
    { value: "none", label: t("unassigned") },
  ];
  const termsSelect = {
    name: "terms",
    label: t("financeTerms"),
    value: terms ?? "",
    options: [
      { value: "", label: t("all") },
      { value: "cash", label: t("termsCash") },
      { value: "deferred", label: t("termsDeferred") },
    ],
  };
  // The figures' own status (2026-11-20): every ticket, the three groups the
  // devices card splits into, then each step.
  const statsStatusSelect = {
    name: "sstatus",
    label: t("filterStatus"),
    value: statsStatus === "all" ? "" : statsStatus,
    options: [
      { value: "", label: t("all") },
      { value: "progress", label: t("statsProgress") },
      { value: "completed", label: statusName("completed") },
      { value: "cancelled", label: statusName("cancelled") },
      ...flow
        .filter((step) => step !== "completed")
        .map((step) => ({ value: step, label: statusName(step) })),
    ],
  };
  const toolbarLabels = {
    presets: {
      today: t("whenToday"),
      yesterday: t("whenYesterday"),
      "7": t("whenDays", { count: 7 }),
      "30": t("whenDays", { count: 30 }),
      all: t("whenAll"),
    },
    open: t("whenOpen"),
    lastDays: { before: t("whenLastBefore"), after: t("whenLastAfter") },
    custom: t("periodCustom"),
    from: t("periodFrom"),
    to: t("periodTo"),
    apply: t("periodApply"),
    search: t("deskSearch"),
    searchPlaceholder: t("deskSearchPlaceholder"),
    clear: t("deskClear"),
  };

  const deskName = service === "software" ? t("programmingDesk") : t("repairDesk");
  const stats = board.stats;
  const reportContext: ReportContext = {
    desk: deskName,
    period: statsPeriod,
    filters: [
      ...(statsStatus !== "all" ? [`${t("filterStatus")}: ${statusName(statsStatus)}`] : []),
      ...(tech ? [`${t("deskTechnician")}: ${tech === "none" ? t("unassigned") : (nameOf(tech) ?? "")}`] : []),
      ...(terms ? [`${t("financeTerms")}: ${t(terms === "cash" ? "termsCash" : "termsDeferred")}`] : []),
      ...(search ? [`${t("deskSearch")}: ${search}`] : []),
    ],
  };
  const reportJob: ReportJob = {
    rows: stats?.rows ?? [],
    // «راجع» gets a section of its own, drawn only when there is one.
    returns: (stats?.returnRows ?? []).flatMap((row) => (row.returned ? [{ ...row, returned: row.returned }] : [])),
    context: reportContext,
    totals: stats?.totals,
    includeCancelled: statsStatus === "cancelled",
  };

  /*
   * Ctrl+P is the report's (the shop, 2026-11-20): a chooser of A4, A5 or a
   * PDF instead of the browser's dialog, which on the counter PC would print
   * this screen on the label printer. Behind the desk's password where there
   * is one — closing the password leaves nothing open. Read through a ref the
   * effect keeps current, so the listener is installed once.
   */
  const openChooser = useRef<() => void>(() => {});
  useEffect(() => {
    openChooser.current = () => guard.run("stats", () => setChooser(true));
  });
  useEffect(() => {
    if (!hasStats) return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (event.code !== "KeyP" && event.key.toLowerCase() !== "p") return;
      event.preventDefault();
      event.stopPropagation();
      openChooser.current();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [hasStats]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-[1.15rem] font-black text-ink">{deskName}</h1>
          <p className="text-[0.8rem] font-medium text-muted">
            {isTech ? t("deskTechSub") : service === "software" ? t("programmingDeskSub") : t("repairDeskSub")}
          </p>
        </div>
        {authority.manages && panel === "tickets" && (
          <DeskTicketButton
            service={service}
            branches={data.branches}
            brands={data.brands}
            models={data.models}
            recentDevices={data.recentDevices}
            recentFaults={data.recentFaults}
            issues={data.issues}
            holders={holders}
            viewerId={viewer.id}
            defaultHolderId={data.defaultHolderId ?? null}
            today={today}
            financeAvailable={board.available.finance}
            warrantyAvailable={board.available.warranty}
          />
        )}
      </header>

      {hasStats && (
        <nav aria-label={t("deskPanels")} className="inline-flex rounded-control border border-line bg-surface p-1 shadow-card">
          <PanelButton active={panel === "tickets"} icon={Ticket} label={t("deskPanelTickets")} onPress={() => showPanel("tickets")} />
          <PanelButton active={panel === "stats"} icon={BarChart3} label={t("deskPanelStats")} onPress={() => showPanel("stats")} />
        </nav>
      )}

      {notices}
      {report.ui}

      {service === "software" && !board.available.service && (
        <p className="rounded-card border border-dashed border-warning/50 bg-warning/6 px-4 py-3 text-[0.8rem] font-bold text-warning">
          {t("deskUnavailable")}
        </p>
      )}

      {panel === "stats" && stats ? (
        <LockedPanel reason="stats" onCancel={() => showPanel("tickets")}>
          <StatsPanel
            locale={locale}
            data={data}
            stats={stats}
            params={statsParams}
            selects={[
              statsStatusSelect,
              termsSelect,
              { name: "tech", label: t("deskTechnician"), value: tech ?? "", options: techOptions },
            ]}
            toolbarLabels={toolbarLabels}
            period={statsPeriod}
            scopeLabel={statsScope}
            money={money}
            report={report}
            reportJob={reportJob}
            cardHref={cardHref}
            returnsHref={returnsHref}
            techHref={(holderId) => href({ ...statsParams, tech: holderId ?? "none" })}
          />
        </LockedPanel>
      ) : (
        <>
          {/* ── What the reader is asking for: which list, which period, which
              words, which status. Everything that narrows the board is in this
              one block, and the tickets follow it. ── */}
          <section aria-label={t("filterTitle")} className="space-y-2.5">
            {!isTech && (
              <FilterChips
                basePath={basePath}
                param="view"
                active={view === defaultView ? null : view}
                keep={search ? { q: search } : {}}
                options={[
                  { value: null, label: t("deskTabAll") },
                  { value: "mine", label: t("deskTabMine"), count: counts.mine },
                  { value: "pending", label: t("deskTabPending"), count: counts.pending },
                  { value: "edited", label: t("deskTabEdited"), count: counts.edited },
                  // The deferred tickets still owing, from any day — the way
                  // back to them (the shop, 2026-11-20).
                  ...(hasStats ? [{ value: "owing", label: t("deskTabOwing"), count: counts.owing }] : []),
                  // «راجع» — tickets from an earlier day whose money changed
                  // in the period (the shop, 2026-11-21).
                  // Drawn only when the period has one (the shop, 2026-11-21:
                  // "only when there is راجع"), or while the reader is on it.
                  ...(hasStats && returnsOn && ((board.returnedCount ?? 0) > 0 || view === "returned")
                    ? [{ value: "returned", label: t("deskTabReturned"), count: board.returnedCount ?? 0 }]
                    : []),
                ]}
              />
            )}

            {isTech && goal && (
              <GoalBar
                title={t("goalTitle")}
                reward={goal.reward}
                value={goal.value}
                target={goal.target}
                progress={goal.progress}
                unit={goal.targetKind === "points" ? t("goalUnitPoints") : t("goalUnitJobs")}
                reachedLabel={t("goalReached")}
                reached={goal.reached}
              />
            )}

            <QueueToolbar
              locale={locale}
              basePath={basePath}
              window={window}
              search={search}
              params={without("panel")}
              active={[
                ...(status ? [{ name: "status", label: `${t("filterStatus")}: ${statusName(status)}` }] : []),
                ...(moneyFilter ? [{ name: "mf", label: `${t("deskBehind")}: ${t(`mf_${moneyFilter}`)}` }] : []),
              ]}
              selects={[
                ...(authority.seesMoney ? [termsSelect] : []),
                ...(view === "mine" || isTech
                  ? []
                  : [{ name: "tech", label: t("deskTechnician"), value: tech ?? "", options: techOptions }]),
              ]}
              labels={toolbarLabels}
            />

            <div className="flex min-w-0 items-center gap-2.5">
              <span className="shrink-0 text-[0.74rem] font-extrabold text-ink">{t("filterStatus")}</span>
              <div className="min-w-0 flex-1">
                <FilterChips
                  basePath={basePath}
                  active={status}
                  keep={without("status")}
                  options={[
                    { value: null, label: t("all"), count: totalAll },
                    ...statuses.map((value) => ({
                      value,
                      label: tStatus(`status_${value}` as "status_received"),
                      count: board.counts[value] ?? 0,
                    })),
                  ]}
                />
              </div>
            </div>
          </section>

          {/* Arrived from a figures card: say which, and the way back. */}
          {moneyFilter && hasStats && (
            <p className="flex flex-wrap items-center gap-2 rounded-card border border-info/40 bg-info/6 px-4 py-2.5 text-[0.8rem] font-bold text-ink">
              <BarChart3 className="size-4 shrink-0 text-info" aria-hidden />
              {t("deskBehindBanner", { card: t(`mf_${moneyFilter}`), count: board.rows.length })}
              <button
                type="button"
                onClick={() => showPanel("stats")}
                className="ms-auto font-extrabold text-brand hover:underline"
              >
                {t("deskBehindBack")}
              </button>
            </p>
          )}

          {view === "owing" && (
            <p className="flex flex-wrap items-center gap-2 rounded-card border border-warning/45 bg-warning/8 px-4 py-2.5 text-[0.8rem] font-bold text-ink">
              <HandCoins className="size-4 shrink-0 text-warning" aria-hidden />
              {t("deskOwingBanner")}
            </p>
          )}

          {view === "returned" && (
            <p className="flex flex-wrap items-center gap-2 rounded-card border border-gold-ink/40 bg-gold/10 px-4 py-2.5 text-[0.8rem] font-bold text-ink">
              <RotateCcw className="size-4 shrink-0 text-gold-ink" aria-hidden />
              {t("deskReturnedBanner")}
            </p>
          )}

          {authority.manages &&
            view === "all" &&
            counts.olderOpen > 0 &&
            window.when !== "open" &&
            window.when !== "all" && (
              <Link
                href={`${basePath}?when=open`}
                className="flex flex-wrap items-center gap-2 rounded-card border border-warning/45 bg-warning/8 px-4 py-2.5 text-[0.8rem] font-bold text-ink transition-colors hover:border-warning"
              >
                <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />
                {t("deskOlderOpen", { count: counts.olderOpen })}
                <span className="ms-auto font-extrabold text-brand">{t("deskOlderOpenShow")}</span>
              </Link>
            )}

          {/* A technician's page counts his own work — never money. */}
          {isTech && (
            <ul className="grid grid-cols-3 gap-2.5">
              {[
                { Icon: Wrench, label: t("deskTickets"), value: board.totals.tickets, tone: "text-info" },
                { Icon: Hourglass, label: t("deskOpen"), value: board.totals.open, tone: "text-warning" },
                { Icon: CircleCheckBig, label: t("deskCompleted"), value: board.totals.completed, tone: "text-success" },
              ].map((tile) => (
                <li
                  key={tile.label}
                  className="flex min-w-0 flex-col gap-1 rounded-panel border border-line bg-surface p-3 shadow-card"
                >
                  <span className="flex items-center gap-1.5 text-[0.7rem] font-bold text-muted">
                    <tile.Icon className={cn("size-4 shrink-0", tile.tone)} aria-hidden />
                    {tile.label}
                  </span>
                  <span className="text-[1.25rem] font-black leading-tight text-ink" data-numeric>
                    {formatPrice(tile.value)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {board.truncated && <p className="text-[0.75rem] font-bold text-warning">{t("deskTruncated")}</p>}

          <RepairsBoard
            // No key: the board keeps its open windows across a filter change,
            // and hears a new `?open=` (a notification, the bell) by itself.
            flow={flow}
            rows={board.rows}
            initialOpenId={openId}
            holders={holders}
            viewerId={viewer.id}
            manages={authority.manages}
            seesMoney={authority.seesMoney}
            isTechnician={isTech}
            financeAvailable={board.available.finance}
            warrantyAvailable={board.available.warranty}
            canDelete={data.canDelete}
            showDays={window.when !== "today" && window.when !== "yesterday"}
            todayDay={today}
            issues={data.issues}
            recentFaults={data.recentFaults}
            faultsEditable={data.faultsEditable}
          />
        </>
      )}

      {hasStats && (
        <ReportPrintDialog open={chooser} onClose={() => setChooser(false)} report={report} job={reportJob} />
      )}
      {guard.prompt}
    </div>
  );
}

function PanelButton({
  active,
  icon: Icon,
  label,
  onPress,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-2 rounded-[calc(var(--radius-control)-2px)] px-4 py-2 text-[0.82rem] font-extrabold transition-colors",
        active ? "bg-brand text-white shadow-sm" : "text-muted hover:bg-subtle hover:text-ink",
      )}
    >
      <Icon className="size-4" aria-hidden />
      {label}
    </button>
  );
}

/* ── The figures ──────────────────────────────────────────────────────────── */

type ToolbarSelect = { name: string; label: string; value: string; options: { value: string; label: string }[] };

function StatsPanel({
  locale,
  data,
  stats,
  params,
  selects,
  toolbarLabels,
  period,
  scopeLabel,
  money,
  report,
  reportJob,
  cardHref,
  returnsHref,
  techHref,
}: {
  locale: string;
  data: RepairDeskViewData;
  stats: DeskStats;
  params: Record<string, string>;
  selects: ToolbarSelect[];
  toolbarLabels: Parameters<typeof QueueToolbar>[0]["labels"];
  period: string;
  scopeLabel: string;
  money: (n: number) => string;
  report: ProfitReport;
  reportJob: ReportJob;
  cardHref: (filter: MoneyFilter) => string;
  returnsHref: string;
  techHref: (holderId: string | null) => string;
}) {
  const t = useTranslations("Admin");
  const { basePath, search, tech, board } = data;
  const totals = stats.totals;

  return (
    <div className="space-y-4">
      <QueueToolbar
        locale={locale}
        basePath={basePath}
        window={stats.window}
        search={search}
        params={params}
        selects={selects}
        labels={toolbarLabels}
      />

      <Figures
        totals={totals}
        finance={board.available.finance}
        warranty={board.available.warranty}
        closeLabel={t("close")}
        period={period}
        scope={scopeLabel}
        money={money}
        cardHref={cardHref}
        returnsHref={returnsHref}
      />

      {!stats.ledger && board.available.finance && (
        <p className="text-[0.72rem] font-semibold text-muted">{t("deskLedgerMissing")}</p>
      )}

      {stats.paidRows.length > 0 && <PaidEarlier rows={stats.paidRows} money={money} locale={locale} />}

      {(stats.returnRows?.length ?? 0) > 0 && <ReturnsList rows={stats.returnRows ?? []} money={money} locale={locale} />}

      {/* جرد الأرباح — the tickets the figures count, on A4 or A5 by the paper
          printer or as a PDF; a report of hand-picked tickets; and which
          printer is which on this machine. */}
      <section className="space-y-3 rounded-panel border border-line bg-surface px-3.5 py-3 shadow-card">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <ClipboardList className="size-5 shrink-0 text-brand" aria-hidden />
            <div className="min-w-0">
              <h2 className="text-[0.88rem] font-black text-ink">{t("deskReportTitle")}</h2>
              <p className="text-[0.74rem] font-bold text-muted">
                {t("deskListCount", { count: stats.rows.length })} · {t("printChooserShortcut")}
              </p>
            </div>
          </div>
          <div className="ms-auto flex flex-wrap items-center gap-2">
            <ReportButtons report={report} job={reportJob} />
            <PrinterSetupButton />
          </div>
        </div>
        <PickedReport
          service={data.service}
          locale={locale}
          report={report}
          desk={reportJob.context.desk}
          pool={[...stats.rows, ...stats.paidRows, ...board.rows]}
          money={money}
        />
      </section>

      {stats.byTech.length > 0 && (
        <TechTable
          rows={stats.byTech.map((row) => ({
            ...row,
            name: row.holderId ? row.name || t("workColleague") : t("unassigned"),
            href: techHref(row.holderId),
            active: tech === (row.holderId ?? "none"),
          }))}
          finance={board.available.finance}
          warranty={board.available.warranty}
          money={money}
          labels={{
            title: t("deskByTech"),
            name: t("deskHolder"),
            tickets: t("deskTickets"),
            completed: t("deskCompleted"),
            revenue: t("financePriceTotal"),
            warranty: t("warrantyTitle"),
            till: t("financeTill"),
            profit: t("financeProfitTotal"),
            outstanding: t("financeOutstanding"),
          }}
        />
      )}
    </div>
  );
}

const TONE: Record<string, string> = {
  info: "text-info",
  success: "text-success",
  brand: "text-brand",
  warning: "text-warning",
  muted: "text-muted",
};

type Tile = {
  Icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  tone: keyof typeof TONE;
  detail?: StatDetail;
  href?: string;
  /** How much of the figure is «راجع» — a change made on a later day (2026-11-21). */
  returned?: number;
};

/**
 * The colour of a change: red when it takes money off — the commonest «راجع»,
 * a price brought down (the shop, 2026-11-21) — green when it adds. Never the
 * only sign of it: the figure carries its own "+" or "-".
 */
function signTone(n: number): string {
  return n < 0 ? "text-brand" : n > 0 ? "text-success" : "";
}

/**
 * One half of the «راجع» card: the tickets brought down (red), brought up
 * (green), or what the till moved. Spans, not divs: the card is one link.
 */
function ReturnTotal({
  tone,
  label,
  amount,
  sub,
}: {
  tone: "down" | "up" | "till";
  label: string;
  amount: number;
  sub: string;
}) {
  return (
    <span
      className={cn(
        "flex min-w-[10rem] flex-1 flex-col gap-0.5 rounded-card border px-3 py-2",
        tone === "down" ? "border-brand/35 bg-brand/6" : tone === "up" ? "border-success/35 bg-success/6" : "border-line bg-surface",
      )}
    >
      <span className={cn("text-[0.72rem] font-extrabold", tone === "down" ? "text-brand" : tone === "up" ? "text-success" : "text-ink")}>
        {label}
      </span>
      <span className={cn("text-[1.15rem] font-black leading-tight", signTone(amount) || "text-ink")} data-numeric>
        {signedMoney(amount)}
      </span>
      <span className="text-[0.66rem] font-semibold text-muted">{sub}</span>
    </span>
  );
}

/** A change, with its sign: "+10,000", "-30,000". */
function signedMoney(n: number): string {
  const value = formatPrice(Math.abs(Math.round(n)));
  return n > 0 ? `+${value}` : n < 0 ? `-${value}` : value;
}

/**
 * The cards, as the shop defined each of them on 2026-11-20 — see
 * `DeskTotals` in `lib/data/repair-desk.ts` for the arithmetic, and
 * `lib/data/desk-figures.ts` for which day each is counted on.
 */
function Figures({
  totals,
  finance,
  warranty,
  closeLabel,
  period,
  scope,
  money,
  cardHref,
  returnsHref,
}: {
  totals: DeskTotals;
  finance: boolean;
  warranty: boolean;
  closeLabel: string;
  period: string;
  scope: string;
  money: (n: number) => string;
  cardHref: (filter: MoneyFilter) => string;
  returnsHref: string;
}) {
  const t = useTranslations("Admin");
  /*
   * The shop's order, 2026-11-20 (numbered on a screenshot): the tickets, what
   * they came to, what the parts cost, the profit — then the warranty and the
   * money that came in: cash, deferred, the till — and what is still owed.
   * Every card is a press to the tickets behind its figure (`cardHref`).
   */
  const tiles: Tile[] = [
    {
      Icon: Wrench,
      label: t("deskTickets"),
      value: formatPrice(totals.tickets),
      sub: t("deskTicketsSub", { completed: totals.completed, cancelled: totals.cancelled, open: totals.open }),
      tone: "info",
      href: cardHref("opened"),
    },
    {
      Icon: CircleDollarSign,
      label: t("financePriceTotal"),
      value: statMoney(totals.maintenance),
      sub: t("deskMaintenanceSub"),
      tone: "brand",
      href: cardHref("active"),
    },
  ];
  if (finance) {
    tiles.push(
      {
        Icon: Receipt,
        label: t("financeCostTotal"),
        value: statMoney(totals.cost),
        sub: totals.missingCost > 0 ? t("deskMissingCostSub", { count: totals.missingCost }) : money(totals.cost),
        tone: totals.missingCost > 0 ? "warning" : "muted",
        href: cardHref("cost"),
      },
      {
        Icon: TrendingUp,
        label: t("financeProfitTotal"),
        value: statMoney(totals.profit),
        sub: totals.missingCost > 0 ? t("deskProfitMissing", { count: totals.missingCost }) : t("deskProfitFormula"),
        tone: totals.profit < 0 ? "brand" : "success",
        href: cardHref("active"),
      },
    );
  }
  if (warranty) {
    tiles.push({
      Icon: ShieldCheck,
      label: t("warrantyTitle"),
      value: statMoney(totals.warranty),
      sub: t("deskWarrantySub", { count: totals.warrantyTickets }),
      tone: "info",
      href: cardHref("warranty"),
    });
  }
  if (finance) {
    tiles.push(
      {
        Icon: Banknote,
        label: t("financeCollectedCash"),
        value: statMoney(totals.collectedCash),
        sub: t("deskCashSub"),
        tone: "success",
        href: cardHref("cash"),
      },
      {
        Icon: CalendarClock,
        label: t("financeCollectedDeferred"),
        value: statMoney(totals.collectedDeferred),
        sub:
          totals.missingCollected > 0
            ? t("deskMissingCollectedSub", { count: totals.missingCollected })
            : t("deskDeferredSub"),
        tone: totals.missingCollected > 0 ? "warning" : "info",
        href: cardHref("deferred"),
      },
      // «واصل بالخزنة» — the shop's own sum, and every dinar in the drawer once.
      {
        Icon: Wallet,
        label: t("financeTill"),
        value: statMoney(totals.till),
        // Each figure isolated left-to-right: a refund makes one negative, and
        // the Arabic line would otherwise move its minus to the far side.
        sub: `${t(totals.returnTill ? "financeTillFormulaReturns" : "financeTillFormula")}: ${[
          totals.tillWarranty,
          totals.collectedCash,
          totals.collectedDeferred,
          ...(totals.returnTill ? [totals.returnTill] : []),
        ]
          .map((n) => `\u2066${formatPrice(n)}\u2069`)
          .join(" + ")}`,
        // The one card a «راجع» reaches (the shop, 2026-11-21).
        returned: totals.returnTill,
        tone: "success",
        href: cardHref("till"),
      },
      {
        Icon: HandCoins,
        label: t("financeOutstanding"),
        value: statMoney(totals.outstanding),
        sub: t("deskOwingSub", { count: totals.owing }),
        tone: totals.outstanding > 0 ? "warning" : "success",
        href: cardHref("owing"),
      },
    );
  } else {
    tiles.push({ Icon: Hourglass, label: t("deskOpen"), value: formatPrice(totals.open), tone: "warning" });
  }

  return (
    <section aria-label={scope} className="space-y-2">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.74rem] font-extrabold text-muted">
        <span>{scope}</span>
        <span className="rounded-chip bg-subtle px-2 py-0.5 text-ink">{period}</span>
        {totals.paidFromEarlier > 0 && (
          <span className="inline-flex items-center gap-1 rounded-chip bg-success/10 px-2 py-0.5 text-success">
            <History className="size-3" aria-hidden />
            {t("deskPaidEarlierChip", { count: totals.paidFromEarlier })}
          </span>
        )}
      </p>
      <ul
        className={cn(
          "grid grid-cols-2 gap-2.5 max-sm:[&>*:last-child:nth-child(odd)]:col-span-2",
          // A full rectangle at every count: nine is three rows of three, eight
          // two rows of four.
          tiles.length % 4 !== 0 && tiles.length % 3 === 0 ? "lg:grid-cols-3" : "lg:grid-cols-4",
        )}
      >
        {tiles.map((tile) => (
          <li key={tile.label} className="min-w-0">
            <StatPress
              href={tile.href}
              detail={tile.detail}
              closeLabel={closeLabel}
              className="flex h-full min-w-0 flex-col gap-1 rounded-panel border border-line bg-surface p-3 shadow-card"
            >
              <span className="flex items-center gap-1.5 text-[0.7rem] font-bold text-muted">
                <tile.Icon className={cn("size-4 shrink-0", TONE[tile.tone])} aria-hidden />
                {tile.label}
              </span>
              <span className="text-[1.25rem] font-black leading-tight text-ink" data-numeric>
                {tile.value}
              </span>
              {tile.sub && (
                <span className={cn("text-[0.68rem] font-medium", tile.tone === "warning" ? "text-warning" : "text-muted")}>
                  {tile.sub}
                </span>
              )}
              {tile.returned ? (
                <span className="mt-0.5 inline-flex w-fit items-center gap-1 rounded-chip bg-gold/15 px-2 py-0.5 text-[0.68rem] font-extrabold text-gold-ink">
                  <RotateCcw className="size-3 shrink-0" aria-hidden />
                  {t("deskTillReturns")}{" "}
                  <span data-numeric className={signTone(tile.returned)}>
                    {signedMoney(tile.returned)}
                  </span>
                </span>
              ) : null}
            </StatPress>
          </li>
        ))}
      </ul>

      {/* «راجع» — the shop, 2026-11-21: "a special statistics card called
          راجع will show the value of money changed or decreased", drawn only
          on a period that has one. None of the cards above counts it but the
          till; this card says what changed, down (سلبي) apart from up
          (إيجابي). */}
      {totals.returnTickets > 0 && (
        <StatPress
          href={returnsHref}
          closeLabel={closeLabel}
          className="flex min-w-0 flex-col gap-2.5 rounded-panel border border-gold-ink/45 bg-gold/8 p-3 shadow-card"
        >
          <span className="flex min-w-0 flex-wrap items-center gap-2.5">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-gold/20">
              <RotateCcw className="size-5 text-gold-ink" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-[0.86rem] font-black text-ink">
                {t("deskReturnsCard")} · {t("deskReturnsTickets", { count: totals.returnTickets })}
              </span>
              <span className="block text-[0.7rem] font-semibold text-muted">{t("deskReturnsApart")}</span>
            </span>
            <span className="ms-auto shrink-0 text-[0.72rem] font-extrabold text-brand">{t("deskReturnsShow")}</span>
          </span>
          <span className="flex min-w-0 flex-wrap gap-2">
            {totals.returnDownTickets > 0 && (
              <ReturnTotal
                tone="down"
                label={t("deskReturnsNegative")}
                amount={totals.returnDown}
                sub={t("deskReturnsTickets", { count: totals.returnDownTickets })}
              />
            )}
            {totals.returnUpTickets > 0 && (
              <ReturnTotal
                tone="up"
                label={t("deskReturnsPositive")}
                amount={totals.returnUp}
                sub={t("deskReturnsTickets", { count: totals.returnUpTickets })}
              />
            )}
            {finance && (
              <ReturnTotal tone="till" label={t("deskReturnsTill")} amount={totals.returnTill} sub={t("deskReturnsTillSub")} />
            )}
          </span>
          {(totals.returnCancelled > 0 || (warranty && totals.returnWarranty !== 0)) && (
            <span className="flex flex-wrap gap-x-4 gap-y-1 text-[0.7rem] font-bold text-muted">
              {totals.returnCancelled > 0 && <span>{t("deskReturnsCancelled", { count: totals.returnCancelled })}</span>}
              {warranty && totals.returnWarranty !== 0 && (
                <span>
                  {t("deskReturnsWarranty")}{" "}
                  <span data-numeric className={signTone(totals.returnWarranty)}>
                    {signedMoney(totals.returnWarranty)}
                  </span>
                </span>
              )}
            </span>
          )}
        </StatPress>
      )}
    </section>
  );
}

/**
 * Tickets opened before the period whose money came in within it — the
 * deferred ticket from yesterday settled today (the shop, 2026-11-20). Folded
 * until asked for; the chip above the cards says how many.
 */
function PaidEarlier({ rows, money, locale }: { rows: DeskRow[]; money: (n: number) => string; locale: string }) {
  const t = useTranslations("Admin");
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-panel border border-success/30 bg-success/5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-start text-[0.8rem] font-extrabold text-ink"
      >
        <History className="size-4 shrink-0 text-success" aria-hidden />
        {t("deskPaidEarlierTitle", { count: rows.length })}
        <ChevronDown className={cn("ms-auto size-4 text-muted transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <ul className="divide-y divide-success/15 border-t border-success/20 px-3.5">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2 text-[0.78rem]">
              <span className="font-extrabold text-info" data-numeric>
                {row.code}
              </span>
              <span className="font-bold text-ink">{row.customerName}</span>
              <span className="text-muted">{row.deviceModel}</span>
              <span className="text-[0.7rem] text-muted">{t("deskOpenedOn", { when: formatDayTime(locale, row.createdAt) })}</span>
              <span className="ms-auto font-black text-success" data-numeric>
                {money(row.paidWithin ?? 0)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * «راجع» — the tickets whose money changed in the period on a later day than
 * they were opened, each with what changed (the shop, 2026-11-21). Folded
 * until asked for; the «راجع» card above says how much.
 */
function ReturnsList({ rows, money, locale }: { rows: DeskRow[]; money: (n: number) => string; locale: string }) {
  const t = useTranslations("Admin");
  const [open, setOpen] = useState(false);
  const priced = rows.filter((row): row is DeskRow & { returned: ReturnSummary } => Boolean(row.returned));
  // Down (سلبي) apart from up (إيجابي), each under its own heading and total
  // (the shop, 2026-11-21: "distinguished between the راجع سلبي … and ايجابي").
  const groups = (["down", "up"] as const)
    .map((direction) => ({
      direction,
      rows: priced.filter((row) => returnDirection(row.returned) === direction),
    }))
    .filter((group) => group.rows.length > 0);
  return (
    <section className="rounded-panel border border-gold-ink/35 bg-gold/6">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3.5 py-2.5 text-start text-[0.8rem] font-extrabold text-ink"
      >
        <RotateCcw className="size-4 shrink-0 text-gold-ink" aria-hidden />
        {t("deskReturnsListTitle", { count: priced.length })}
        <ChevronDown className={cn("ms-auto size-4 text-muted transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open &&
        groups.map((group) => {
          const down = group.direction === "down";
          const total = group.rows.reduce((sum, row) => sum + row.returned.price, 0);
          return (
            <div key={group.direction} className="border-t border-gold-ink/20">
              <p
                className={cn(
                  "flex flex-wrap items-center gap-x-2 px-3.5 py-2 text-[0.76rem] font-black",
                  down ? "bg-brand/6 text-brand" : "bg-success/6 text-success",
                )}
              >
                {t(down ? "deskReturnsNegative" : "deskReturnsPositive")}
                <span className="font-bold text-muted">· {t("deskReturnsTickets", { count: group.rows.length })}</span>
                <span className="ms-auto" data-numeric>
                  {signedMoney(total)}
                </span>
              </p>
              <ul className="divide-y divide-gold-ink/15 px-3.5">
                {group.rows.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2 text-[0.78rem]">
                    <span className="font-extrabold text-info" data-numeric>
                      {row.code}
                    </span>
                    <span className="font-bold text-ink">{row.customerName}</span>
                    <span className="text-muted">{row.deviceModel}</span>
                    <span className="text-[0.7rem] text-muted">{t("deskOpenedOn", { when: formatDayTime(locale, row.createdAt) })}</span>
                    <span className="text-[0.72rem] font-bold text-gold-ink">
                      <ReturnWords summary={row.returned} money={money} />
                    </span>
                    <span className={cn("ms-auto font-black", down ? "text-brand" : "text-success")} data-numeric>
                      {signedMoney(row.returned.price)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
    </section>
  );
}

/** What one «راجع» was, in words: "Price 50,000 → 60,000", "Cancelled after delivery". */
export function ReturnWords({ summary, money }: { summary: ReturnSummary; money: (n: number) => string }) {
  const t = useTranslations("Admin");
  const described = describeReturn(summary);
  if (described.kind !== "edit") return <>{t(`deskReturnKind_${described.kind}`)}</>;
  return (
    <>
      {described.changes.map((change, index) => (
        <span key={change.field}>
          {index > 0 && " · "}
          {t(`deskReturnField_${change.field}`)}{" "}
          <span data-numeric>{money(change.from)}</span> {t("deskReturnArrow")} <span data-numeric>{money(change.to)}</span>
        </span>
      ))}
    </>
  );
}

/* ── A report of hand-picked tickets ─────────────────────────────────────── */

const fold = (value: string | null | undefined) => (value ?? "").toLocaleLowerCase();

/** The fields a ticket is found by, typed loosely. */
function matches(row: DeskRow, needle: string): boolean {
  return [row.code, row.customerName, row.customerPhone, row.customerPhone2, row.deviceModel, row.notes, ...row.issues, ...row.customFaults]
    .some((value) => fold(value).includes(needle));
}

/**
 * «طباعة تذاكر محددة» — the shop, 2026-11-20: "an option to print an exact
 * ticket or a group of tickets' statistics, collapsed until it is needed, the
 * tickets added by a smart search by name, phone, device, code". Folded until
 * pressed. A search looks at the tickets already on the page first, at once,
 * then at every ticket on the bench (`searchDeskTickets`).
 */
function PickedReport({
  service,
  locale,
  report,
  desk,
  pool,
  money,
}: {
  service: RepairService;
  locale: string;
  report: ProfitReport;
  desk: string;
  pool: DeskRow[];
  money: (n: number) => string;
}) {
  const t = useTranslations("Admin");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ query: string; rows: DeskRow[] } | null>(null);
  const [picked, setPicked] = useState<DeskRow[]>([]);
  const [searching, startSearch] = useTransition();

  const needle = fold(query.trim());
  const local = needle.length >= 2 ? pool.filter((row) => matches(row, needle)) : [];
  const remote = found && found.query === needle ? found.rows : [];
  const seen = new Set<string>();
  const results = [...local, ...remote].filter((row) => (seen.has(row.id) ? false : (seen.add(row.id), true))).slice(0, 30);
  const pickedIds = new Set(picked.map((row) => row.id));

  // Every ticket on the bench, a moment after the typing stops.
  useEffect(() => {
    if (needle.length < 2) return;
    const timer = setTimeout(() => {
      startSearch(async () => {
        const answer = await searchDeskTickets(service, needle, locale);
        if (answer.ok) setFound({ query: needle, rows: answer.rows });
      });
    }, 280);
    return () => clearTimeout(timer);
  }, [needle, service, locale]);

  const job: ReportJob = {
    rows: picked,
    context: { desk, period: t("deskPickPeriod", { count: picked.length }), filters: [] },
    includeCancelled: true,
  };

  const add = (row: DeskRow) => setPicked((current) => (current.some((item) => item.id === row.id) ? current : [...current, row]));

  return (
    <div className="rounded-card border border-dashed border-line">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-[0.8rem] font-extrabold text-ink"
      >
        <ListChecks className="size-4 shrink-0 text-brand" aria-hidden />
        {t("deskPickTitle")}
        {picked.length > 0 && (
          <span className="rounded-full bg-brand px-2 py-0.5 text-[0.66rem] font-black text-white" data-numeric>
            {picked.length}
          </span>
        )}
        <ChevronDown className={cn("ms-auto size-4 text-muted transition-transform", open && "rotate-180")} aria-hidden />
      </button>

      {open && (
        <div className="space-y-3 border-t border-line px-3 pb-3 pt-2.5">
          <p className="text-[0.72rem] font-medium text-muted">{t("deskPickHint")}</p>
          <label className="relative block">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("deskPickSearch")}
              aria-label={t("deskPickSearch")}
              className="h-10 w-full rounded-control border border-line bg-canvas ps-9 pe-9 text-[0.82rem] font-bold text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
            />
            {searching && (
              <Loader2 className="absolute end-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted" aria-hidden />
            )}
          </label>

          {needle.length >= 2 && (
            <ul className="max-h-64 space-y-1 overflow-y-auto overscroll-contain">
              {results.length === 0 && !searching && (
                <li className="px-1 py-2 text-[0.76rem] font-bold text-muted">{t("deskPickEmpty")}</li>
              )}
              {results.map((row) => {
                const already = pickedIds.has(row.id);
                const total = repairMoney({
                  price: row.price,
                  warranty: row.warrantyPrice,
                  cost: row.costPrice,
                  collected: row.collected,
                  terms: row.paymentTerms,
                }).price;
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      disabled={already}
                      onClick={() => add(row)}
                      className="press flex w-full flex-wrap items-center gap-x-2.5 gap-y-0.5 rounded-control px-2 py-1.5 text-start text-[0.78rem] transition-colors hover:bg-brand/6 disabled:opacity-50"
                    >
                      {already ? (
                        <CircleCheckBig className="size-4 shrink-0 text-success" aria-hidden />
                      ) : (
                        <Plus className="size-4 shrink-0 text-brand" aria-hidden />
                      )}
                      <span className="font-extrabold text-info" data-numeric>
                        {row.code}
                      </span>
                      <span className="font-bold text-ink">{row.customerName}</span>
                      <span className="text-muted">{row.deviceModel}</span>
                      <span className="text-[0.7rem] text-muted">{formatDayTime(locale, row.createdAt)}</span>
                      {total > 0 && (
                        <span className="ms-auto font-black text-brand" data-numeric>
                          {money(total)}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {picked.length > 0 && (
            <div className="space-y-2.5">
              <ul className="flex flex-wrap gap-1.5">
                {picked.map((row) => (
                  <li
                    key={row.id}
                    className="inline-flex items-center gap-1.5 rounded-chip border border-brand/30 bg-brand/6 py-0.5 ps-2 pe-1 text-[0.72rem] font-bold text-ink"
                  >
                    <span className="text-info" data-numeric>
                      {row.code}
                    </span>
                    <span className="max-w-32 truncate">{row.customerName}</span>
                    <button
                      type="button"
                      onClick={() => setPicked((current) => current.filter((item) => item.id !== row.id))}
                      aria-label={t("deskPickRemove", { code: row.code })}
                      className="press rounded-full p-0.5 text-muted hover:bg-brand hover:text-white"
                    >
                      <X className="size-3" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center gap-2">
                <ReportButtons report={report} job={job} />
                <button
                  type="button"
                  onClick={() => setPicked([])}
                  className="rounded-control px-3 py-2 text-[0.76rem] font-bold text-muted hover:bg-subtle hover:text-ink"
                >
                  {t("deskPickClear")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Per person ───────────────────────────────────────────────────────────── */

function TechTable({
  rows,
  finance,
  warranty,
  money,
  labels,
}: {
  rows: (DeskTotals & { holderId: string | null; name: string; href: string; active: boolean })[];
  finance: boolean;
  warranty: boolean;
  money: (n: number) => string;
  labels: Record<
    "title" | "name" | "tickets" | "completed" | "revenue" | "warranty" | "till" | "profit" | "outstanding",
    string
  >;
}) {
  return (
    <section className="rounded-panel border border-line bg-surface shadow-card">
      <h2 className="border-b border-line px-4 py-2.5 text-[0.85rem] font-black text-ink">{labels.title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[42rem] text-[0.78rem]">
          <thead>
            <tr className="text-start text-[0.68rem] font-bold text-muted">
              <th className="px-4 py-2 text-start">{labels.name}</th>
              <th className="px-3 py-2 text-end">{labels.tickets}</th>
              <th className="px-3 py-2 text-end">{labels.completed}</th>
              <th className="px-3 py-2 text-end">{labels.revenue}</th>
              {warranty && <th className="px-3 py-2 text-end">{labels.warranty}</th>}
              {finance && <th className="px-3 py-2 text-end">{labels.till}</th>}
              {finance && <th className="px-3 py-2 text-end">{labels.profit}</th>}
              {finance && <th className="px-3 py-2 text-end">{labels.outstanding}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.holderId ?? "none"} className={cn("border-t border-line/70", row.active && "bg-brand/6")}>
                <td className="px-4 py-2">
                  <Link href={row.href} scroll={false} className="font-extrabold text-ink hover:text-brand">
                    {row.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-end font-bold" data-numeric>{formatPrice(row.tickets)}</td>
                <td className="px-3 py-2 text-end font-bold" data-numeric>{formatPrice(row.completed)}</td>
                <td className="px-3 py-2 text-end font-bold" data-numeric>{money(row.maintenance)}</td>
                {warranty && <td className="px-3 py-2 text-end font-bold text-info" data-numeric>{money(row.warranty)}</td>}
                {finance && <td className="px-3 py-2 text-end font-bold text-success" data-numeric>{money(row.till)}</td>}
                {finance && <td className={cn("px-3 py-2 text-end font-bold", row.profit < 0 ? "text-brand" : "text-success")} data-numeric>{money(row.profit)}</td>}
                {finance && <td className={cn("px-3 py-2 text-end font-bold", row.outstanding > 0 && "text-warning")} data-numeric>{money(row.outstanding)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ── The technician's goal ────────────────────────────────────────────────── */

function GoalBar({
  title,
  reward,
  value,
  target,
  progress,
  unit,
  reached,
  reachedLabel,
}: {
  title: string;
  reward: string;
  value: number;
  target: number;
  progress: number;
  unit: string;
  reached: boolean;
  reachedLabel: string;
}) {
  return (
    <section className="rounded-panel border border-gold/45 bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[0.9rem] font-black text-ink">
          <Target className="size-4 text-gold-ink" aria-hidden />
          {title}
        </h2>
        <span className="text-[0.8rem] font-extrabold text-ink">
          <span data-numeric>
            {formatPrice(value)} / {formatPrice(target)}
          </span>{" "}
          {unit}
        </span>
      </div>
      <div
        className="mt-3 h-3 overflow-hidden rounded-full bg-subtle"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={target}
        aria-valuenow={value}
        aria-label={title}
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-500", reached ? "bg-success" : "bg-gold")}
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
      <p className="mt-2 text-[0.78rem] font-bold text-muted">
        {reached ? <span className="text-success">{reachedLabel} </span> : null}
        {reward}
      </p>
    </section>
  );
}

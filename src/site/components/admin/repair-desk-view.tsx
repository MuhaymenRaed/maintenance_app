"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  Banknote,
  BarChart3,
  CalendarClock,
  CircleCheckBig,
  CircleDollarSign,
  ClipboardList,
  HandCoins,
  Hourglass,
  Receipt,
  ShieldCheck,
  Target,
  Ticket,
  TrendingUp,
  Wallet,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { FilterChips } from "@/components/admin/filter-chips";
import { QueueToolbar } from "@/components/admin/queue-toolbar";
import { RepairsBoard, type DeskHolder } from "@/components/admin/repairs-board";
import { ProfitReportActions, type ReportContext } from "@/components/admin/profit-report";
import { DeskTicketButton } from "@/components/admin/desk-ticket";
import { PrinterSetupButton } from "@/components/admin/printer-setup";
import { StatPress, type StatDetail } from "@/components/admin/stat-detail";
import { LockedPanel } from "@/components/admin/desk-gate";
import { formatDayNumeric } from "@/lib/data/datetime";
import { worksTheBench, type DeskAuthority, type DeskTotals, type PaymentTerms, type RepairService } from "@/lib/data/repair-desk";
import { formatPrice } from "@/lib/format";
import { statMoney } from "@/lib/data/stat-money";
import { cn } from "@/lib/utils";
import type { RepairStatus } from "@/lib/data/orders";
import type { QueueWindow } from "@/lib/data/queue-window";
import type { RecentDevice } from "@/lib/data/recent-devices";
import type { RecentFault } from "@/lib/data/repair-faults";
import type { StockModel } from "@/lib/data/device-catalogue";
import type { DeskBoard, DeskPerson, DeskView } from "@/lib/queries/repair-desk";

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
 * - **الإحصائيات** — the money cards, «واصل بالخزنة» among them, جرد الأرباح
 *   (print, A4 or a PDF to keep), the printer settings and the per-person
 *   table. A manager's only; in the desktop app it asks for the desk's
 *   password each time it is opened (`desk-gate.tsx`).
 *
 * `?panel=stats` is which one is showing, so each is a link and survives a
 * reload. ⚠️ The way into the figures drops the status and the tab: the cards
 * have always ignored the status, and the report is of the whole bench in the
 * period unless a person or a payment is chosen there.
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
  /** The chips' statuses: the flow, then cancelled. */
  statuses: readonly RepairStatus[];
  /** The steps this deployment can store. */
  flow: readonly RepairStatus[];
  terms: PaymentTerms | null;
  tech: string | null;
  board: DeskBoard;
  counts: { mine: number; pending: number; olderOpen: number; /** Absent from an older desk app build. */ edited?: number };
  branches: { id: string; name: string }[];
  brands: { code: string; name: string }[];
  models: Record<string, StockModel[]>;
  recentDevices: RecentDevice[];
  recentFaults: RecentFault[];
  issues: { code: string; name: string }[];
  today: string;
  canDelete: boolean;
  faultsEditable: boolean;
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

  /** The figures are a manager's. Never a technician's, never somebody who reads no money. */
  const hasStats = authority.seesMoney && !isTech;
  const panel: DeskPanel = asked === "stats" && hasStats ? "stats" : "tickets";

  // Every filter now in the address, so each control can carry the others.
  const params: Record<string, string> = {
    ...window.query,
    ...(view !== defaultView ? { view } : {}),
    ...(status ? { status } : {}),
    ...(search ? { q: search } : {}),
    ...(terms ? { terms } : {}),
    ...(tech ? { tech } : {}),
  };
  const without = (...keys: string[]) =>
    Object.fromEntries(Object.entries(params).filter(([key]) => !keys.includes(key)));
  /** The figures' own filters: no status, no tab — see the note at the top. */
  const statsParams = { ...without("status", "view"), panel: "stats" };
  const href = (query: Record<string, string>) => {
    const search = new URLSearchParams(query).toString();
    return search ? `${basePath}?${search}` : basePath;
  };

  const totalAll = Object.values(board.counts).reduce((sum, n) => sum + n, 0);
  const cur = t("currency");
  const money = (n: number) => `${formatPrice(Math.round(n))} ${cur}`;
  const nameOf = (userId: string) => people.find((person) => person.userId === userId)?.name;

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

  // Which period the cards are for, in words, so a figure can be read on its own.
  const day = (value: string) => formatDayNumeric(locale, `${value}T09:00:00Z`);
  const period =
    window.when === "open"
      ? t("whenOpen")
      : window.when === "all"
        ? t("whenAll")
        : window.from === window.to
          ? window.from === today
            ? `${t("dayToday")} · ${day(today)}`
            : day(window.from!)
          : `${day(window.from!)} — ${day(window.to!)}`;

  const scopeLabel =
    view === "mine"
      ? t("deskScopeMine")
      : view === "pending"
        ? t("deskScopePending")
        : view === "edited"
          ? t("deskScopeEdited")
          : tech
          ? t("deskScopeTech", { name: tech === "none" ? t("unassigned") : (nameOf(tech) ?? "") })
          : t("deskScopeAll");

  const techOptions = [
    { value: "", label: t("deskAllTechs") },
    // `visible`, not `people`: an owner's name is not offered to anybody below
    // them — see `deskAuthority`. And `worksTheBench`, because the control says
    // "technician" and used to list every manager beside them.
    ...people
      .filter((person) => authority.visible.includes(person.userId) && worksTheBench(person))
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

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-[1.15rem] font-black text-ink">
            {service === "software" ? t("programmingDesk") : t("repairDesk")}
          </h1>
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
            today={today}
            financeAvailable={board.available.finance}
            warrantyAvailable={board.available.warranty}
          />
        )}
      </header>

      {hasStats && (
        <nav aria-label={t("deskPanels")} className="inline-flex rounded-control border border-line bg-surface p-1 shadow-card">
          <PanelLink
            href={href(without("panel"))}
            active={panel === "tickets"}
            icon={Ticket}
            label={t("deskPanelTickets")}
          />
          <PanelLink href={href(statsParams)} active={panel === "stats"} icon={BarChart3} label={t("deskPanelStats")} />
        </nav>
      )}

      {notices}

      {service === "software" && !board.available.service && (
        <p className="rounded-card border border-dashed border-warning/50 bg-warning/6 px-4 py-3 text-[0.8rem] font-bold text-warning">
          {t("deskUnavailable")}
        </p>
      )}

      {panel === "stats" ? (
        <LockedPanel reason="stats" cancelHref={href(without("panel"))}>
          <StatsPanel
            locale={locale}
            data={data}
            params={statsParams}
            techOptions={techOptions}
            termsSelect={termsSelect}
            toolbarLabels={toolbarLabels}
            period={period}
            scopeLabel={scopeLabel}
            money={money}
            report={{
              desk: service === "software" ? t("programmingDesk") : t("repairDesk"),
              period,
              filters: [
                ...(tech ? [`${t("deskTechnician")}: ${tech === "none" ? t("unassigned") : (nameOf(tech) ?? "")}`] : []),
                ...(terms ? [`${t("financeTerms")}: ${t(terms === "cash" ? "termsCash" : "termsDeferred")}`] : []),
                ...(search ? [`${t("deskSearch")}: ${search}`] : []),
              ],
            }}
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
              params={params}
              active={
                status
                  ? [{ name: "status", label: `${t("filterStatus")}: ${tStatus(`status_${status}` as "status_received")}` }]
                  : []
              }
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
    </div>
  );
}

function PanelLink({
  href,
  active,
  icon: Icon,
  label,
}: {
  href: string;
  active: boolean;
  icon: LucideIcon;
  label: string;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex items-center gap-2 rounded-[calc(var(--radius-control)-2px)] px-4 py-2 text-[0.82rem] font-extrabold transition-colors",
        active ? "bg-brand text-white shadow-sm" : "text-muted hover:bg-subtle hover:text-ink",
      )}
    >
      <Icon className="size-4" aria-hidden />
      {label}
    </Link>
  );
}

/* ── The figures ──────────────────────────────────────────────────────────── */

function StatsPanel({
  locale,
  data,
  params,
  techOptions,
  termsSelect,
  toolbarLabels,
  period,
  scopeLabel,
  money,
  report,
  techHref,
}: {
  locale: string;
  data: RepairDeskViewData;
  params: Record<string, string>;
  techOptions: { value: string; label: string }[];
  termsSelect: { name: string; label: string; value: string; options: { value: string; label: string }[] };
  toolbarLabels: Parameters<typeof QueueToolbar>[0]["labels"];
  period: string;
  scopeLabel: string;
  money: (n: number) => string;
  report: ReportContext;
  techHref: (holderId: string | null) => string;
}) {
  const t = useTranslations("Admin");
  const { basePath, window, search, tech, board } = data;
  const totals = board.totals;
  const base = Math.max(0, totals.revenue - totals.warranty);

  return (
    <div className="space-y-4">
      <QueueToolbar
        locale={locale}
        basePath={basePath}
        window={window}
        search={search}
        params={params}
        selects={[termsSelect, { name: "tech", label: t("deskTechnician"), value: tech ?? "", options: techOptions }]}
        labels={toolbarLabels}
      />

      <Figures
        totals={totals}
        finance={board.available.finance}
        warranty={board.available.warranty}
        closeLabel={t("close")}
        period={period}
        labels={{
          tickets: t("deskTickets"),
          ticketsSub: t("deskTicketsSub", { open: totals.open, completed: totals.completed }),
          open: t("deskOpen"),
          revenue: t("financePriceTotal"),
          cost: t("financeCostTotal"),
          profit: t("financeProfitTotal"),
          profitSub:
            totals.missingCost > 0
              ? t("deskMissingCost", { count: totals.missingCost })
              : t("deskProfitSub", { count: totals.settled }),
          collectedCash: t("financeCollectedCash"),
          collectedDeferred: t("financeCollectedDeferred"),
          partialHeld: t("deskPartialHeld", { amount: money(totals.partialHeld) }),
          till: t("financeTill"),
          tillSub: totals.tillWarranty > 0 ? t("financeTillSub", { amount: money(totals.tillWarranty) }) : money(totals.till),
          outstanding: t("financeOutstanding"),
          deferred: t("deskDeferred", { count: totals.deferred }),
          warranty: t("warrantyTitle"),
          warrantySub: t("warrantyOfTotal", { total: money(totals.revenue) }),
          scope: scopeLabel,
        }}
        warrantyDetail={{
          title: t("warrantyDetailTitle"),
          body: t("warrantyDetailBody"),
          rows: [
            { label: t("warrantyDetailTotal"), value: money(totals.revenue), tone: "brand" },
            { label: t("warrantyDetailBase"), value: money(base) },
            { label: t("warrantyDetailWarranty"), value: money(totals.warranty), tone: "info" },
            { label: t("warrantyDetailTickets"), value: formatPrice(totals.warrantyTickets), tone: "muted" },
          ],
        }}
        tillDetail={{
          title: t("financeTill"),
          body: t("financeTillBody"),
          rows: [
            { label: t("financeCollectedCash"), value: money(totals.collectedCash), tone: "success" },
            { label: t("financeCollectedDeferred"), value: money(totals.collectedDeferred), tone: "info" },
            { label: t("financeTillWarranty"), value: money(totals.tillWarranty), tone: "muted" },
            { label: t("financeTill"), value: money(totals.till), tone: "brand" },
          ],
        }}
        money={money}
      />

      {/* جرد الأرباح — the rows the filters above came to, in print, on A4 or
          as a PDF to keep; and which printer is which on this machine. */}
      <section className="flex flex-wrap items-center gap-2.5 rounded-panel border border-line bg-surface px-3.5 py-3 shadow-card">
        <div className="flex min-w-0 items-center gap-2">
          <ClipboardList className="size-5 shrink-0 text-brand" aria-hidden />
          <div className="min-w-0">
          <h2 className="text-[0.88rem] font-black text-ink">{t("deskReportTitle")}</h2>
          <p className="text-[0.74rem] font-bold text-muted">{t("deskListCount", { count: board.rows.length })}</p>
          </div>
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <ProfitReportActions rows={board.rows} context={report} bare />
          <PrinterSetupButton />
        </div>
      </section>

      {board.byTech.length > 0 && (
        <TechTable
          rows={board.byTech.map((row) => ({
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
};

function Figures({
  totals,
  finance,
  warranty,
  closeLabel,
  period,
  labels,
  warrantyDetail,
  tillDetail,
  money,
}: {
  totals: DeskTotals;
  finance: boolean;
  warranty: boolean;
  closeLabel: string;
  period: string;
  labels: Record<
    | "tickets"
    | "ticketsSub"
    | "open"
    | "revenue"
    | "cost"
    | "profit"
    | "profitSub"
    | "collectedCash"
    | "collectedDeferred"
    | "partialHeld"
    | "till"
    | "tillSub"
    | "outstanding"
    | "deferred"
    | "warranty"
    | "warrantySub"
    | "scope",
    string
  >;
  warrantyDetail: StatDetail;
  tillDetail: StatDetail;
  money: (n: number) => string;
}) {
  const tiles: Tile[] = [
    { Icon: Wrench, label: labels.tickets, value: formatPrice(totals.tickets), sub: labels.ticketsSub, tone: "info" },
    { Icon: CircleDollarSign, label: labels.revenue, value: statMoney(totals.revenue), sub: money(totals.revenue), tone: "brand" },
  ];

  if (warranty) {
    tiles.push({
      Icon: ShieldCheck,
      label: labels.warranty,
      value: statMoney(totals.warranty),
      sub: labels.warrantySub,
      tone: "info",
      detail: warrantyDetail,
    });
  }
  if (finance) {
    tiles.push(
      { Icon: Receipt, label: labels.cost, value: statMoney(totals.cost), sub: money(totals.cost), tone: "muted" },
      // Two cards, because they are two kinds of money: one is finished the
      // moment it is paid, the other may still have more to come.
      { Icon: Banknote, label: labels.collectedCash, value: statMoney(totals.collectedCash), sub: money(totals.collectedCash), tone: "success" },
      {
        Icon: CalendarClock,
        label: labels.collectedDeferred,
        value: statMoney(totals.collectedDeferred),
        sub: totals.partialHeld > 0 ? labels.partialHeld : money(totals.collectedDeferred),
        tone: "info",
      },
      // «واصل بالخزنة» — what is actually in the drawer: the two above, each
      // dinar once, the warranty inside it (see `DeskTotals.till`).
      {
        Icon: Wallet,
        label: labels.till,
        value: statMoney(totals.till),
        sub: labels.tillSub,
        tone: "success",
        detail: tillDetail,
      },
      {
        Icon: HandCoins,
        label: labels.outstanding,
        value: statMoney(totals.outstanding),
        sub: labels.deferred,
        tone: totals.outstanding > 0 ? "warning" : "success",
      },
      {
        Icon: TrendingUp,
        label: labels.profit,
        value: statMoney(totals.profit),
        sub: labels.profitSub,
        tone: totals.profit < 0 ? "brand" : "success",
      },
    );
  } else {
    tiles.push({ Icon: Hourglass, label: labels.open, value: formatPrice(totals.open), tone: "warning" });
  }

  return (
    <section aria-label={labels.scope} className="space-y-2">
      <p className="flex flex-wrap items-center gap-x-2 text-[0.74rem] font-extrabold text-muted">
        <span>{labels.scope}</span>
        <span className="rounded-chip bg-subtle px-2 py-0.5 text-ink">{period}</span>
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
              {tile.sub && <span className="text-[0.68rem] font-medium text-muted">{tile.sub}</span>}
            </StatPress>
          </li>
        ))}
      </ul>
    </section>
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
                <td className="px-3 py-2 text-end font-bold" data-numeric>{money(row.revenue)}</td>
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

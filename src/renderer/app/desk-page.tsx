import { useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
  CircleCheckBig,
  CircleDollarSign,
  CloudOff,
  HandCoins,
  Hourglass,
  Receipt,
  ShieldCheck,
  TrendingUp,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { FilterChips } from "@/components/admin/filter-chips";
import { QueueToolbar } from "@/components/admin/queue-toolbar";
import { RepairsBoard, type DeskHolder } from "@/components/admin/repairs-board";
import { DeskTicketButton } from "@/components/admin/desk-ticket";
import { PrinterSetupButton } from "@/components/admin/printer-setup";
import { StatPress, type StatDetail } from "@/components/admin/stat-detail";
import { formatDayNumeric } from "@/lib/data/datetime";
import { worksTheBench, type DeskTotals } from "@/lib/data/repair-desk";
import { formatPrice } from "@/lib/format";
import { statMoney } from "@/lib/data/stat-money";
import { cn } from "@/lib/utils";
import type { DeskPageData } from "../../shared/desk-types";
import { alignBasePath, useRoute } from "../lib/router";
import { requestPage, useDeskData } from "../lib/desk-data";
import { useSettings } from "../lib/settings";
import { useSync } from "../lib/sync";
import { FirstRun } from "./first-run";
import { openSyncPanel } from "./sync-panel";

/**
 * The bench — the dashboard's `components/admin/repair-desk-page.tsx`, drawn
 * from this computer's copy of it.
 *
 * ---------------------------------------------------------------------------
 * What is the site's, and what is the app's
 * ---------------------------------------------------------------------------
 * Everything that is drawn is the site's: the header, the tabs, the figures,
 * the toolbar, the per-person table, the status chips and the board are the
 * same components with the same props, and this file is a line-by-line port of
 * the site's page body with `getTranslations` swapped for `useTranslations`.
 * Every figure the site's page *computed* — the window, the holders, the
 * period line, the scope label — is computed the same way here, from what the
 * main process answers (`src/main/desk/board.ts`), which itself runs the site's
 * own rules over the local database.
 *
 * Three things are the app's own, and each is a strip above the board rather
 * than a change inside it:
 *
 * - **the first run**, while this computer has never held the bench;
 * - **work still waiting to reach the server**, with a way into the sync panel —
 *   a change saved offline is real and on screen, and the reader should know
 *   it has not yet reached the dashboard;
 * - **work the server refused**, which falls back to what the server holds.
 *
 * ⚠️ Two things of the site's page are deliberately not here. `LiveData` — the
 * site's realtime and refocus refresh — is replaced by the sync engine, which
 * redraws this page from `onChanged`. And the technician's goal bar: the desk
 * signs in as the shop's maintenance account, which manages the bench rather
 * than working a quota on it.
 */
export function DeskPage() {
  const route = useRoute();
  const { locale } = useSettings();
  const params = useMemo(() => ({ ...route.query, locale }), [route.query, locale]);

  useEffect(() => {
    requestPage(params, true);
  }, [params, route.revision]);

  const { data, error } = useDeskData();

  // The bench is a setting, and the address follows it — see `alignBasePath`.
  useEffect(() => {
    if (data?.ready) alignBasePath(data.basePath);
  }, [data]);

  if (!data) return error ? <FirstRun reason="error" detail={error} /> : <FirstRun reason="loading" />;
  if (!data.ready) return <FirstRun reason={data.reason} />;
  return <Desk data={data} openId={route.query.open ?? null} />;
}

function Desk({ data, openId }: { data: Extract<DeskPageData, { ready: true }>; openId: string | null }) {
  const t = useTranslations("Admin");
  const tStatus = useTranslations("Track");
  const tDesk = useTranslations("Desk");
  const { locale } = useSettings();
  const sync = useSync();

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

  // Every filter now in the address, so each control can carry the others.
  const params: Record<string, string> = {
    ...window.query,
    ...(view !== defaultView ? { view } : {}),
    ...(status ? { status } : {}),
    ...(search ? { q: search } : {}),
    ...(terms ? { terms } : {}),
    ...(tech ? { tech } : {}),
  };
  const without = (key: string) => Object.fromEntries(Object.entries(params).filter(([k]) => k !== key));

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
        : tech
          ? t("deskScopeTech", { name: tech === "none" ? t("unassigned") : (nameOf(tech) ?? "") })
          : t("deskScopeAll");

  const base = Math.max(0, board.totals.revenue - board.totals.warranty);

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
        {authority.manages && (
          <div className="flex flex-wrap items-center gap-2">
            <PrinterSetupButton />
            <DeskTicketButton
              service={service}
              branches={data.branches}
              brands={data.brands}
              models={data.models}
              issues={data.issues}
              holders={holders}
              viewerId={viewer.id}
              today={today}
              financeAvailable={board.available.finance}
              warrantyAvailable={board.available.warranty}
              customFaultsAvailable={board.available.customFaults}
            />
          </div>
        )}
      </header>

      {(sync.pending > 0 || sync.failed > 0) && (
        <button
          type="button"
          onClick={openSyncPanel}
          className={cn(
            "flex w-full flex-wrap items-center gap-2 rounded-card border px-4 py-2.5 text-start text-[0.8rem] font-bold text-ink transition-colors",
            sync.failed > 0
              ? "border-brand/45 bg-brand/6 hover:border-brand"
              : "border-info/40 bg-info/6 hover:border-info",
          )}
        >
          {sync.failed > 0 ? (
            <AlertTriangle className="size-4 shrink-0 text-brand" aria-hidden />
          ) : (
            <CloudOff className="size-4 shrink-0 text-info" aria-hidden />
          )}
          <span>
            {sync.failed > 0
              ? tDesk("stripFailed", { count: sync.failed })
              : tDesk(sync.online ? "stripPending" : "stripPendingOffline", { count: sync.pending })}
          </span>
          <span className="ms-auto font-extrabold text-brand">{tDesk("stripReview")}</span>
        </button>
      )}

      {service === "software" && !board.available.service && (
        <p className="rounded-card border border-dashed border-warning/50 bg-warning/6 px-4 py-3 text-[0.8rem] font-bold text-warning">
          {t("deskUnavailable")}
        </p>
      )}

      <FilterChips
        basePath={basePath}
        param="view"
        active={view === defaultView ? null : view}
        keep={search ? { q: search } : {}}
        options={
          isTech
            ? [
                { value: null, label: t("deskTabMine"), count: counts.mine },
                { value: "all", label: t("deskTabAll") },
              ]
            : [
                { value: null, label: t("deskTabAll") },
                { value: "mine", label: t("deskTabMine"), count: counts.mine },
                { value: "pending", label: t("deskTabPending"), count: counts.pending },
              ]
        }
      />

      {authority.manages && view === "all" && counts.olderOpen > 0 && window.when !== "open" && window.when !== "all" && (
        <Link
          href={`${basePath}?when=open`}
          className="flex flex-wrap items-center gap-2 rounded-card border border-warning/45 bg-warning/8 px-4 py-2.5 text-[0.8rem] font-bold text-ink transition-colors hover:border-warning"
        >
          <AlertTriangle className="size-4 shrink-0 text-warning" aria-hidden />
          {t("deskOlderOpen", { count: counts.olderOpen })}
          <span className="ms-auto font-extrabold text-brand">{t("deskOlderOpenShow")}</span>
        </Link>
      )}

      <Figures
        totals={board.totals}
        seesMoney={authority.seesMoney}
        finance={board.available.finance}
        warranty={board.available.warranty}
        closeLabel={t("close")}
        period={period}
        labels={{
          tickets: t("deskTickets"),
          ticketsSub: t("deskTicketsSub", { open: board.totals.open, completed: board.totals.completed }),
          open: t("deskOpen"),
          completed: t("deskCompleted"),
          revenue: t("financePriceTotal"),
          cost: t("financeCostTotal"),
          profit: t("financeProfitTotal"),
          profitSub:
            board.totals.missingCost > 0
              ? t("deskMissingCost", { count: board.totals.missingCost })
              : t("deskProfitSub", { count: board.totals.settled }),
          collectedCash: t("financeCollectedCash"),
          collectedDeferred: t("financeCollectedDeferred"),
          partialHeld: t("deskPartialHeld", { amount: money(board.totals.partialHeld) }),
          outstanding: t("financeOutstanding"),
          deferred: t("deskDeferred", { count: board.totals.deferred }),
          warranty: t("warrantyTitle"),
          warrantySub: t("warrantyOfTotal", { total: money(board.totals.revenue) }),
          scope: scopeLabel,
        }}
        warrantyDetail={{
          title: t("warrantyDetailTitle"),
          body: t("warrantyDetailBody"),
          rows: [
            { label: t("warrantyDetailTotal"), value: money(board.totals.revenue), tone: "brand" },
            { label: t("warrantyDetailBase"), value: money(base) },
            { label: t("warrantyDetailWarranty"), value: money(board.totals.warranty), tone: "info" },
            { label: t("warrantyDetailTickets"), value: formatPrice(board.totals.warrantyTickets), tone: "muted" },
          ],
        }}
        money={money}
      />

      <QueueToolbar
        locale={locale}
        basePath={basePath}
        window={window}
        search={search}
        params={params}
        selects={[
          ...(authority.seesMoney
            ? [
                {
                  name: "terms",
                  label: t("financeTerms"),
                  value: terms ?? "",
                  options: [
                    { value: "", label: t("all") },
                    { value: "cash", label: t("termsCash") },
                    { value: "deferred", label: t("termsDeferred") },
                  ],
                },
              ]
            : []),
          ...(view === "mine"
            ? []
            : [
                {
                  name: "tech",
                  label: t("deskTechnician"),
                  value: tech ?? "",
                  options: [
                    { value: "", label: t("deskAllTechs") },
                    // `visible`, not `people`: an owner's name is not offered to
                    // anybody below them. `worksTheBench`, because the control
                    // says "technician" — see the site's page for both.
                    ...people
                      .filter((person) => authority.visible.includes(person.userId) && worksTheBench(person))
                      .map((person) => ({ value: person.userId, label: person.name })),
                    { value: "none", label: t("unassigned") },
                  ],
                },
              ]),
        ]}
        labels={{
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
        }}
      />

      {authority.seesMoney && view === "all" && board.byTech.length > 0 && (
        <TechTable
          rows={board.byTech.map((row) => ({
            ...row,
            name: row.holderId ? row.name || t("workColleague") : t("unassigned"),
            href: `/${locale}${basePath}?${new URLSearchParams({ ...without("tech"), tech: row.holderId ?? "none" }).toString()}`,
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
            profit: t("financeProfitTotal"),
            outstanding: t("financeOutstanding"),
          }}
        />
      )}

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

      {board.truncated && <p className="text-[0.75rem] font-bold text-warning">{t("deskTruncated")}</p>}

      <RepairsBoard
        // ⚠️ `open` is in the key, and on the site it is not. The site's board
        // reads `initialOpenId` once, on mount, and the site only ever arrives
        // at `?open=` by a fresh navigation. Here a press on a Windows
        // notification or the bell lands on `?open=` with the board already
        // mounted, and without a new key it would never open.
        key={`${JSON.stringify(params)}|${openId ?? ""}`}
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
      />
    </div>
  );
}

/* ── The figures ──────────────────────────────────────────────────────────── */

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
  seesMoney,
  finance,
  warranty,
  closeLabel,
  period,
  labels,
  warrantyDetail,
  money,
}: {
  totals: DeskTotals;
  seesMoney: boolean;
  finance: boolean;
  warranty: boolean;
  closeLabel: string;
  period: string;
  labels: Record<
    | "tickets"
    | "ticketsSub"
    | "open"
    | "completed"
    | "revenue"
    | "cost"
    | "profit"
    | "profitSub"
    | "collectedCash"
    | "collectedDeferred"
    | "partialHeld"
    | "outstanding"
    | "deferred"
    | "warranty"
    | "warrantySub"
    | "scope",
    string
  >;
  warrantyDetail: StatDetail;
  money: (n: number) => string;
}) {
  // A technician's page counts the work. The money is the managers'.
  const tiles: Tile[] = !seesMoney
    ? [
        { Icon: Wrench, label: labels.tickets, value: formatPrice(totals.tickets), tone: "info" },
        { Icon: Hourglass, label: labels.open, value: formatPrice(totals.open), tone: "warning" },
        { Icon: CircleCheckBig, label: labels.completed, value: formatPrice(totals.completed), tone: "success" },
      ]
    : [
        { Icon: Wrench, label: labels.tickets, value: formatPrice(totals.tickets), sub: labels.ticketsSub, tone: "info" },
        { Icon: CircleDollarSign, label: labels.revenue, value: statMoney(totals.revenue), sub: money(totals.revenue), tone: "brand" },
      ];

  if (seesMoney && warranty) {
    tiles.push({
      Icon: ShieldCheck,
      label: labels.warranty,
      value: statMoney(totals.warranty),
      sub: labels.warrantySub,
      tone: "info",
      detail: warrantyDetail,
    });
  }
  if (seesMoney && finance) {
    tiles.push(
      { Icon: Receipt, label: labels.cost, value: statMoney(totals.cost), sub: money(totals.cost), tone: "muted" },
      { Icon: Banknote, label: labels.collectedCash, value: statMoney(totals.collectedCash), sub: money(totals.collectedCash), tone: "success" },
      {
        Icon: CalendarClock,
        label: labels.collectedDeferred,
        value: statMoney(totals.collectedDeferred),
        sub: totals.partialHeld > 0 ? labels.partialHeld : money(totals.collectedDeferred),
        tone: "info",
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
  } else if (seesMoney) {
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
          "grid gap-2.5",
          seesMoney ? "grid-cols-2 max-sm:[&>*:last-child:nth-child(odd)]:col-span-2 lg:grid-cols-4" : "grid-cols-3",
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
  labels: Record<"title" | "name" | "tickets" | "completed" | "revenue" | "warranty" | "profit" | "outstanding", string>;
}) {
  return (
    <section className="rounded-panel border border-line bg-surface shadow-card">
      <h2 className="border-b border-line px-4 py-2.5 text-[0.85rem] font-black text-ink">{labels.title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[38rem] text-[0.78rem]">
          <thead>
            <tr className="text-start text-[0.68rem] font-bold text-muted">
              <th className="px-4 py-2 text-start">{labels.name}</th>
              <th className="px-3 py-2 text-end">{labels.tickets}</th>
              <th className="px-3 py-2 text-end">{labels.completed}</th>
              <th className="px-3 py-2 text-end">{labels.revenue}</th>
              {warranty && <th className="px-3 py-2 text-end">{labels.warranty}</th>}
              {finance && <th className="px-3 py-2 text-end">{labels.profit}</th>}
              {finance && <th className="px-3 py-2 text-end">{labels.outstanding}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.holderId ?? "none"} className={cn("border-t border-line/70", row.active && "bg-brand/6")}>
                <td className="px-4 py-2">
                  <a href={row.href} className="font-extrabold text-ink hover:text-brand">
                    {row.name}
                  </a>
                </td>
                <td className="px-3 py-2 text-end font-bold" data-numeric>{formatPrice(row.tickets)}</td>
                <td className="px-3 py-2 text-end font-bold" data-numeric>{formatPrice(row.completed)}</td>
                <td className="px-3 py-2 text-end font-bold" data-numeric>{money(row.revenue)}</td>
                {warranty && <td className="px-3 py-2 text-end font-bold text-info" data-numeric>{money(row.warranty)}</td>}
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

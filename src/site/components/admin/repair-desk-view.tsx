"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ReportPrintDialog, useProfitReport, type ReportJob } from "@/components/admin/profit-report";
import { useNewTicketWindows } from "@/components/admin/desk-ticket";
import { LockedPanel, useGuardedAction } from "@/components/admin/desk-gate";
import { bookedFields, computeFigures } from "@/lib/data/desk-figures";
import { moneyMoves } from "@/lib/data/desk-board";
import { DeskHome } from "@/components/admin/maintenance/desk-home";
import { DeskTabBar, DESK_TABS, type DeskTab } from "@/components/admin/maintenance/tab-bar";
import { PeriodBar } from "@/components/admin/maintenance/period-bar";
import { TicketsTab, TICKET_LISTS, type TicketList } from "@/components/admin/maintenance/tickets-tab";
import { CashTab, cashMoveLines } from "@/components/admin/maintenance/cash-tab";
import { ProfitTab } from "@/components/admin/maintenance/profit-tab";
import { WorkshopTab } from "@/components/admin/maintenance/workshop-tab";
import { SettingsTab } from "@/components/admin/maintenance/settings-tab";
import {
  useDeskShared,
  type DeskGoal,
  type RepairDeskViewData,
} from "@/components/admin/maintenance/desk-shared";

export type { DeskGoal, RepairDeskViewData } from "@/components/admin/maintenance/desk-shared";
export type { DeskTab } from "@/components/admin/maintenance/tab-bar";
export type { TicketList } from "@/components/admin/maintenance/tickets-tab";

/**
 * One bench's maintenance section, drawn — the repair desk and the
 * programming desk on the dashboard (`repair-desk-page.tsx` reads the data on
 * the server) and in the desktop app (`desk-page.tsx`, from its own database).
 * One body, so the two cannot drift.
 *
 * ---------------------------------------------------------------------------
 * A home screen and six tabs (the shop, 2026-11-24)
 * ---------------------------------------------------------------------------
 * The section opens on the company's mark alone, with six tabs above it, each
 * one job:
 *
 * - **إضافة تذكرة** — the new-ticket window (several at once); after saving,
 *   its print buttons and «عرض كل التذاكر».
 * - **كشف التذاكر** — the period's tickets, cut into مكتمل · غير مكتمل · ملغي ·
 *   مرتجع · طلبات الموقع, with the filters and the search.
 * - **تقارير الخزينة** — the safe: what came in and what each dinar was.
 * - **تقارير الأرباح** — what the period booked, per person, and جرد الأرباح.
 * - **إدارة الورشة** — the bench person by person.
 * - **الإعدادات** — who a new ticket goes to, the faults, the printers; in the
 *   desktop app its own settings too (`appSettings`).
 *
 * ⚠️ **Only the period asks the server.** Everything a tab shows is worked out
 * in the browser from one read of the period (`lib/data/desk-board.ts`,
 * `computeFigures`), so a tab, a list or a filter is a press. `?tab=` and
 * `?list=` are written with `history.replaceState`, so a reload lands on the
 * same tab; the period bar carries them along when it navigates.
 *
 * A technician has one tab, his own tickets, and no money. In the desktop app
 * the two report tabs and the settings ask for the desk's password each time
 * they are opened (`desk-gate.tsx`), and Ctrl+P opens the open report's print
 * chooser behind it.
 */
export function RepairDeskView({
  data,
  locale,
  tab: askedTab,
  list: askedList = null,
  openId,
  goal = null,
  notices,
  appSettings,
}: {
  data: RepairDeskViewData;
  locale: string;
  /** `?tab=` — null is the home screen. */
  tab: DeskTab | null;
  /** `?list=` — which of كشف التذاكر's lists. */
  list?: TicketList | null;
  openId: string | null;
  goal?: DeskGoal | null;
  /** What the app draws under the tabs — work waiting to reach the server. */
  notices?: ReactNode;
  /** The desktop app's own settings, drawn inside الإعدادات. */
  appSettings?: ReactNode;
}) {
  const t = useTranslations("Admin");
  const shared = useDeskShared(data, locale);
  const { isTech, authority, desk, viewer } = data;
  const { seesMoney, bounds } = shared;

  /** The tabs this reader has. A technician has his tickets and nothing else. */
  const tabs = useMemo<DeskTab[]>(
    () => (isTech ? ["tickets"] : DESK_TABS.filter((key) => (key === "cash" || key === "profit" ? seesMoney : true))),
    [isTech, seesMoney],
  );
  const lists = useMemo<TicketList[]>(
    () =>
      TICKET_LISTS.filter((key) =>
        key === "returned" || key === "owing" ? seesMoney : key === "requests" ? !isTech : true,
      ),
    [seesMoney, isTech],
  );

  /*
   * Which tab and which list — the address's answer, then the reader's
   * presses. Adjusted during render when a navigation lands (a period, an
   * alert's `?open=`), never in an effect copying a prop into state. A refresh
   * — a save, a sync pass — keeps the reader where they are.
   */
  const landingTab = (): DeskTab | null => {
    const wanted = askedTab ?? (openId || isTech ? "tickets" : null);
    return wanted && tabs.includes(wanted) ? wanted : wanted ? "tickets" : null;
  };
  const landingList = (): TicketList => (askedList && lists.includes(askedList) ? askedList : "all");
  const landing = JSON.stringify([askedTab, askedList, openId, desk.window.query]);
  const [tab, setTab] = useState<DeskTab | null>(landingTab);
  const [list, setList] = useState<TicketList>(landingList);
  /** Each visit to a tab behind the desk's password asks again. */
  const [visit, setVisit] = useState(0);
  const [seenLanding, setSeenLanding] = useState(landing);
  if (landing !== seenLanding) {
    setSeenLanding(landing);
    setTab(landingTab());
    setList(landingList());
  }

  function writeAddress(nextTab: DeskTab | null, nextList: TicketList) {
    try {
      // `globalThis`, because `window` is not what it seems in every caller.
      const url = new URL(globalThis.location.href);
      if (nextTab) url.searchParams.set("tab", nextTab);
      else url.searchParams.delete("tab");
      if (nextTab === "tickets" && nextList !== "all") url.searchParams.set("list", nextList);
      else url.searchParams.delete("list");
      globalThis.history.replaceState(globalThis.history.state, "", url);
    } catch {
      /* The address is a convenience; the tab has already changed. */
    }
  }
  function showTab(next: DeskTab | null, nextList: TicketList = list) {
    setTab(next);
    setList(nextList);
    setVisit((n) => n + 1);
    writeAddress(next, nextList);
  }
  function showList(next: TicketList) {
    setList(next);
    writeAddress("tickets", next);
  }

  /* ── what the report tabs and Ctrl+P print ──────────────────────────── */

  const figures = useMemo(
    () =>
      seesMoney
        ? computeFigures({
            rows: desk.rows,
            book: desk.book,
            returns: desk.returns,
            bounds,
            filters: { status: "all", terms: null, holderId: null },
            complete: data.complete,
          })
        : null,
    [seesMoney, desk, bounds, data.complete],
  );
  const moves = useMemo(
    () => (seesMoney ? moneyMoves(desk.rows, { bounds, book: desk.book, returns: desk.returns }) : []),
    [seesMoney, desk, bounds],
  );
  const context = useMemo(() => ({ desk: shared.deskName, period: shared.period, filters: [] }), [shared.deskName, shared.period]);
  const profitJob = useMemo<ReportJob>(
    () => ({
      rows: (figures?.booked ?? []).map((row) => {
        const booked = bookedFields(row, desk.returns);
        return booked ? { ...row, booked } : row;
      }),
      returns: shared.lists.returned.flatMap((row) => (row.returned ? [{ ...row, returned: row.returned }] : [])),
      context,
      totals: figures?.totals,
      includeCancelled: false,
    }),
    [figures, desk.returns, shared.lists.returned, context],
  );
  const cashJob = useMemo<ReportJob>(
    () => ({ kind: "cash", rows: [], moves: cashMoveLines(moves, desk.rows), context, totals: figures?.totals }),
    [moves, desk.rows, context, figures],
  );

  const report = useProfitReport();
  const guard = useGuardedAction();
  const [chooser, setChooser] = useState(false);
  const chooserJob = tab === "cash" ? cashJob : profitJob;

  /*
   * Ctrl+P is the open report's (the shop, 2026-11-20): a chooser of A4, A5
   * or a PDF instead of the browser's dialog, which on the counter PC would
   * print this screen on the label printer. Behind the desk's password where
   * there is one. Read through a ref the effect keeps current, so the
   * listener is installed once.
   */
  const openChooser = useRef<() => void>(() => {});
  useEffect(() => {
    openChooser.current = () => guard.run("stats", () => setChooser(true));
  });
  useEffect(() => {
    if (!seesMoney) return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (event.code !== "KeyP" && event.key.toLowerCase() !== "p") return;
      event.preventDefault();
      event.stopPropagation();
      openChooser.current();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [seesMoney]);

  /* ── إضافة تذكرة ───────────────────────────────────────────────────── */

  const newTicket = useNewTicketWindows({
    service: data.service,
    branches: data.branches,
    brands: data.brands,
    models: data.models,
    recentDevices: data.recentDevices,
    recentFaults: data.recentFaults,
    issues: data.issues,
    holders: shared.holders,
    viewerId: viewer.id,
    defaultHolderId: data.defaultHolderId ?? null,
    today: data.today,
    financeAvailable: desk.available.finance,
    warrantyAvailable: desk.available.warranty,
    onShowTickets: () => showTab("tickets", "all"),
  });

  const keep: Record<string, string> = {
    ...(tab ? { tab } : {}),
    ...(tab === "tickets" && list !== "all" ? { list } : {}),
  };

  return (
    <div className="space-y-4">
      <DeskTabBar
        tab={tab}
        tabs={tabs}
        onTab={(next) => showTab(next)}
        onHome={() => showTab(null)}
        onAdd={authority.manages ? newTicket.open : undefined}
        addCount={newTicket.count}
        software={data.service === "software"}
      />

      {notices}
      {report.ui}

      {data.service === "software" && !desk.available.service && (
        <p className="rounded-card border border-dashed border-warning/50 bg-warning/6 px-4 py-3 text-[0.8rem] font-bold text-warning">
          {t("deskUnavailable")}
        </p>
      )}

      {tab && tab !== "settings" && (
        <PeriodBar
          basePath={data.basePath}
          window={desk.window}
          today={data.today}
          keep={keep}
          label={shared.period}
        />
      )}

      {tab === null && <DeskHome deskName={shared.deskName} />}

      {tab === "tickets" && (
        <TicketsTab shared={shared} totals={figures?.totals ?? null} list={list} onList={showList} openId={openId} goal={goal} />
      )}

      {tab === "cash" && figures && (
        <LockedPanel key={`cash-${visit}`} reason="stats" onCancel={() => showTab(null)}>
          <CashTab
            shared={shared}
            totals={figures.totals}
            moves={moves}
            report={report}
            job={cashJob}
            onDebts={() => showTab("tickets", "owing")}
            onReturns={() => showTab("tickets", "returned")}
          />
        </LockedPanel>
      )}

      {tab === "profit" && figures && (
        <LockedPanel key={`profit-${visit}`} reason="stats" onCancel={() => showTab(null)}>
          <ProfitTab
            shared={shared}
            totals={figures.totals}
            byTech={figures.byTech}
            report={report}
            job={profitJob}
            onCompleted={() => showTab("tickets", "completed")}
          />
        </LockedPanel>
      )}

      {tab === "workshop" && <WorkshopTab shared={shared} openId={openId} />}

      {tab === "settings" && (
        <LockedPanel key={`settings-${visit}`} reason="settings" onCancel={() => showTab(null)}>
          <SettingsTab shared={shared} appSettings={appSettings} />
        </LockedPanel>
      )}

      {newTicket.windows}
      {seesMoney && <ReportPrintDialog open={chooser} onClose={() => setChooser(false)} report={report} job={chooserJob} />}
      {guard.prompt}
    </div>
  );
}

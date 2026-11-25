import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, CloudOff } from "lucide-react";
import { RepairDeskView, type DeskTab, type RepairDeskViewData, type TicketList } from "@/components/admin/repair-desk-view";
import { DESK_TABS } from "@/components/admin/maintenance/tab-bar";
import { TICKET_LISTS } from "@/components/admin/maintenance/tickets-tab";
import { cn } from "@/lib/utils";
import type { DeskPageData } from "../../shared/desk-types";
import { alignBasePath, useRoute } from "../lib/router";
import { requestPage, useDeskData } from "../lib/desk-data";
import { useSettings } from "../lib/settings";
import { useSync } from "../lib/sync";
import { FirstRun } from "./first-run";
import { AppSettings } from "./settings-page";
import { openSyncPanel } from "./sync-panel";

/**
 * The bench — the site's own `components/admin/repair-desk-view.tsx`, drawn
 * from this computer's copy of it.
 *
 * ---------------------------------------------------------------------------
 * What is the site's, and what is the app's
 * ---------------------------------------------------------------------------
 * Everything that is drawn is the site's: the home screen and its six tabs
 * (2026-11-24), the ticket windows, the reports and the period bar are the
 * same view the dashboard renders, given the same data — the period's rows
 * and the two ledgers, which the main process reads out of the local database
 * (`src/main/desk/board.ts`). Every list and figure is worked out from them in
 * this window by the site's own rules, exactly as the dashboard works them out
 * in the browser. One view cannot drift from itself.
 *
 * Only the period asks the main process. The tab, the list and the ticket to
 * open are the address's, read here and handed to the view; changing them
 * reads nothing.
 *
 * Three things are the app's own:
 *
 * - **the first run**, while this computer has never held the bench;
 * - **work still waiting to reach the server**, a strip under the tabs with a
 *   way into the sync panel — a change saved offline is real and on screen,
 *   and the reader should know it has not yet reached the dashboard;
 * - **this computer's settings**, drawn inside a manager's الإعدادات tab under
 *   the bench's own (`AppSettings`). A technician has no such tab; his narrow
 *   settings stay on the app's own page.
 *
 * The desk's password — the editor, the reports and the settings ask for it
 * every time — is the site's `desk-gate.tsx`, switched on in `app.tsx`.
 *
 * ⚠️ `LiveData` — the site's realtime and refocus refresh — is not here: the
 * sync engine redraws this page from `onChanged`. Neither is a technician's
 * goal bar, which the dashboard reads from a table this app does not copy.
 */
export function DeskPage() {
  const route = useRoute();
  const { locale } = useSettings();
  const { when, from, to, days } = route.query;
  const params = useMemo(() => ({ locale, when, from, to, days }), [locale, when, from, to, days]);

  const asked = route.query.tab;
  const tab = (DESK_TABS as readonly string[]).includes(asked ?? "") ? (asked as DeskTab) : null;
  const askedList = route.query.list;
  const liveList = (TICKET_LISTS as readonly string[]).includes(askedList ?? "") ? (askedList as TicketList) : null;
  /*
   * ⚠️ The route follows the view's own `replaceState` (`startRouter`), and
   * the view writes `?list=` only while كشف التذاكر is open — so the list a
   * reader chose there would be forgotten the moment they looked at another
   * tab, where the site's view keeps it. It is remembered here, adjusted
   * during render rather than copied in an effect.
   */
  const [ticketsList, setTicketsList] = useState<TicketList | null>(liveList);
  if (tab === "tickets" && liveList !== ticketsList) setTicketsList(liveList);
  const list = tab === "tickets" ? liveList : ticketsList;

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
  return <Desk data={data} tab={tab} list={list} openId={route.query.open ?? null} />;
}

function Desk({
  data,
  tab,
  list,
  openId,
}: {
  data: Extract<DeskPageData, { ready: true }>;
  tab: DeskTab | null;
  list: TicketList | null;
  openId: string | null;
}) {
  const tDesk = useTranslations("Desk");
  const { locale } = useSettings();
  const sync = useSync();

  // One object per read, so the view works its lists out once per read
  // rather than on every redraw of this page (the sync pill redraws it).
  const view = useMemo<RepairDeskViewData>(
    () => ({
      service: data.service,
      basePath: data.basePath,
      viewer: { id: data.viewer.id, name: data.viewer.name },
      authority: data.authority,
      people: data.people,
      isTech: data.isTech,
      desk: data.desk,
      // This computer holds the whole of both ledgers, with what its waiting
      // changes will add — see `moneyAcross`.
      complete: true,
      flow: data.flow,
      branches: data.branches,
      brands: data.brands,
      models: data.models,
      recentDevices: data.recentDevices ?? [],
      recentFaults: data.recentFaults ?? [],
      issues: data.issues,
      today: data.today,
      canDelete: data.canDelete,
      faultsEditable: data.faultsEditable,
      defaultHolderId: data.defaultHolderId ?? null,
    }),
    [data],
  );

  const notices =
    sync.pending > 0 || sync.failed > 0 ? (
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
    ) : null;

  return (
    <RepairDeskView
      locale={locale}
      tab={tab}
      list={list}
      openId={openId}
      notices={notices}
      appSettings={data.isTech ? undefined : <AppSettings />}
      data={view}
    />
  );
}

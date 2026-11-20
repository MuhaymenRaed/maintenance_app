import { useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, CloudOff } from "lucide-react";
import { RepairDeskView } from "@/components/admin/repair-desk-view";
import { cn } from "@/lib/utils";
import type { DeskPageData } from "../../shared/desk-types";
import { alignBasePath, useRoute } from "../lib/router";
import { requestPage, useDeskData } from "../lib/desk-data";
import { useSettings } from "../lib/settings";
import { useSync } from "../lib/sync";
import { FirstRun } from "./first-run";
import { openSyncPanel } from "./sync-panel";

/**
 * The bench — the site's own `components/admin/repair-desk-view.tsx`, drawn
 * from this computer's copy of it.
 *
 * ---------------------------------------------------------------------------
 * What is the site's, and what is the app's
 * ---------------------------------------------------------------------------
 * Everything that is drawn is the site's: the two panels (the tickets, and the
 * figures with جرد الأرباح), the toolbar, the per-person table and the board
 * are the same view the dashboard renders, given the same data. Every figure
 * the site's page *computes* is computed the same way here, from what the main
 * process answers (`src/main/desk/board.ts`), which itself runs the site's own
 * rules over the local database. This file used to be a line-by-line port of
 * the site's page body; one view cannot drift from itself.
 *
 * Two things are the app's own:
 *
 * - **the first run**, while this computer has never held the bench;
 * - **work still waiting to reach the server**, a strip above the panels with
 *   a way into the sync panel — a change saved offline is real and on screen,
 *   and the reader should know it has not yet reached the dashboard.
 *
 * The desk's password — the editor, the figures and the settings ask for it
 * every time — is the site's `desk-gate.tsx`, switched on in `app.tsx`.
 *
 * ⚠️ `LiveData` — the site's realtime and refocus refresh — is not here: the
 * sync engine redraws this page from `onChanged`. Neither is a technician's
 * goal bar, which the dashboard reads from a table this app does not copy.
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
  return (
    <Desk
      data={data}
      openId={route.query.open ?? null}
      panel={route.query.panel === "stats" ? "stats" : "tickets"}
    />
  );
}

function Desk({
  data,
  openId,
  panel,
}: {
  data: Extract<DeskPageData, { ready: true }>;
  openId: string | null;
  panel: "tickets" | "stats";
}) {
  const tDesk = useTranslations("Desk");
  const { locale } = useSettings();
  const sync = useSync();

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
      panel={panel}
      openId={openId}
      notices={notices}
      data={{
        service: data.service,
        basePath: data.basePath,
        viewer: { id: data.viewer.id, name: data.viewer.name },
        authority: data.authority,
        people: data.people,
        isTech: data.isTech,
        defaultView: data.defaultView,
        view: data.view,
        window: data.window,
        search: data.search,
        status: data.status,
        statsStatus: data.statsStatus,
        moneyFilter: data.moneyFilter,
        statuses: data.statuses,
        flow: data.flow,
        terms: data.terms,
        tech: data.tech,
        board: data.board,
        counts: data.counts,
        branches: data.branches,
        brands: data.brands,
        models: data.models,
        recentDevices: data.recentDevices ?? [],
        recentFaults: data.recentFaults ?? [],
        issues: data.issues,
        today: data.today,
        canDelete: data.canDelete,
        faultsEditable: Boolean(data.board.available.faultsEdit),
        defaultHolderId: data.defaultHolderId ?? null,
      }}
    />
  );
}

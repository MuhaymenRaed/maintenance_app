import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { deskLists, rowMarks, type DeskList, type RowFacts } from "@/lib/data/desk-board";
import { worksTheBench, type DeskAuthority, type RepairService } from "@/lib/data/repair-desk";
import { formatDayNumeric } from "@/lib/data/datetime";
import { formatPrice } from "@/lib/format";
import type { Bounds } from "@/lib/data/desk-figures";
import type { DeskHolder } from "@/components/admin/repairs-board";
import type { RepairStatus } from "@/lib/data/orders";
import type { QueueWindow } from "@/lib/data/queue-window";
import type { RecentDevice } from "@/lib/data/recent-devices";
import type { RecentFault } from "@/lib/data/repair-faults";
import type { StockModel } from "@/lib/data/device-catalogue";
import type { DeskData, DeskPerson, DeskRow } from "@/lib/queries/repair-desk";

/**
 * What one bench's page is drawn from — the dashboard reads it on the server
 * (`repair-desk-page.tsx`), the desktop app from its own database
 * (`desk-page.tsx`). Everything a tab shows is worked out from it in the
 * browser, so switching a tab, a list or a filter is a press, never a request.
 */
export type RepairDeskViewData = {
  service: RepairService;
  basePath: string;
  viewer: { id: string; name: string };
  authority: DeskAuthority;
  people: DeskPerson[];
  isTech: boolean;
  /** The period's raw rows and the two ledgers. */
  desk: DeskData;
  /**
   * The ledger holds every entry, not only the period onwards — the desktop
   * app's own copy (see `moneyAcross`).
   */
  complete?: boolean;
  /** The technician's steps this deployment can store. */
  flow: readonly RepairStatus[];
  branches: { id: string; name: string }[];
  brands: { code: string; name: string }[];
  models: Record<string, StockModel[]>;
  recentDevices: RecentDevice[];
  recentFaults: RecentFault[];
  issues: { code: string; name: string }[];
  /** Today's Baghdad day, from the server. */
  today: string;
  canDelete: boolean;
  faultsEditable: boolean;
  /** The bench's default holder (`work_defaults`). */
  defaultHolderId?: string | null;
};

/** A technician's goal, as `getMyGoal` answers it. */
export type DeskGoal = {
  reward: string;
  value: number;
  target: number;
  progress: number;
  targetKind: "jobs" | "points";
  reached: boolean;
};

/** What every tab reads, worked out once per read. */
export type DeskShared = {
  data: RepairDeskViewData;
  locale: string;
  bounds: Bounds;
  lists: Record<DeskList, DeskRow[]>;
  facts: Map<string, RowFacts>;
  olderOpen: DeskRow[];
  /** Whom this reader may hand a ticket to, themselves first. */
  holders: DeskHolder[];
  /** The holder filter's options: everybody the reader may be shown, then nobody. */
  holderOptions: { value: string; label: string }[];
  /** A manager who reads the money. */
  seesMoney: boolean;
  money: (n: number) => string;
  /** The period, in words. */
  period: string;
  deskName: string;
};

const RANK_ORDER = { manager: 1, assistant: 2, technician: 3 } as const;

export function useDeskShared(data: RepairDeskViewData, locale: string): DeskShared {
  const t = useTranslations("Admin");
  const { desk, people, authority, viewer } = data;
  const cur = t("currency");
  const everyone = t("deskAllTechs");
  const nobody = t("unassigned");
  const whenAll = t("whenAll");
  const whenToday = t("dayToday");
  const deskName = data.service === "software" ? t("programmingDesk") : t("repairDesk");

  return useMemo(() => {
    const bounds: Bounds = { since: desk.window.since, until: desk.window.until };
    const { lists: raw, facts, olderOpen } = deskLists(desk.rows, {
      bounds,
      book: desk.book,
      returns: desk.returns,
      complete: data.complete,
    });
    // Each row carries what it says about the period — the money a ticket
    // from an earlier day took in it, and its «مرتجع».
    const marked = new Map<string, DeskRow>();
    const mark = (row: DeskRow) => {
      let out = marked.get(row.id);
      if (!out) {
        const fact = facts.get(row.id);
        out = fact ? { ...row, ...rowMarks(fact) } : row;
        marked.set(row.id, out);
      }
      return out;
    };
    const lists = Object.fromEntries(
      Object.entries(raw).map(([key, rows]) => [key, rows.map(mark)]),
    ) as Record<DeskList, DeskRow[]>;

    const holders: DeskHolder[] = authority.assignable
      .flatMap((id) => {
        const person = people.find((candidate) => candidate.userId === id);
        if (person) return [{ id, name: person.name, rank: person.rank }];
        return id === viewer.id ? [{ id, name: viewer.name, rank: "manager" as const }] : [];
      })
      .sort(
        (a, b) =>
          Number(b.id === viewer.id) - Number(a.id === viewer.id) ||
          RANK_ORDER[a.rank] - RANK_ORDER[b.rank] ||
          a.name.localeCompare(b.name),
      );

    const holderOptions = [
      { value: "", label: everyone },
      // `visible`, never `people`: an owner's name is offered to nobody below them.
      ...people
        .filter((person) => authority.visible.includes(person.userId))
        .sort((a, b) => Number(worksTheBench(b)) - Number(worksTheBench(a)) || a.name.localeCompare(b.name))
        .map((person) => ({ value: person.userId, label: person.name })),
      { value: "none", label: nobody },
    ];

    return {
      data,
      locale,
      bounds,
      lists,
      facts,
      olderOpen: olderOpen.map(mark),
      holders,
      holderOptions,
      seesMoney: authority.seesMoney && !data.isTech,
      money: (n: number) => `${formatPrice(Math.round(n))} ${cur}`,
      period: periodWords(desk.window, data.today, locale, { all: whenAll, today: whenToday }),
      deskName,
    };
  }, [data, locale, desk, people, authority, viewer, cur, everyone, nobody, whenAll, whenToday, deskName]);
}

/** Which days a list covers, in words, so a figure can be read on its own. */
export function periodWords(
  span: QueueWindow,
  today: string,
  locale: string,
  words: { all: string; today: string },
): string {
  const day = (value: string) => formatDayNumeric(locale, `${value}T09:00:00Z`);
  if (!span.from || !span.to) return words.all;
  if (span.from === span.to) return span.from === today ? `${words.today} · ${day(today)}` : day(span.from);
  return `${day(span.from)} — ${day(span.to)}`;
}

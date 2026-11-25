"use client";

import { useTranslations } from "next-intl";
import { ClipboardList, Cpu, FilePlus2, Settings2, TrendingUp, Users, Wallet, Wrench, type LucideIcon } from "lucide-react";
import { MARK_DOT, MARK_PATH, MARK_VIEWBOX } from "@/lib/brand/mark";
import { cn } from "@/lib/utils";

/**
 * The six tabs above the home screen (the shop's drawing, 2026-11-24), each
 * one job: add a ticket, the tickets, the safe, the profit, the workshop, the
 * settings. «إضافة تذكرة» is a press that opens the new-ticket window; the
 * other five replace the home screen beneath the bar. Pressing the tab that is
 * open, or the mark at the start of the bar, goes back to the home screen.
 */
export type DeskTab = "tickets" | "cash" | "profit" | "workshop" | "settings";

export const DESK_TABS: readonly DeskTab[] = ["tickets", "cash", "profit", "workshop", "settings"];

const ICONS: Record<DeskTab, LucideIcon> = {
  tickets: ClipboardList,
  cash: Wallet,
  profit: TrendingUp,
  workshop: Users,
  settings: Settings2,
};

export function DeskTabBar({
  tab,
  tabs,
  onTab,
  onHome,
  onAdd,
  addCount = 0,
  software = false,
}: {
  tab: DeskTab | null;
  /** The tabs this reader has — a technician has one. */
  tabs: readonly DeskTab[];
  onTab: (tab: DeskTab) => void;
  onHome: () => void;
  /** «إضافة تذكرة» — absent for a reader who cannot open a ticket. */
  onAdd?: () => void;
  /** Add-ticket windows open now. */
  addCount?: number;
  software?: boolean;
}) {
  const t = useTranslations("Admin");
  const AddIcon = software ? Cpu : Wrench;
  const count = tabs.length + (onAdd ? 1 : 0);
  return (
    <nav
      aria-label={t("deskTabsLabel")}
      className="flex items-stretch gap-2 rounded-panel border border-line bg-surface p-2 shadow-card"
    >
      <button
        type="button"
        onClick={onHome}
        aria-label={t("deskHome")}
        title={t("deskHome")}
        aria-pressed={tab === null}
        className={cn(
          "press group hidden w-14 shrink-0 items-center justify-center rounded-card border transition-colors sm:flex",
          tab === null ? "border-brand/40 bg-brand/8" : "border-transparent hover:border-line hover:bg-subtle",
        )}
      >
        <svg viewBox={MARK_VIEWBOX} className="size-8 transition-transform duration-300 group-hover:scale-110" aria-hidden>
          <path d={MARK_PATH} fillRule="evenodd" fill="var(--mark-ink)" />
          <circle cx={MARK_DOT.cx} cy={MARK_DOT.cy} r={MARK_DOT.r} fill="var(--mark-red)" />
        </svg>
      </button>

      <div
        className={cn(
          "grid min-w-0 flex-1 gap-2",
          count >= 6 ? "grid-cols-3 lg:grid-cols-6" : count === 1 ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-3",
        )}
      >
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="press group relative flex min-w-0 flex-col items-center justify-center gap-1.5 rounded-card bg-brand px-2 py-3 text-white shadow-sm transition-colors hover:bg-brand-hover"
          >
            <span className="flex size-9 items-center justify-center rounded-control bg-white/18 transition-transform group-hover:scale-110">
              <FilePlus2 className="size-5" aria-hidden />
            </span>
            <span className="text-center text-[0.8rem] font-black leading-tight">{t("deskTab_add")}</span>
            {addCount > 0 && (
              <span
                className="absolute end-1.5 top-1.5 flex min-w-5 items-center justify-center gap-0.5 rounded-full bg-white px-1.5 text-[0.66rem] font-black text-brand"
                data-numeric
              >
                <AddIcon className="size-3" aria-hidden />
                {addCount}
              </span>
            )}
          </button>
        )}
        {tabs.map((key) => {
          const Icon = ICONS[key];
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => (active ? onHome() : onTab(key))}
              aria-pressed={active}
              className={cn(
                "press group flex min-w-0 flex-col items-center justify-center gap-1.5 rounded-card border px-2 py-3 transition-colors",
                active
                  ? "border-brand bg-brand/8 text-brand shadow-sm"
                  : "border-line bg-canvas text-ink hover:border-brand/45 hover:text-brand",
              )}
            >
              <span
                className={cn(
                  "flex size-9 items-center justify-center rounded-control transition-transform group-hover:scale-110",
                  active ? "bg-brand text-white" : "bg-subtle",
                )}
              >
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="text-center text-[0.8rem] font-black leading-tight">{t(`deskTab_${key}`)}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

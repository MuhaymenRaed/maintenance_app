"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { CircleCheckBig, Hand, Hourglass, PackageCheck, UserRound, UserX, Users, Wrench, type LucideIcon } from "lucide-react";
import { RepairsBoard } from "@/components/admin/repairs-board";
import { workshopPeople, type WorkshopPerson } from "@/lib/data/desk-board";
import { withinBounds } from "@/lib/data/desk-figures";
import { stageOf } from "@/lib/data/repair-stage";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DeskRow } from "@/lib/queries/repair-desk";
import { TabHeading } from "@/components/admin/maintenance/figure-cards";
import type { DeskShared } from "@/components/admin/maintenance/desk-shared";

/**
 * إدارة الورشة — the bench, person by person (the shop, 2026-11-24): a card
 * for everybody who works it, and «غير مسند» for the tickets nobody holds.
 * Each card counts what is on that person's bench now and what they finished
 * and handed back in the period. Pick one to list their tickets, under the
 * same period, and hand a ticket on, set its step or mark it handed to the
 * customer from its row.
 *
 * The cards count work only — no money: they are about who is doing what. A
 * ticket opened from the list is the same window as anywhere else.
 */
type Show = "all" | "open" | "completed" | "handed";

export function WorkshopTab({ shared, openId }: { shared: DeskShared; openId: string | null }) {
  const t = useTranslations("Admin");
  const { data, bounds, period } = shared;
  const { desk, people, viewer, authority } = data;

  const cards = useMemo(
    () =>
      workshopPeople(
        desk.rows,
        people.filter((person) => authority.visible.includes(person.userId)),
        bounds,
      ),
    [desk.rows, people, authority.visible, bounds],
  );
  const firstBusy = cards.find((card) => card.open > 0) ?? cards[0] ?? null;
  const [chosen, setChosen] = useState<string | null | undefined>(undefined);
  const selectedKey = chosen === undefined ? (firstBusy ? (firstBusy.holderId ?? "") : null) : chosen;
  const selected = cards.find((card) => (card.holderId ?? "") === selectedKey) ?? null;
  const [show, setShow] = useState<Show>("all");

  const rows = useMemo(() => {
    if (!selected) return [];
    return desk.rows
      .filter((row) => {
        if (stageOf(row.status) === "request") return false;
        if ((row.holderId ?? null) !== selected.holderId) return false;
        const stage = stageOf(row.status);
        const open = stage === "accepted" || stage === "waiting";
        const completed = stage === "completed" && row.completedAt != null && withinBounds(row.completedAt, bounds);
        const handed = row.handedOverAt != null && withinBounds(row.handedOverAt, bounds);
        if (show === "open") return open;
        if (show === "completed") return completed;
        if (show === "handed") return handed;
        return open || completed || handed || withinBounds(row.createdAt, bounds);
      })
      .sort((a: DeskRow, b: DeskRow) => b.createdAt.localeCompare(a.createdAt));
  }, [desk.rows, selected, show, bounds]);

  return (
    <div className="space-y-3.5">
      <TabHeading Icon={Users} title={t("deskTab_workshop")} hint={t("workshopHint", { period })} />

      {cards.length === 0 ? (
        <p className="rounded-panel border border-dashed border-line px-6 py-16 text-center text-[0.9rem] font-bold text-muted">
          {t("workshopEmpty")}
        </p>
      ) : (
        <ul className={cn("grid grid-cols-1 gap-2.5 sm:grid-cols-2", cards.length === 4 ? "lg:grid-cols-4" : cards.length === 2 ? "lg:grid-cols-2" : "lg:grid-cols-3")}>
          {cards.map((card) => (
            <li key={card.holderId ?? "none"}>
              <PersonCard
                card={card}
                me={card.holderId === viewer.id}
                selected={(card.holderId ?? "") === selectedKey}
                onPress={() => {
                  setChosen(card.holderId ?? "");
                  setShow("all");
                }}
              />
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="flex items-center gap-2 text-[0.95rem] font-black text-ink">
              {selected.holderId ? <UserRound className="size-4 text-brand" aria-hidden /> : <UserX className="size-4 text-warning" aria-hidden />}
              {t("workshopTicketsOf", { name: selected.holderId ? selected.name || t("workColleague") : t("unassigned") })}
            </h3>
            <div role="group" aria-label={t("workshopShow")} className="ms-auto flex flex-wrap gap-1.5">
              {(
                [
                  ["all", t("all"), null],
                  ["open", t("workshopOpenNow"), selected.open],
                  ["completed", t("ticketsListCompleted"), selected.completed],
                  ["handed", t("handedOver"), selected.handed],
                ] as [Show, string, number | null][]
              ).map(([key, label, n]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={show === key}
                  onClick={() => setShow(key)}
                  className={cn(
                    "press inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[0.76rem] font-extrabold transition-colors",
                    show === key ? "border-brand bg-brand text-white" : "border-line bg-canvas text-ink hover:border-brand/45",
                  )}
                >
                  {label}
                  {n !== null && (
                    <span data-numeric className={cn("font-black", show === key ? "text-white" : "text-muted")}>
                      {formatPrice(n)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
          <RepairsBoard
            workshop
            flow={data.flow}
            rows={rows}
            initialOpenId={openId}
            holders={shared.holders}
            viewerId={viewer.id}
            manages={authority.manages}
            seesMoney={shared.seesMoney}
            isTechnician={data.isTech}
            financeAvailable={desk.available.finance}
            warrantyAvailable={desk.available.warranty}
            canDelete={data.canDelete}
            showDays={desk.window.from !== desk.window.to}
            todayDay={data.today}
            issues={data.issues}
            recentFaults={data.recentFaults}
            faultsEditable={data.faultsEditable}
            brands={data.brands}
            stock={data.models}
            recentDevices={data.recentDevices}
          />
        </section>
      )}
    </div>
  );
}

function PersonCard({
  card,
  me,
  selected,
  onPress,
}: {
  card: WorkshopPerson;
  me: boolean;
  selected: boolean;
  onPress: () => void;
}) {
  const t = useTranslations("Admin");
  const nobody = card.holderId === null;
  const figures: { key: string; Icon: LucideIcon; label: string; value: number; tone: string }[] = [
    { key: "open", Icon: Wrench, label: t("workshopOpenNow"), value: card.open, tone: "text-warning" },
    { key: "completed", Icon: CircleCheckBig, label: t("workshopCompleted"), value: card.completed, tone: "text-success" },
    { key: "handed", Icon: PackageCheck, label: t("workshopHanded"), value: card.handed, tone: "text-info" },
  ];
  return (
    <button
      type="button"
      onClick={onPress}
      aria-pressed={selected}
      className={cn(
        "press flex w-full flex-col gap-3 rounded-panel border p-3.5 text-start shadow-card transition-colors",
        selected ? "border-brand bg-brand/5 ring-2 ring-brand/20" : nobody ? "border-dashed border-warning/50 bg-warning/4 hover:border-warning" : "border-line bg-surface hover:border-brand/45",
      )}
    >
      <span className="flex items-center gap-2.5">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full text-[0.95rem] font-black",
            nobody ? "bg-warning/15 text-warning" : "bg-brand/10 text-brand",
          )}
        >
          {nobody ? <Hand className="size-5" aria-hidden /> : (card.name.trim()[0] ?? "؟")}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[0.92rem] font-black text-ink">
            {nobody ? t("unassigned") : card.name || t("workColleague")}
            {me && <span className="ms-1.5 rounded-chip bg-brand/10 px-1.5 py-0.5 text-[0.62rem] font-extrabold text-brand">{t("workshopMe")}</span>}
          </span>
          <span className="block text-[0.7rem] font-bold text-muted">
            {nobody ? t("workshopNobodyHint") : card.rank ? t(`rank_${card.rank}`) : t("workColleague")}
          </span>
        </span>
        {card.waiting > 0 && (
          <span className="ms-auto inline-flex shrink-0 items-center gap-1 rounded-chip bg-warning/12 px-2 py-0.5 text-[0.66rem] font-extrabold text-warning">
            <Hourglass className="size-3" aria-hidden />
            {t("workshopWaiting", { count: card.waiting })}
          </span>
        )}
      </span>
      <span className="grid grid-cols-3 gap-2">
        {figures.map((figure) => (
          <span key={figure.key} className="flex flex-col items-center gap-0.5 rounded-card bg-subtle px-2 py-2">
            <figure.Icon className={cn("size-4", figure.tone)} aria-hidden />
            <span className="text-[1.15rem] font-black leading-tight text-ink" data-numeric>
              {formatPrice(figure.value)}
            </span>
            <span className="text-center text-[0.62rem] font-bold leading-tight text-muted">{figure.label}</span>
          </span>
        ))}
      </span>
    </button>
  );
}

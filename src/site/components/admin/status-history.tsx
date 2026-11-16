"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Bot, History, UserRound } from "lucide-react";
import { loadStatusHistory } from "@/lib/actions/status-history";
import { formatDayTime } from "@/lib/data/datetime";
import { statusTone, TONE_VAR } from "@/lib/data/status-tone";
import type { StatusEvent } from "@/lib/data/orders";
import type { HistoryKind } from "@/lib/queries/status-steps";

/**
 * Every move an order, a ticket or a buy-back has made — with when, and who.
 *
 * The name under each step is the account that made the move (see
 * `loadStatusHistory`): a member of staff by name, the customer's own act,
 * or a move nobody signed in made. The newest move is marked, because it is
 * the one somebody is usually asking about.
 *
 * The status buttons say where the work IS; this says how it got there —
 * which is the question somebody asks when a customer rings to say "you told
 * me it was ready on Tuesday". Read on open (`loadStatusHistory`), and again
 * whenever `status` changes, so a press on a status button appears here on the
 * frame the board confirms it.
 */
export function StatusHistory({
  kind,
  id,
  status,
  label,
}: {
  kind: HistoryKind;
  id: string;
  /** The current status — a change re-reads the history. */
  status: string;
  /** A status as this board words it. */
  label: (status: string) => string;
}) {
  const t = useTranslations("Admin");
  const locale = useLocale();
  const [state, setState] = useState<{
    available: boolean;
    events: StatusEvent[];
  } | null>(null);

  useEffect(() => {
    // A cancellation flag and no run-once ref: the pairing of the two is what
    // once left the rating dialog on its skeleton for ever.
    let alive = true;
    loadStatusHistory(kind, id)
      .then((result) => {
        if (alive) setState(result);
      })
      .catch(() => {
        if (alive) setState({ available: false, events: [] });
      });
    return () => {
      alive = false;
    };
  }, [kind, id, status]);

  return (
    <section className="space-y-2.5">
      <h3 className="flex items-center gap-1.5 text-[0.78rem] font-extrabold text-ink">
        <History className="size-3.5 text-muted" aria-hidden />
        {t("statusHistory")}
      </h3>

      {state === null ? (
        <div className="sheen h-14 rounded-card bg-subtle" aria-hidden />
      ) : !state.available ? (
        <p className="rounded-card border border-dashed border-line px-3 py-2.5 text-[0.72rem] font-medium text-muted">
          {t("statusHistoryOff")}
        </p>
      ) : state.events.length === 0 ? (
        <p className="rounded-card border border-dashed border-line px-3 py-2.5 text-[0.72rem] font-medium text-muted">
          {t("statusHistoryEmpty")}
        </p>
      ) : (
        <ol className="space-y-0 rounded-card border border-line px-3 py-2">
          {state.events.map((event, i) => {
            const latest = i === state.events.length - 1;
            const by = event.by;
            return (
              <li
                key={`${event.status}-${event.at}-${i}`}
                className="flex items-start gap-2.5 border-line/60 py-2 [&+&]:border-t"
              >
                <span
                  className="mt-1.5 size-2 shrink-0 rounded-full"
                  style={{ background: TONE_VAR[statusTone(event.status)] }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-[0.78rem] font-bold text-ink">
                      {label(event.status)}
                    </span>
                    {latest && (
                      <span className="rounded-chip bg-brand/10 px-1.5 py-0.5 text-[0.62rem] font-extrabold text-brand">
                        {t("statusHistoryLatest")}
                      </span>
                    )}
                  </span>
                  {by && (
                    <span className="mt-0.5 flex items-center gap-1 text-[0.7rem] font-semibold text-muted">
                      {by.kind === "system" ? (
                        <Bot className="size-3 shrink-0" aria-hidden />
                      ) : (
                        <UserRound className="size-3 shrink-0" aria-hidden />
                      )}
                      <span className="truncate">
                        {by.kind === "staff"
                          ? t("statusHistoryBy", { name: by.name ?? t("workColleague") })
                          : by.kind === "customer"
                            ? t("statusHistoryByCustomer")
                            : t("statusHistoryBySystem")}
                      </span>
                    </span>
                  )}
                </span>
                <span className="shrink-0 pt-0.5 text-[0.7rem] font-semibold text-muted" dir="ltr">
                  {formatDayTime(locale, event.at)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { History } from "lucide-react";
import { loadStatusHistory } from "@/lib/actions/status-history";
import { formatDayTime } from "@/lib/data/datetime";
import { statusTone, TONE_VAR } from "@/lib/data/status-tone";
import type { StatusEvent } from "@/lib/data/orders";
import type { HistoryKind } from "@/lib/queries/status-steps";

/**
 * Every move an order, a ticket or a buy-back has made, with when.
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
          {state.events.map((event, i) => (
            <li
              key={`${event.status}-${event.at}-${i}`}
              className="flex items-center gap-2.5 border-line/60 py-1.5 [&+&]:border-t"
            >
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: TONE_VAR[statusTone(event.status)] }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-[0.78rem] font-bold text-ink">
                {label(event.status)}
              </span>
              <span className="shrink-0 text-[0.7rem] font-semibold text-muted">
                {formatDayTime(locale, event.at)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

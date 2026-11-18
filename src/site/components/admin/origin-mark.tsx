"use client";

import { Globe, Store } from "lucide-react";
import { useTranslations } from "next-intl";
import type { RecordOrigin } from "@/lib/data/record-origin";
import { cn } from "@/lib/utils";

/**
 * Where a row came from — entered at the shop, or sent in by the customer
 * from the site (the shop, 2026-11-18). One chip on the repair desk, the
 * replacement queue and the orders board, so the two are told apart the same
 * way everywhere.
 *
 * Both answers are drawn, deliberately: the question is "which of these did
 * we enter ourselves", and a mark on only one kind leaves the other to be
 * read from its absence. The two differ in glyph and in word as well as in
 * colour. Nothing is drawn when it cannot be told.
 */
export function OriginMark({
  origin,
  kind = "ticket",
  className,
}: {
  origin: RecordOrigin | null | undefined;
  /** An order says "sale"; a repair or a replacement says "entered". */
  kind?: "ticket" | "order";
  className?: string;
}) {
  const t = useTranslations("Admin");
  if (!origin) return null;
  const counter = origin === "counter";
  const label = counter
    ? kind === "order"
      ? t("counterSale")
      : t("originCounter")
    : kind === "order"
      ? t("originWebOrder")
      : t("originWeb");
  const Icon = counter ? Store : Globe;
  return (
    <span
      title={counter ? t("originCounterHint") : t("originWebHint")}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-chip px-1.5 py-0.5 text-[0.62rem] font-extrabold",
        counter ? "bg-gold/15 text-gold-ink" : "bg-info/12 text-info",
        className,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {label}
    </span>
  );
}

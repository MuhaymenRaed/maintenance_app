"use client";

import { Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, Printer, ShieldCheck, type LucideIcon } from "lucide-react";
import { EntityDialog, Field, input, NumberInput } from "@/components/admin/form-kit";
import { useOwnerDocument } from "@/lib/windows/owner-document";
import { updateRepair } from "@/lib/actions/sections";
import { MARK_DOT, MARK_MONO_PATH, MARK_PATH, MARK_VIEWBOX } from "@/lib/brand/mark";
import { baghdadDay } from "@/lib/data/date-window";
import { daysBetween, warrantyEnd } from "@/lib/data/repair-desk";
import type { RepairPrintFacts } from "@/lib/data/repair-print-facts";
import { site } from "@/lib/data/site";
import { formatPrice } from "@/lib/format";
import { SHEET_PAGES, type SheetPage } from "@/lib/print/station-settings";
import { stationSettingsStore } from "@/lib/print/station-store";
import { startPrint } from "@/lib/print/station";
import { cn } from "@/lib/utils";
import { fitLabelText } from "@/lib/print/label-fit";
import { DateField } from "@/components/ui/date-field";

/**
 * The three papers a manager prints from a ticket.
 *
 * - **وصل الجهاز** — a 57 x 39 mm sticky label for the device itself.
 * - **وصل الصيانة** — the customer's A5 receipt, printed **twice**: one copy
 *   for them and one for the file.
 * - **الضمان** — an A5 warranty paper, from the fields of the old "طباعة ضمان"
 *   window: the customer, the device, the fault, how long, from when, to when.
 *
 * ---------------------------------------------------------------------------
 * One press, three papers
 * ---------------------------------------------------------------------------
 * ⚠️ **«طباعة» no longer opens a chooser.** It used to list the three papers
 * and print whichever was pressed, so the desk's commonest act — hand the
 * customer a receipt, keep one, stick the label on the device — cost three
 * presses through a modal asking a question whose answer was always "all of
 * them". `TICKET_RUN` is that answer, written down once.
 *
 * ⚠️ **Two copies of a receipt is one print job, not two.** `copies` renders
 * the paper twice inside the same sheet with a page break between, so the
 * browser is asked for one A5 job of two pages. Calling `window.print()` twice
 * would put a second dialog in front of somebody who has already said yes.
 *
 * ⚠️ **The label is a second job, and that is physics rather than a
 * shortcoming.** An A5 receipt and a 57 mm sticker are different paper on
 * different printers, and one print job goes to one printer with one paper
 * size — there is no CSS that makes a browser hand one job to two of them. So
 * the run is one dialog for the two receipts and one for the label: a press
 * that cannot be reduced below two dialogs is reduced to two.
 *
 * ---------------------------------------------------------------------------
 * How it reaches the paper
 * ---------------------------------------------------------------------------
 * ⚠️ It prints the page itself rather than opening a window, so the sheet is
 * portalled straight into `<body>`: the print rules in `globals.css` hide every
 * child of `<body>` but this one, which is what keeps the dialogs, their scrim
 * and the dashboard off the paper. Inside a dialog it would be hidden with it.
 *
 * ⚠️ The paper size travels with the sheet, in its own `<style>`. `@page` cannot
 * be scoped to a selector, so three papers cannot share one stylesheet, and a
 * rule left in `globals.css` would apply to every one of them. Margins are zero
 * because that is what stops the browser adding its own date and URL along the
 * edge — the space is inside each sheet instead.
 *
 * ⚠️ Each sheet is a little smaller than its page. A sheet of exactly the page
 * size spills onto a second, blank one on a rounding error, which on label
 * stock wastes a label every time.
 *
 * ⚠️ Fixed colours, never tokens: a paper printed from a dark dashboard must
 * come out black on white, and `--ink` would come out white on white.
 *
 * The amount on every paper is **مبلغ الصيانة** — the repair and its warranty
 * together, which is what the customer pays. Where a warranty was sold the
 * papers say how much of that figure it is; what they never carry is the
 * purchase price, what has been collected or the margin, which are the desk's.
 */

/*
 * The facts on paper live in `lib/data/repair-print-facts.ts` — the board, the
 * counter's dialog and the print station's fresh read of a ticket all build
 * them through one mapping there. Re-exported so callers keep this import.
 */
export type { RepairPrintFacts } from "@/lib/data/repair-print-facts";

export type Paper = "label" | "receipt" | "warranty";

/** One entry is one trip to the printer; `copies` repeats the paper inside it. */
export type PrintJob = { paper: Paper; copies: number };

/** What «طباعة» sends: the customer's two receipts, then the device's label. */
export const TICKET_RUN: readonly PrintJob[] = [
  { paper: "receipt", copies: 2 },
  { paper: "label", copies: 1 },
];

const WARRANTY_RUN: readonly PrintJob[] = [{ paper: "warranty", copies: 1 }];

/**
 * The page each paper asks for.
 *
 * ---------------------------------------------------------------------------
 * The label printer, from its own spec sheet
 * ---------------------------------------------------------------------------
 * **HPRT LPQ58**, direct thermal — the shop confirmed the model on 2026-11-04
 * and sent the manual's table:
 *
 *     resolution        203 dpi  =  8 dots/mm
 *     printing width    56 mm max     (448 dots)
 *     printing length   400 mm max
 *     media width       25.4 - 58 mm
 *     speed             76 mm/s
 *
 * Two of those decide this label's geometry; the rest are background.
 *
 * ⚠️ **56 mm is the hard one, and 60 x 40 mm was the bug.** A 60 mm page is
 * wider than the paper it would be printed on, so the size never appears in
 * the driver, the browser falls back to the default paper, and the label comes
 * out as a stamp in the corner of a sheet the printer does not have. From the
 * counter that reads as "the sticker paper is not recognised", which is how it
 * was reported. The page is 57 mm and the sheet inside it 55 mm, centred, so
 * the ink spans 1 mm to 56 mm of the page while the head covers 56 mm of it:
 * whichever edge the driver aligns its printable area to, what is lost is
 * margin rather than print.
 *
 * ⚠️ **8 dots/mm is why the rules are 0.25 mm.** A thermal head cannot draw
 * part of a dot. 0.2 mm is 1.6 dots and comes out as one dot here and two
 * there, which on a rule running the width of the label is a line that looks
 * unevenly inked; 0.25 mm is exactly 2 dots and is the same every time. The
 * geometry is on the same grid for the same reason: 57 x 39 mm is 456 x 312
 * dots, the sheet 440 x 296, every margin and gap a whole number of dots.
 *
 * ⚠️ **The label's HEIGHT is not the printer's business.** It accepts anything
 * from 15 to 400 mm, so 39 mm comes from the shop's own roll and nothing in
 * this file can derive it. The die-cut pitch the gap sensor follows is a
 * driver setting, not a CSS one — see README if the driver has no matching
 * paper size.
 */
/**
 * ⚠️ **The two A5 papers follow the station's own page setting**, which is
 * usually A5 and is A4 on a PC whose printer has no A5 tray — most office
 * lasers. Left to the driver to substitute, an A5 job lands on A4 wherever
 * the driver decides, which is what makes a test print look wrong in ways
 * nobody can name. Stated here, it is the same sheet on a bigger page.
 *
 * The sheet keeps its own 209 x 147 mm either way: the design is measured to
 * that rectangle, and `mx-auto` centres it across the page. ⚠️ It is NOT
 * centred vertically, and a margin is the wrong way to try — a block's top
 * margin is truncated at a forced break, so the first copy of the receipt
 * would sit centred and the second at the top. The agent path centres it,
 * because a raster can be placed anywhere for nothing; see `a5Paper`.
 *
 * The label's page is the roll and has nothing to do with this.
 */
const page = (paper: Paper, sheetPage: SheetPage): string =>
  paper === "label"
    ? "@page { size: 57mm 39mm; margin: 0; }"
    : `@page { size: ${SHEET_PAGES[sheetPage].css}; margin: 0; }`;

/** A second copy starts a new page; a single copy never draws a break at all. */
const COPY_BREAK = ".print-paper + .print-paper { break-before: page; }";

/** The number the shop's own printed form carries. */
const FORM_PHONE = site.repairCardPhones[0];

/**
 * Long enough for `window.print()` to have returned before the sheet under it
 * is swapped, short enough that the second dialog follows the first without
 * the desk wondering whether the press landed.
 */
const SETTLE_MS = 160;

const clock = (at: number) =>
  new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: "Asia/Baghdad",
  }).format(at);

/* ── The run ──────────────────────────────────────────────────────────────── */

/**
 * Prints a list of jobs one after another and reports when the last is done.
 * No UI of its own beyond a note saying which paper is at the printer — mount
 * it, and the browser's own dialogs are the rest.
 *
 * ⚠️ `printedAt` is passed in rather than read here: reading the clock during
 * render is impure (`react-hooks/purity`), so the press that started the run
 * is what stamps it. It is also the honest reading — the date on the paper is
 * when the desk asked for it, not when a re-render happened to occur.
 */
export function RepairPrintRun({
  facts,
  printedAt,
  jobs = TICKET_RUN,
  onDone,
}: {
  facts: RepairPrintFacts;
  printedAt: number;
  jobs?: readonly PrintJob[];
  onDone: () => void;
}) {
  const t = useTranslations("Admin");
  const [step, setStep] = useState(0);
  const job = jobs[step];

  /*
   * The index comes back from the sheet rather than being read out of `step`,
   * so a sheet that outlives its turn can never advance the run past itself.
   */
  const finished = useCallback(
    (index: number) => {
      if (index + 1 >= jobs.length) onDone();
      else setStep(index + 1);
    },
    [jobs.length, onDone],
  );

  if (!job) return null;

  return (
    <>
      <RepairPrintSheet
        key={step}
        index={step}
        paper={job.paper}
        copies={job.copies}
        facts={facts}
        printedAt={printedAt}
        onFinished={finished}
      />
      {/*
        A press now opens two dialogs in a row, so the desk is told which paper
        is in front of them and that another follows. Its own portal, outside
        `.print-sheet`: `globals.css` hides every other child of `<body>` while
        printing, so this cannot reach the paper.
      */}
      <PrintingNote
        paper={t(`printPaper_${job.paper}` as "printPaper_label")}
        step={step + 1}
        total={jobs.length}
      />
    </>
  );
}

function PrintingNote({ paper, step, total }: { paper: string; step: number; total: number }) {
  const t = useTranslations("Admin");
  const owner = useOwnerDocument() ?? document;
  return createPortal(
    <div role="status" className="fixed inset-x-0 bottom-6 z-110 flex justify-center px-4">
      <p className="pointer-events-none flex items-center gap-2 rounded-chip bg-ink/90 px-4 py-2 text-[0.78rem] font-extrabold text-canvas shadow-lg">
        <Printer className="size-4 shrink-0" aria-hidden />
        {t("printingNow", { paper, step: String(step), total: String(total) })}
      </p>
    </div>,
    owner.body,
  );
}

/**
 * Mounts, waits for its pictures, prints, reports back.
 *
 * ⚠️ **`afterprint` fires inside `window.print()`**, before it returns, so the
 * run is advanced from a fresh task rather than from the handler: swapping the
 * sheet there would change the document the browser is still reading from.
 *
 * ⚠️ **`window.print()` returning is the belt.** `afterprint` is not fired by
 * every browser, and a run that waited only for it would stall for ever on the
 * first paper rather than merely failing to clean up — which is what the old
 * single-sheet version could afford and a chain of jobs cannot.
 *
 * ⚠️ **"window" is the sheet's own.** A print asked for from a ticket's
 * detached window is printed by that window, so its dialog opens in front of
 * the person who asked — and its clock runs while the dashboard is minimised.
 */
function RepairPrintSheet({
  index,
  paper,
  copies,
  facts,
  printedAt,
  onFinished,
}: {
  index: number;
  paper: Paper;
  copies: number;
  facts: RepairPrintFacts;
  printedAt: number;
  onFinished: (index: number) => void;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  /*
   * Read through the store rather than from storage during render — the
   * shape `lib/cart` and `lib/auth/session-store` already use, and the
   * reason is the same: reading `localStorage` while rendering is impure.
   * The snapshot is synchronous in the browser, so the `@page` rule is in
   * the DOM before the print effect below ever runs.
   */
  const station = useSyncExternalStore(
    stationSettingsStore.subscribe,
    stationSettingsStore.snapshot,
    stationSettingsStore.server,
  );
  /*
   * Held in a ref so the print effect below runs exactly once on mount without
   * a changing callback identity re-running it. A second run is a second print
   * dialog, which is the one thing this component must never produce.
   */
  const report = useRef<() => void>(undefined);
  useEffect(() => {
    report.current = () => onFinished(index);
  });

  useEffect(() => {
    const view = sheet.current?.ownerDocument.defaultView ?? window;
    let spent = false;
    let stopped = false;
    const timers: number[] = [];
    const end = () => {
      if (spent) return;
      spent = true;
      timers.push(view.setTimeout(() => report.current?.(), SETTLE_MS));
    };
    view.addEventListener("afterprint", end);
    // After the commit, and cancellable: StrictMode runs this twice in
    // development, and two print dialogs is what a bare call would open. A logo
    // still downloading would otherwise print as an empty box.
    timers.push(
      view.setTimeout(() => {
        const pictures = [...(sheet.current?.querySelectorAll("img") ?? [])];
        void Promise.all(
          pictures.map((picture) => picture.decode().catch(() => undefined)),
        ).then(() => {
          if (stopped) return;
          view.print();
          end();
        });
      }, 0),
    );
    return () => {
      stopped = true;
      spent = true;
      for (const timer of timers) view.clearTimeout(timer);
      view.removeEventListener("afterprint", end);
    };
  }, []);

  const owner = useOwnerDocument() ?? document;
  const Sheet = paper === "label" ? LabelSheet : paper === "receipt" ? ReceiptSheet : WarrantySheet;

  return createPortal(
    <div ref={sheet} className="print-sheet">
      <style>{`${page(paper, station.a5.page)} ${COPY_BREAK}`}</style>
      {Array.from({ length: copies }, (_, copy) => (
        <Sheet key={copy} facts={facts} printedAt={printedAt} />
      ))}
    </div>,
    owner.body,
  );
}

/* ── الضمان, which still asks a question ──────────────────────────────────── */

/**
 * The old print chooser's third option, on its own.
 *
 * It is the one paper that cannot be fired blind: a warranty has a length and
 * a start date, and they are decided at the moment of printing rather than
 * read off the ticket. So «طباعة» prints the three papers that need no answer,
 * and this opens for the one that does.
 */
export function RepairWarrantyDialog({
  facts,
  ticketId,
  canEdit,
  warrantyAvailable,
  today,
  onClose,
}: {
  facts: RepairPrintFacts;
  ticketId: string;
  /** May this reader change the warranty's dates, or only print them. */
  canEdit: boolean;
  warrantyAvailable: boolean;
  /** Today's Baghdad day, from the server. */
  today: string;
  onClose: () => void;
}) {
  const t = useTranslations("Admin");
  const locale = useLocale();
  const [days, setDays] = useState<number>(facts.warrantyDays ?? 30);
  const [start, setStart] = useState(facts.warrantyStart ?? today);
  const end = warrantyEnd(start, days);
  const [busy, setBusy] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [saving, startSaving] = useTransition();

  /** What is on the paper is what is on the ticket, so the two cannot differ. */
  function print(at: number, from: Document) {
    const changed = days !== facts.warrantyDays || start !== facts.warrantyStart;
    if (canEdit && warrantyAvailable && changed) {
      setSaveFailed(false);
      startSaving(async () => {
        const result = await updateRepair(ticketId, { warrantyDays: days, warrantyStart: start });
        if (!result.ok) setSaveFailed(true);
      });
    }
    /*
     * Through the print station, like the receipts: an A5 paper goes to the A5
     * printer on a machine with QZ Tray, and through the browser's dialog on
     * one without. The facts are the ones on this form — the dates the person
     * just chose — so the station is told not to re-read the ticket.
     */
    const started = startPrint({
      ticketId: null,
      facts: { ...facts, warrantyDays: days, warrantyStart: start },
      printedAt: at,
      papers: WARRANTY_RUN,
      locale,
      from,
    });
    setBusy(started === "busy");
  }

  return (
    <EntityDialog
      title={t("printOptionWarranty")}
      subtitle={`${facts.code} · ${facts.customerName}`}
      closeLabel={t("close")}
      onClose={onClose}
      width={520}
      footer={
        <button
          type="button"
          onClick={onClose}
          className="ms-auto rounded-control px-3 py-2 text-[0.8rem] font-bold text-muted hover:text-ink"
        >
          {t("close")}
        </button>
      }
    >
      <div className="space-y-3">
        <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 rounded-card border border-line bg-canvas p-3.5 text-[0.8rem]">
          <dt className="font-bold text-muted">{t("warrantyCustomer")}</dt>
          <dd className="font-extrabold text-ink">{facts.customerName}</dd>
          <dt className="font-bold text-muted">{t("warrantyDevice")}</dt>
          <dd className="font-extrabold text-ink">{facts.device}</dd>
          <dt className="font-bold text-muted">{t("warrantyFault")}</dt>
          <dd className="font-extrabold text-ink">{facts.fault || "—"}</dd>
        </dl>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("warrantyDurationField")}>
            <NumberInput value={days} onChange={setDays} min={1} max={3650} disabled={!canEdit} />
          </Field>
          <Field label={t("warrantyFrom")}>
            <DateField
              type="date"
              value={start}
              onChange={(event) => event.target.value && setStart(event.target.value)}
              disabled={!canEdit}
              className={input}
            />
          </Field>
          <Field label={t("warrantyTo")}>
            <DateField
              type="date"
              value={end}
              min={start}
              onChange={(event) => {
                if (event.target.value) setDays(Math.max(1, daysBetween(start, event.target.value)));
              }}
              disabled={!canEdit}
              className={input}
            />
          </Field>
        </div>
        {saveFailed && (
          <p role="alert" className="text-[0.74rem] font-bold text-warning">
            {t("warrantyDatesNotSaved")}
          </p>
        )}
        <button
          type="button"
          onClick={(event) => print(Date.now(), event.currentTarget.ownerDocument)}
          disabled={days < 1 || saving}
          className="press inline-flex w-full items-center justify-center gap-2 rounded-control bg-brand px-4 py-2.5 text-[0.84rem] font-extrabold text-white transition-colors hover:bg-brand-hover disabled:opacity-60"
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Printer className="size-4" aria-hidden />
          )}
          {t("printWarrantyButton")}
        </button>
      </div>

      {busy && (
        <p role="alert" className="mt-2 text-[0.74rem] font-bold text-warning">
          {t("psBusy")}
        </p>
      )}
    </EntityDialog>
  );
}

/* ── Shared ───────────────────────────────────────────────────────────────── */

/**
 * The A5 papers' palette, stated once.
 *
 * The hexes are written as literals in the classes below rather than read from
 * a constant, because Tailwind only emits a class it can *read in the source*:
 * `bg-[${red}]` compiles and ships no rule. This is the list they are kept in
 * step with.
 *
 *     #e11d2e   the brand red     titles, the rule, the table head, the amount
 *     #a90f1d   the red, deeper   small type, where 8 pt of #e11d2e on white
 *                                 is thin on a laser
 *     #fdeff1   the red at ~4%    panel grounds
 *     #f2c4ca   that tint's edge  so a tinted panel needs no grey border
 *     #333333   the mark's ink    the company name, as on the shop's own sign
 *     #000000   ink               EVERY word on the paper that is not red
 *
 * ⚠️ **There is no grey, and a near-black is a grey.** The sheet is sent to
 * the Canon as a 300 dpi picture, so the driver halftones it: a colour that
 * is not pure K is laid down as a screen of dots, and at 8.5 pt a screen is
 * a pale, mottled smudge rather than a letter. This was measured on the
 * rasterised page, not reasoned about — the darkest ink anywhere on it was
 * luminance **16**, and the terms, at #222, were **33**. The shop reported it
 * as "the black colors is kinda pale gray" on 2026-11-14 and they were
 * reading it correctly. Hierarchy here is size and weight; it is never
 * greyness. The one exception is the lockup, which keeps #333333 because that
 * is the logo's own colour off the identity sheet — and the dotted rules,
 * which are light by being thin and dotted rather than by being grey.
 *
 * ⚠️ **The label reads none of it and must not.** It is printed by a thermal
 * head, which has one dot and two states, so every colour here would reach it
 * as a dither pattern — at 7 pt, a smudge. The label is `#000` on white; see
 * the note on `LabelSheet`.
 *
 * ⚠️ **Colour is never the only thing carrying a fact.** These sheets are
 * printed on a colour laser and photocopied in mono often enough that red has
 * to sit *over* something the words and the weight already say: the remaining
 * amount is red **and** bold **and** labelled «المبلغ الباقي», and the table
 * head is white-on-red **and** a header row above its own values.
 */

/**
 * The shop's own mark, in its two colours: the plate in the mark's charcoal
 * and the dot in its red. Inline geometry from `lib/brand/mark.ts` rather than
 * a picture, so it is as sharp on paper as the type beside it.
 */
export function CompanyMark({ className }: { className?: string }) {
  return (
    <svg viewBox={MARK_VIEWBOX} className={cn("shrink-0", className)} aria-hidden>
      <path d={MARK_PATH} fillRule="evenodd" fill="#333333" />
      <circle cx={MARK_DOT.cx} cy={MARK_DOT.cy} r={MARK_DOT.r} fill="#e11d2e" />
    </svg>
  );
}

/**
 * The company's own lockup — the mark, the trading name, the trade under it.
 *
 * ⚠️ **This is what replaced `/print/repair-logo.webp`.** That picture is the
 * *repair department's* emblem — a wrench and a cog over «لصيانة الهاتف
 * النقال» — and the shop asked on 2026-11-10 for the company's logo in its
 * place. The paper a customer takes home should carry one identity, and it is
 * the company's; which department issued it is already the title's job.
 * The file stays in `public/print/`, and nothing draws it any more.
 *
 * ⚠️ **Geometry, not a picture.** `CompanyMark` is a path from
 * `lib/brand/mark.ts`, so it is as sharp as the type beside it at any size —
 * and it costs the print station's rasteriser nothing to embed, where an
 * `<img>` has to be fetched and turned into a data URL before the sheet can
 * be drawn onto a canvas.
 *
 * ⚠️ **The name takes the mark's charcoal, not the page's ink.** `#333333` is
 * the shop's own value, read off their vector artwork; `#111` is this paper's
 * reading colour. They are a third of a step apart and they mean different
 * things — the lockup is the logo, and it keeps the logo's colour.
 *
 * The phone numbers are deliberately *not* in it. The receipt carries them in
 * a panel of their own a thumb's width below, and one number printed twice on
 * one sheet is the sheet asking which to ring.
 */
export function CompanyLockup({ markClass }: { markClass: string }) {
  const brand = useTranslations("Brand");
  return (
    <div className="flex shrink-0 items-center gap-[3.6mm]">
      <CompanyMark className={markClass} />
      <div className="min-w-0">
        <p className="whitespace-nowrap text-[15pt] font-bold leading-[1.1] text-[#333333]">
          {brand("name")}
        </p>
        <p className="mt-[1mm] whitespace-nowrap text-[9.4pt] font-bold leading-[1.15] text-[#e11d2e]">
          {brand("trade")}
        </p>
      </div>
    </div>
  );
}

/**
 * The top of both A5 papers: what this paper is, on the reader's start, and
 * who issued it on the end.
 *
 * ⚠️ **Two columns now, where it was three.** It used to be `1fr auto 1fr`
 * with the mark centred on the page and the repair logo balancing the title —
 * and the centring was the whole reason for the grid, because a flex row puts
 * the mark in the middle of whatever gap the title leaves, which moves with
 * the length of the title and the ticket code. With the department's logo gone
 * there is nothing left to centre *between*: the mark travels with the name as
 * one lockup, and a lockup belongs at an edge of a letterhead, not in the
 * middle of it.
 *
 * ⚠️ **The lockup is held off the outer edge, not flush to it.** `me-[10mm]`
 * is margin on its *end* — the left of an Arabic page — so `justify-between`
 * stops it a thumb's width short of the margin and it reads as part of the
 * header rather than as something pinned to the corner. The shop asked for it
 * on 2026-11-12, in those words: slightly bigger, and closer to the middle.
 * It is a nudge and deliberately **not** centring: a mark centred on the page
 * with the title on one side and nothing on the other is a letterhead with a
 * hole in it, which is why the old `1fr auto 1fr` grid was taken out.
 *
 * The mark's size is passed as a whole class string, written out at the call
 * site: Tailwind only emits a class it can read in the source.
 */
export function Letterhead({ children, markClass }: { children: ReactNode; markClass: string }) {
  return (
    <header className="flex items-center justify-between gap-[6mm]">
      <div className="min-w-0 flex-1">{children}</div>
      <div className="me-[10mm] shrink-0">
        <CompanyLockup markClass={markClass} />
      </div>
    </header>
  );
}

/**
 * The letterhead's three parts, shared by both A5 papers.
 *
 * ⚠️ **They exist because the two sheets had drifted into two identities**,
 * and a customer is handed both at one counter on one day. The receipt wore a
 * filled red tab, a red title and its facts on tinted chips under a red rule;
 * the warranty wore red type with a glyph, a **charcoal** title, its ticket
 * code as a plain line and no rule at all. Nothing about that was a decision —
 * it is what two headers written a week apart look like, and it is exactly the
 * difference a reader notices and cannot name.
 *
 * What is deliberately NOT shared is each paper's body and the warranty's own
 * 0.5 mm frame: a certificate the customer keeps and may bring back should
 * look like a certificate, and the two papers carry genuinely different
 * content. Unity is the letterhead, the palette and the closing gesture.
 */
export function PaperEyebrow({ Icon, children }: { Icon?: LucideIcon; children: ReactNode }) {
  return (
    <p className="inline-flex items-center gap-[1.4mm] rounded-full bg-[#e11d2e] px-[3.6mm] py-[1mm] text-[8pt] font-bold leading-none tracking-wide text-white">
      {Icon && <Icon className="size-[3.4mm]" aria-hidden />}
      {children}
    </p>
  );
}

/** The paper's own title: brand red on both sheets, at one size. */
export function PaperTitle({ children }: { children: ReactNode }) {
  return <h1 className="mt-[1.6mm] text-[21pt] font-bold leading-[1.1] text-[#e11d2e]">{children}</h1>;
}

/**
 * The facts that identify the paper — a ticket code, a printing time — on the
 * tint every other panel on these sheets stands on.
 *
 * ⚠️ Nothing in a chip wraps. Each was its own chip once and the pair had no
 * room, so each was squeezed until its own *value* broke in two — a date is
 * not a date once it is split across a line.
 */
export function PaperStamps({ stamps }: { stamps: { label: string; value: string }[] }) {
  return (
    <dl className="mt-[2mm] flex flex-wrap gap-[1.8mm]">
      {stamps.map((stamp) => (
        <div
          key={stamp.label}
          className="flex shrink-0 items-baseline gap-[1.6mm] rounded-[1.4mm] border-[0.25mm] border-[#f2c4ca] bg-[#fdeff1] px-[2.6mm] py-[1mm]"
        >
          <dt className="whitespace-nowrap text-[7.6pt] font-bold leading-none text-[#a90f1d]">{stamp.label}</dt>
          <dd className="whitespace-nowrap text-[9pt] font-bold leading-none text-[#000]" data-numeric>
            {stamp.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The rule that closes the letterhead.
 *
 * ⚠️ Two flat blocks, never a gradient: a laser bands a gradient across 190 mm
 * and a photocopier turns the band into stripes. The charcoal tail is the
 * mark's own colour, so the rule closes under the lockup rather than running
 * out of the page.
 */
export function PaperRule() {
  return (
    <div className="flex h-[0.9mm] overflow-hidden rounded-full" aria-hidden>
      <span className="flex-1 bg-[#e11d2e]" />
      <span className="w-[30mm] bg-[#333333]" />
    </div>
  );
}

/**
 * How a sheet signs off: the mark's own plate either side of one line.
 *
 * ⚠️ **One line, and the diamonds are why.** They are a pair bracketing a
 * sentence; let the sentence wrap and the opening diamond sits beside the
 * first line while the closing one sits beside the second, which reads as two
 * unrelated marks rather than as a bracket. The warranty's own line carries
 * both shop numbers and is the long one, so it sets the size.
 */
/**
 * The hairline that closes a sheet, so the paper's margin reads as designed
 * rather than as the page having run out.
 *
 * ⚠️ **Out of flow, and that is the whole point.** The receipt is a flex
 * column in a fixed 147 mm box with an English nine-fault ticket already
 * inside the foot by a millimetre; a frame that took part in the layout
 * would cost its own border and its own padding on both axes. Positioned
 * absolutely it costs nothing, and the only thing that had to be bought is
 * the 1.5 mm gap between it and the content — paid for by the QR card, which
 * drove the money row and did not need the height, and by the padding of the
 * panels, the table cells and the page. Never by the terms or the fault
 * clamp: an English nine-fault ticket crossed this line by 2.3 mm before
 * that trim, and every fixture in both locales now sits 1.5 mm inside it.
 *
 * ⚠️ **One tone up from the panels, deliberately.** Every tinted panel here
 * is edged #f2c4ca; the frame at that value read as another panel rather
 * than as the sheet edge, and measured luminance 210 in the raster — faint
 * on a machine that already prints pale. #f3939e, the divider the table head
 * uses, measures 177 and is still plainly a light pink.
 *
 * ⚠️ **The inset is a printer's margin, not a taste.** A laser cannot reach
 * the outermost ~4.2 mm of a page, so a frame nearer the edge than that is
 * trimmed along its top and bottom and reads as a line that failed rather
 * than as a border. 4.5 mm in from the sheet, which is itself 0.5 mm in
 * from the page, clears it — and `fit: "page"` shrinks the whole picture
 * into the printable area anyway, so it survives either station setting.
 *
 * ⚠️ **Not on the label.** That sheet is 55 × 37 mm inside a 57 × 39 mm
 * die-cut, so a frame would sit 1 mm from an edge that a roll drifts
 * against — the first thing lost, and on a thermal head a hairline is two
 * dots. The die cut is the label's border.
 */
export function PaperFrame() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-[5mm] inset-y-[4.5mm] rounded-[3mm] border-[0.25mm] border-[#f3939e]"
    />
  );
}

function PaperThanks({ children }: { children: ReactNode }) {
  return (
    <p className="flex w-fit items-center gap-[2.6mm] whitespace-nowrap rounded-full bg-[#fdeff1] px-[4mm] py-[1.4mm] text-[8pt] font-bold leading-none text-[#a90f1d]">
      <span className="size-[1.6mm] shrink-0 rotate-45 bg-[#e11d2e]" aria-hidden />
      {children}
      <span className="size-[1.6mm] shrink-0 rotate-45 bg-[#e11d2e]" aria-hidden />
    </p>
  );
}

/* ── وصل الجهاز — 57 x 39 mm ─────────────────────────────────────────────── */

/**
 * The device's own label, and the one paper on this desk printed by a
 * **thermal** head rather than a laser or an inkjet.
 *
 * ⚠️ **Pure black, with nothing between it and white.** A thermal head has one
 * dot and two states, so every grey and every colour here is dithered into a
 * pattern of black dots. At 7 pt that turns a word into a smudge, and the red
 * title and grey field labels this label used to carry were the part of it
 * hardest to read on the machine it is printed on. Ink is `#000`, ground is
 * white, and emphasis is carried by weight and size.
 *
 * ⚠️ **The mark is the mono one, not the logo file.** `/print/repair-logo.webp`
 * is a colour picture and dithers for the same reason; `MARK_MONO_PATH` is the
 * shop's own measured geometry as a single filled path with the dot punched out
 * of it, which a thermal head renders as cleanly as it renders text.
 *
 * ⚠️ **Hairlines, not dashes, and no frame.** A dashed rule is a run of short
 * strokes with gaps the head may or may not land on; a 0.2 mm solid rule is one
 * or two dots and comes out the same every time. The outer border is gone with
 * them: it bought nothing a sticker's own die-cut edge does not already give,
 * and a line that close to the edge is the first thing lost when the roll
 * drifts a dot or two.
 *
 * ---------------------------------------------------------------------------
 * No ticket number, no device, no QR, no warranty line — the shop's call
 * ---------------------------------------------------------------------------
 * The label carried the code in its header, the device as its first row, a QR
 * of the code beside the rows and «منها الضمان» above the amount. The shop
 * crossed all four off a printed label on 2026-11-05, with "- الكوت" from the
 * badge, so the label is the customer's name, the fault, the amount and the
 * terms. The reasoning for the code was that it is how the bench finds a
 * device's ticket; that is now the receipt's job. Putting the code back is
 * one row, and `lib/print/papers.ts` still repaints a QR dot-exact if a
 * `[data-print-qr]` symbol ever returns (`lib/print/qr.ts` draws it).
 *
 * ---------------------------------------------------------------------------
 * Two shapes: a die-cut label, and a strip that is as long as it needs
 * ---------------------------------------------------------------------------
 * `layout.heightMm` is the die-cut label's height, and the rows truncate to
 * fit it. `null` is continuous paper: the label is as tall as its content,
 * long values wrap rather than cut, and nothing is spent on empty space. The
 * print station measures the rendered height and tells the printer exactly
 * that much. The dialog path always prints the die-cut shape.
 */
export type LabelLayout = { widthMm: number; heightMm: number | null };

/** The shop's 57 x 39 mm roll, less 1 mm of paper on each side. */
export const LABEL_SHEET: LabelLayout = { widthMm: 55, heightMm: 37 };

/*
 * The pool the name and the fault share, and the arithmetic behind it, live in
 * `lib/print/label-fit.ts` — measured on this sheet, so a change to the
 * lockup, the footer, the fixed rows or any row's leading means re-measuring
 * it there.
 *
 * ⚠️ **Both free-text fields are fitted, and fitting only the fault is what
 * broke it.** The first cut sized the fault and let the name wrap freely; a
 * four-part name then took a second line, the `dl` is `justify-between`, and
 * a flex row with negative free space **overlaps its own items rather than
 * growing** — so «زبون آجل» printed straight across the thanks line while
 * `scrollHeight` still reported the sheet as fitting exactly. An overflow
 * probe cannot see that at all; only one that compares each row against the
 * next can. There is no third free-text field on this sheet, and one added
 * later needs its own share of the pool.
 */

export function LabelSheet({
  facts,
  layout = LABEL_SHEET,
}: {
  facts: RepairPrintFacts;
  layout?: LabelLayout;
}) {
  const t = useTranslations("Admin");
  const fits = layout.heightMm === null;

  /*
   * ⚠️ **The name and the fault are set to fit rather than cut to fit**, and
   * that is the whole of what the shop reported on 2026-11-13. See
   * {@link fitLabelText}: a die-cut sticker cannot grow, so a nine-fault
   * ticket for a four-part name either loses words to a clamp, prints across
   * its own footer, or is set smaller. Only the third keeps the bench's list
   * and the customer's name whole.
   *
   * On continuous paper the sheet grows instead, so there is no pool and
   * nothing to fit: both fields keep their full size.
   */
  const sized = fits ? null : fitLabelText(facts.customerName, facts.fault);
  const deferred = facts.terms === "deferred";

  /*
   * One label style and one value style for every row: the same size, weight
   * and leading down the whole table is most of what makes it read as one
   * object rather than four lines that happen to be near each other.
   *
   * ⚠️ The label column carries its own `pe` and the grid has NO column gap.
   * The amount row draws its rule as a top border on both of its cells, and a
   * column gap would break that rule into two pieces with a hole between them.
   */
  const labelText = "whitespace-nowrap pe-[2mm] text-[6.3pt] font-semibold leading-[1.3]";
  /*
   * ⚠️ **Nothing that holds a value may carry `overflow: hidden`.** That is
   * what `truncate` and `line-clamp` add, and an Arabic line box is shorter
   * than its own ink: measured on this sheet, every value's glyphs reach 2 px
   * above their box, so hidden sliced the tops off — «الشاشة» printed as
   * «التاشة», which is what the shop photographed on 2026-11-13. The ink
   * paints into the row gap instead, and the words stay whole. The fitted
   * size is what keeps the sheet from overflowing; see {@link fitLabelText}.
   */
  const valueText = "min-w-0 break-words font-bold leading-[1.3] text-[8.4pt]";
  // 0.25 mm = exactly 2 dots at 203 dpi; see the note on PAGE above.
  const amountCell = "mt-[0.5mm] self-stretch border-0 border-t-[0.25mm] border-solid border-[#000] pt-[1.5mm]";

  return (
    <article
      data-label-sheet
      style={{ width: `${layout.widthMm}mm`, height: fits ? undefined : `${layout.heightMm}mm` }}
      className="print-paper mx-auto my-[1mm] flex flex-col overflow-hidden bg-white px-[1.5mm] text-[#000]"
    >
      {/*
       * A letterhead: who issued this at the reader's start, how to reach them
       * at the end, a hairline between. The phones used to be a second footer
       * line under the thanks, which put the two lines a customer keeps the
       * sticker for into the last 6 mm of it, set at 6 pt against a rule. Up
       * here they cost no height at all — the lockup is two lines tall either
       * way — and that one move is what gave the table room to breathe.
       */}
      <header className="flex items-center gap-[2mm] pt-[0.5mm]">
        <svg viewBox={MARK_VIEWBOX} className="size-[6.75mm] shrink-0" aria-hidden>
          <path d={MARK_MONO_PATH} fillRule="evenodd" fill="#000" />
        </svg>
        {/*
         * ⚠️ `whitespace-nowrap`, never `truncate`. Both keep the lockup on two
         * lines; only the second adds `overflow: hidden`, and an Arabic line
         * box is shorter than the ink inside it — the glyphs reach 1 px above
         * their own box, so hidden clipped the tops off the shop's own name.
         */}
        <div className="min-w-0 flex-1">
          <p className="whitespace-nowrap text-[8.6pt] font-bold leading-[1.2]">{t("printBadge")}</p>
          <p className="whitespace-nowrap text-[6pt] font-semibold leading-[1.3]">{t("printDept")}</p>
        </div>
        <div className="flex shrink-0 flex-col justify-center self-stretch border-0 border-s-[0.25mm] border-solid border-[#000] ps-[1.75mm]">
          {site.repairCardPhones.map((phone) => (
            <p key={phone} className="text-end text-[6.6pt] font-bold leading-[1.3]">
              <span data-numeric>{phone}</span>
            </p>
          ))}
        </div>
      </header>

      {/*
       * ⚠️ **The receipt's two-weight rule, in the one ink this head has.**
       * There the rule is brand red with a charcoal tail, so the lockup closes
       * on a colour change; a thermal head has no second colour, so the change
       * is **thickness** — 4 dots under the mark falling to 2 across the rest.
       * Both are whole dots (0.5 and 0.25 mm at 8 dots/mm): a rule measured in
       * between is rounded per edge and prints one dot in places and two in
       * others. The heavy segment is the row's first child, so it sits at the
       * reader's start — under the mark — in both scripts.
       */}
      <div className="mt-[1mm] flex items-start" aria-hidden>
        <span className="h-[0.5mm] w-[11mm] shrink-0 bg-[#000]" />
        <span className="h-[0.25mm] flex-1 bg-[#000]" />
      </div>

      {/*
       * ⚠️ **ONE grid for all three rows, and that is the fix for "messy".**
       * Each row used to be a grid of its own with an `auto` label column, so
       * each value started wherever its own label happened to end: on the
       * label the shop photographed on 2026-11-17 the name, the fault, the
       * amount and the payment began at four different places. Here the label
       * column is as wide as the widest label and every value starts on the
       * same vertical line.
       *
       * ⚠️ `[align-content:safe_center]`, not `content-center`. The table is
       * centred in whatever height the header and footer leave — an ordinary
       * ticket gets even space above and below rather than a hole under it —
       * and `safe` means that a table taller than its box falls back to the
       * top instead of spilling over the header as well as the footer.
       *
       * ⚠️ It must stay `min-h-0`: a flex item's default `min-height: auto`
       * refuses to shrink below its content, so a long fault would push the
       * footer off the bottom edge instead of meeting the fitter's limit.
       */}
      <dl
        className={cn(
          "grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-y-[1.25mm]",
          fits ? "py-[1.75mm]" : "min-h-0 flex-1 py-[1mm] [align-content:safe_center]",
        )}
      >
        <dt className={labelText}>{t("printName")}</dt>
        <dd className={valueText} style={sized ? { fontSize: `${sized.name.pt}pt` } : undefined}>
          {facts.customerName}
        </dd>

        <dt className={labelText}>{t("printFault")}</dt>
        <dd className={valueText} style={sized ? { fontSize: `${sized.fault.pt}pt` } : undefined}>
          {facts.fault}
        </dd>

        {/*
         * ⚠️ **The amount sits beside its label**, which the shop asked for in
         * those words on 2026-11-13: on a 55 mm sticker a figure two
         * centimetres from its label reads as belonging to nothing. It is the
         * hero by size alone, and it starts on the same line as the values
         * above it.
         *
         * The payment is a tag at the far end of the same row rather than a
         * fourth row: «زبون آجل» and «زبون نقدي» say what they are without a
         * label, and they are a fact about this amount. ⚠️ **Deferred is solid
         * black and cash is an outline**, so money still owed is the one thing
         * on the sticker that stands out at a glance. The words carry it too —
         * the fill is never the only thing saying it.
         *
         * Both cells stretch to the row's full height, so their top borders
         * land on one line and draw a single rule across the table.
         */}
        <dt className={cn(labelText, amountCell, "flex items-center")}>{t("printAmount")}</dt>
        <dd className={cn(amountCell, "flex min-w-0 items-center justify-between gap-[1.5mm]")}>
          <span data-numeric className="whitespace-nowrap text-[13pt] font-bold leading-[1.15]">
            {formatPrice(facts.amount)}
          </span>
          <span
            className={cn(
              "shrink-0 whitespace-nowrap rounded-full border-[0.25mm] border-solid border-[#000] px-[1.75mm] py-[0.5mm] text-[6.4pt] font-bold leading-[1.25]",
              deferred ? "bg-[#000] text-white" : "bg-white",
            )}
          >
            {t(deferred ? "printTagDeferred" : "printTagCash")}
          </span>
        </dd>
      </dl>

      {/*
       * The receipt closes on ◆ thanks ◆ and so does this, drawn as one
       * ornament — a hairline running out to each edge — so the table is
       * closed by the line itself rather than by a rule with words crammed
       * under it. A 1 mm square turned 45° is 8 dots across, which keeps its
       * points on a thermal head.
       */}
      <footer className="flex items-center gap-[1.25mm] pb-[0.5mm] pt-[0.5mm]">
        <span className="h-[0.25mm] min-w-[1.5mm] flex-1 bg-[#000]" aria-hidden />
        <span className="size-[1mm] shrink-0 rotate-45 bg-[#000]" aria-hidden />
        <p className="whitespace-nowrap text-[5.8pt] font-bold leading-[1.25]">{t("printThanksShort")}</p>
        <span className="size-[1mm] shrink-0 rotate-45 bg-[#000]" aria-hidden />
        <span className="h-[0.25mm] min-w-[1.5mm] flex-1 bg-[#000]" aria-hidden />
      </footer>
    </article>
  );
}

/* ── وصل الصيانة — A5, printed twice ─────────────────────────────────────── */

/**
 * The customer's receipt — the one paper of the three that leaves the shop in
 * somebody's hand, and the one the shop asked to be printed in colour
 * (2026-11-10).
 *
 * ⚠️ **Red is the shop's own, and it is used in three strengths rather than
 * one.** A sheet that paints every heading in `#e11d2e` has no hierarchy left:
 * everything shouts and the figure the customer actually came for — the total —
 * shouts no louder than the word «الملاحظات». So the full red carries the
 * title, the rule, the table head and the amount; the deeper `#a90f1d` carries
 * the small field labels, where 8 pt of the bright red on white prints thin;
 * and the 4% tint carries the grounds, which is what makes a panel a panel
 * without a grey box around it.
 *
 * ⚠️ **Nothing is said in colour alone** — see the palette note above. This
 * sheet is photocopied, faxed and scanned by people who are not us.
 */
export function ReceiptSheet({ facts, printedAt }: { facts: RepairPrintFacts; printedAt: number }) {
  const t = useTranslations("Admin");
  const received = Date.parse(facts.receivedAt);

  /*
   * ⚠️ **Every cell that holds free text is bounded, and the page depends on
   * it.** Three of the five are typed by a person: the customer's name, the
   * device and the fault list, and the fault is the one that runs away —
   * `facts.fault` is every listed fault joined with «، », so a bench that
   * ticked nine of them produced seven lines in a 37 mm column. Measured
   * before the clamps went in: that pushed the row from 13.7 mm to 33.8 mm,
   * put the sheet 22 mm over an A5 page it cannot grow past, and the page is
   * `overflow-hidden` — so what was cut off was the **terms** and the foot,
   * which is the half of the receipt the shop needs on it. A clamp spends an
   * ellipsis on a rare ticket; no clamp spends clause 4 on it.
   *
   * The line counts are what the reclaimed space allows with the foot still
   * on the page. Measured at 4 fault lines: an ordinary three-fault ticket is
   * two lines and the page keeps 6 mm of slack; the nine-fault one above fills
   * the row and still prints every term and the foot.
   *
   * ⚠️ **On paper the clamp is what holds the height, so it must clamp.**
   * The print station draws the sheet by copying it and laying the copy out
   * again inside an image. Since 2026-11-16 sizes are copied as the
   * stylesheet asked for them rather than as measured — measured widths are
   * what printed the notes over each other — so nothing freezes this row any
   * more: the clamp itself keeps it at three lines, and it now ends on its
   * own «…» on paper too. `rasterize.ts` restates `-webkit-box` on the copy
   * because Chromium reports a clamped box as `flow-root`, which would not
   * clamp; measured with a nine-fault ticket at 110%, the row stays at three
   * lines and the terms and the foot stay on the page.
   */
  const columns = [
    { label: t("receiptCustomer"), value: facts.customerName, lines: "line-clamp-3" },
    { label: t("receiptDevice"), value: facts.device, lines: "line-clamp-3" },
    { label: t("receiptFault"), value: facts.fault, lines: "line-clamp-3" },
    /*
     * The total alone. It carried «منها الضمان» under it, and the shop struck it
     * off on 2026-11-05: the warranty has a paper of its own, and the receipt
     * says what is owed.
     */
    { label: t("receiptTotal"), value: formatPrice(facts.amount), numeric: true, strong: true },
    { label: t("receiptDate"), value: `${baghdadDay(received)}  ${clock(received)}`, numeric: true },
  ];

  /*
   * The code, then when it was printed — **two** chips, where there were
   * three.
   *
   * ⚠️ **The date and the time are one value, and the chips never wrap.** They
   * were a chip each and the pair had no room: the stamps sit in the title
   * block beside the lockup, so each chip was squeezed until its own value
   * broke over two lines — «2026-11-» above «12», «8.41.31» above «AM». A date
   * split across a line break is not a date, and a reader seeing one asks
   * which of the two numbers the paper means. Joined, they are one fact said
   * once; `whitespace-nowrap` on the value and `shrink-0` on the chip are what
   * make the row size to its content instead of the content to the row.
   *
   * The `dl` keeps `flex-wrap`, so if a longer code ever takes the pair past
   * the block's width the second chip drops to its own line whole — which is
   * the failure worth having, where breaking inside a value is not.
   */
  const stamps = [
    { label: t("counterTicketCode"), value: facts.code },
    { label: t("receiptPrintDate"), value: `${baghdadDay(printedAt)}  ${clock(printedAt)}` },
  ];

  const money = [
    {
      label: t("receiptDealing"),
      value: t(facts.terms === "deferred" ? "printDeferred" : "printCash"),
      /* How this was settled is the row the counter is asked about. */
      red: true,
    },
    { label: t("receiptCollected"), value: formatPrice(facts.collected), numeric: true },
    {
      label: t("receiptRemaining"),
      value: formatPrice(facts.remaining),
      numeric: true,
      /*
       * Red only while something is actually owed. A permanent red zero teaches
       * the reader to ignore the colour — the lesson the ratings board's
       * "unhappy" chip already carries — and the word beside it says which
       * figure this is either way, so nothing is lost in mono.
       */
      red: facts.remaining > 0,
    },
  ];

  /*
   * ⚠️ **Five notes now, and the fifth is why the leading tightened.** The
   * shop added «لا يسلم الجهاز للزبون دون تسليم الوصل» on 2026-11-12 — the
   * counter's own rule, and the one note on this paper addressed to the
   * counter as much as to the customer. Five in two columns is three rows
   * where four was two, and this page has about 6 mm of slack on an ordinary
   * ticket: the row it adds is paid for by the box's own leading and padding
   * below, not by the terms or the foot, which are what `overflow-hidden`
   * eats first when the page runs over.
   */
  const notes = [
    t("receiptNote1"),
    t("receiptNote2"),
    t("receiptNote3"),
    t("receiptNote4"),
    t("receiptNote5"),
  ];

  return (
    <article className="print-paper mx-auto relative flex h-[147mm] w-[209mm] flex-col gap-[1.5mm] overflow-hidden bg-white px-[10mm] py-[6mm] text-[#000]">
      <PaperFrame />
      {/*
       * The rule sits close under the stamps, as the shop marked it: the
       * header and its rule are one group with their own small gap rather
       * than two children of the page's 3.4 mm rhythm. The lockup is sized to
       * the title block's own height, so it never pushes the rule down.
       */}
      <div className="flex flex-col gap-[1.5mm]">
        <Letterhead markClass="size-[19mm]">
          {/*
           * The department as a filled pill rather than a line of red type.
           * Two red lines stacked — the eyebrow and the title — read as one
           * block that has been coloured in; reversed out of the red, the
           * eyebrow becomes a tab the title hangs from, which is the shape a
           * letterhead wants and the strongest single note of colour on the
           * sheet for the least ink.
           */}
          <PaperEyebrow>{t("receiptEyebrow")}</PaperEyebrow>
          <PaperTitle>{t("receiptTitle")}</PaperTitle>
          <PaperStamps stamps={stamps} />
        </Letterhead>

        <PaperRule />
      </div>

      {/*
       * The five facts, as the shop's own form sets them: one header row, one
       * row of values. White out of red is the head — a tint there would leave
       * the table the quietest thing on a page whose header is now red, and
       * this row is what the customer reads first.
       */}
      <table className="w-full table-fixed border-separate border-spacing-0 overflow-hidden rounded-[2.4mm] border-[0.3mm] border-[#e11d2e]">
        {/*
         * ⚠️ **Not five equal columns**, which is what the shop's own form
         * uses and what this table had. Equal fifths give every cell 33 mm of
         * text, and the five do not hold comparable things: «50,000» needs a
         * third of that, while the fault is every listed fault joined into one
         * string and is the only cell with no upper bound on its length. The
         * widths are shares of the table, so a wide fault column costs nothing
         * vertically — where the clamp above costs a fault — and it is what
         * takes an ordinary four-fault ticket from four lines to two.
         *
         * `table-fixed` is what makes a `<colgroup>` authoritative; under
         * automatic layout the browser re-sizes from content and the fault
         * column collapses around the longest word in it.
         */}
        <colgroup>
          <col style={{ width: "19%" }} />
          <col style={{ width: "19%" }} />
          <col style={{ width: "28%" }} />
          <col style={{ width: "17%" }} />
          <col style={{ width: "17%" }} />
        </colgroup>
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th
                key={column.label}
                className={cn(
                  "bg-[#e11d2e] px-[2.4mm] py-[2mm] text-center text-[8.2pt] font-bold text-white",
                  /* A light rule between the cells, so the head reads as five. */
                  index > 0 && "border-s-[0.25mm] border-[#f3939e]",
                )}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {columns.map((column, index) => (
              <td
                key={column.label}
                className={cn(
                  "h-[12mm] border-[#f2c4ca] px-[2.4mm] py-[1.3mm] text-center align-middle font-bold leading-snug",
                  /* The amount: the tint lifts it off the row, the red names it. */
                  column.strong ? "bg-[#fdeff1] text-[13.5pt] text-[#e11d2e]" : "text-[9.5pt] text-[#000]",
                  index > 0 && "border-s-[0.25mm]",
                )}
              >
                {column.numeric ? (
                  <span data-numeric>{column.value}</span>
                ) : (
                  /* `line-clamp` needs a block of its own; a `td` cannot be one. */
                  <div className={column.lines}>{column.value}</div>
                )}
              </td>
            ))}
          </tr>
        </tbody>
      </table>

      <div className="grid grid-cols-[37mm_1fr_44mm] items-stretch gap-[4mm]">
        {/*
         * The shop's own QR card, as supplied: it opens their links page —
         * Facebook, Instagram, TikTok and the site — at al-esnad.netlify.app.
         * `public/print/accounts-qr.webp` is that picture trimmed, with its
         * pink glow lifted to pure white (a laser prints a glow as a grey
         * haze), checked to scan down to 150 px wide and after a mono threshold.
         *
         * ⚠️ Its ground stays **white** while the two panels beside it are
         * tinted. A scanner reads a QR by contrast, and the quiet zone is part
         * of the symbol: 4% of red behind it is a risk taken for a decoration.
         */}
        <figure className="flex flex-col items-center justify-center gap-[1.2mm] rounded-[1.8mm] border-[0.25mm] border-[#f2c4ca] bg-white px-[1.5mm] py-[1.6mm]">
          <Image
            src="/print/accounts-qr.webp"
            alt=""
            width={640}
            height={805}
            sizes="17mm"
            loading="eager"
            className="h-auto w-[17mm]"
          />
          {/* One line: «الاسناد» alone on a second line reads as a stray word. */}
          <figcaption className="whitespace-nowrap text-center text-[6.6pt] font-bold leading-tight text-[#000]">
            {t("receiptAccounts")}
          </figcaption>
        </figure>

        <dl className="flex flex-col justify-center gap-[1.2mm]">
          {money.map((row) => (
            <div
              key={row.label}
              className="flex items-center justify-between rounded-[1.8mm] border-[0.25mm] border-[#f2c4ca] bg-[#fdeff1] px-[3.4mm] py-[1.1mm]"
            >
              <dt className="text-[9pt] font-bold text-[#a90f1d]">{row.label}</dt>
              <dd className={cn("text-[11pt] font-bold", row.red ? "text-[#e11d2e]" : "text-[#000]")}>
                {row.numeric ? <span data-numeric>{row.value}</span> : row.value}
              </dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-col items-center justify-center gap-[1.4mm] rounded-[1.8mm] border-[0.25mm] border-[#f2c4ca] bg-[#fdeff1] px-[2mm]">
          <p className="text-[8.5pt] font-bold text-[#a90f1d]">{t("receiptPhones")}</p>
          <p className="text-[12.5pt] font-bold text-[#000]" data-numeric>{FORM_PHONE}</p>
        </div>
      </div>

      {/*
       * ⚠️ **The heading sits ABOVE the list, and that is what stops the notes
       * wrapping.** It used to stand beside them, which cost the list
       * «الملاحظات» plus its gap — 18.6 mm off a 182.2 mm row, so each of the
       * two columns was 79.1 mm. Measured against the notes' own one-line
       * widths, that is not a margin, it is a coin toss: the longest note
       * wants 87.6 mm and wrapped every time, and notes 3 and 4 cleared their
       * column by **0.5 mm and 2.4 mm**. Anything at all — a hinting
       * difference, a sub-pixel rounding, the heading setting a hair wider —
       * tips those two over, and a wrapped note in a tight box is what the
       * shop photographed on 2026-11-14: note 2's second line printed across
       * note 3's first. Given the whole row, every note fits on one line with
       * room to spare.
       *
       * ⚠️ **Room alone did not stop it, and the 2026-11-16 photograph is why.**
       * With the whole row, the shop's sheet still printed every note's last
       * word over the next note. The cause was never this layout: the print
       * station copied each box at the width its words measured on screen,
       * and on a screen at 110% or 125% that is a fraction of a pixel narrower
       * than the same words inside the picture — so the last word wrapped, and
       * the copied one-line height let it paint over its neighbour. Fixed in
       * `lib/print/rasterize.ts` (`LAYOUT_PROPERTIES`); this row's slack is
       * what keeps a note on one line, and the fix is what keeps a note that
       * does wrap from colliding.
       *
       * It reads the same: the heading and «عزيزي الزبون» were already on one
       * visual line, because the heading's column is top-aligned beside a div
       * whose first child is that line. Only the list moved out from under it.
       *
       * ⚠️ The box is still sized to its own text and is **not** `flex-1`.
       * Stretched, it took every millimetre the three blocks above left over
       * and printed a tinted band a centimetre deep with nothing in it, which
       * reads as a panel that failed to fill rather than as the end of a page.
       * What is left over goes under the foot instead.
       */}
      <section className="flex flex-col gap-[1mm] rounded-[2.4mm] border-[0.25mm] border-[#f2c4ca] bg-[#fdeff1] px-[2.5mm] py-[1mm]">
        <div className="flex items-baseline gap-[3.4mm] leading-none">
          <h2 className="shrink-0 text-[9.5pt] font-bold text-[#e11d2e]">{t("receiptNotes")}</h2>
          <p className="text-[8.5pt] font-bold text-[#a90f1d]">{t("receiptDear")}</p>
        </div>
        {/*
         * ⚠️ **The numeral must NOT carry `data-numeric`**, and the reason is
         * the opposite of the usual one. That attribute pins `direction: ltr`,
         * which is right for a price or an IMEI and wrong for «1-»: pinned,
         * the glyphs paint digit-then-dash, so the dash is the rightmost
         * thing on the line and an Arabic reader meets «-1». Left in the
         * reader's own direction the dash is a neutral at the end of a
         * number run, takes the paragraph's RTL, and lands between the digit
         * and the words — which is «1-», the convention, and what the shop's
         * own printed form has always shown. Measured both ways in the
         * browser rather than reasoned about; reasoning about it got it
         * backwards first.
         *
         * ⚠️ **Column flow, not row flow, and the numbers are why.** Filled
         * by rows a two-column list runs 1·2 across, then 3·4, then 5 — so
         * reading down the reader's own column gives **1, 3, 5**, and the
         * numbers appear to skip.
         *
         * ⚠️ The three rows are `auto`, spelled out, and **not**
         * `grid-rows-3` — Tailwind compiles that to `repeat(3, minmax(0,1fr))`,
         * three EQUAL rows that a constrained container squashes **below their
         * own content**, which paints each note over the one beneath it.
         *
         * ⚠️ `leading-[1.55]`, back from the 1.45 it was cut to on
         * 2026-11-12 to pay for a row gap. Measured on the rasterised sheet —
         * the only place that can answer it, because a DOM rect is a line box
         * and Arabic ink overruns it — two lines at 1.45 left **0.38 mm**
         * between their boxes and their ink merged into one band at the
         * printer's own tolerance. The page carries 12.4 mm of slack on an
         * ordinary ticket, so the leading was never the thing to spend.
         */}
        <ol className="grid grid-flow-col grid-cols-2 grid-rows-[repeat(3,auto)] gap-x-[2.5mm] gap-y-[1.3mm] text-[8.5pt] font-medium leading-[1.55] text-[#000]">
          {notes.map((note, index) => (
            /* `items-start`: the numeral belongs beside the note's FIRST
               line. Stretched (the flex default) it centres itself against a
               note that wrapped, which leaves «1-» floating between the two
               lines it is meant to open. `whitespace-nowrap`: «1-» is two
               bidi runs, a European number and a neutral, so it is two line
               fragments and a narrow box can break between them — which is
               how the shop's sheet printed «1» above «-». */
            <li key={note} className="flex items-start gap-[1.2mm]">
              <span className="shrink-0 whitespace-nowrap font-bold text-[#e11d2e]">{index + 1}-</span>
              <span className="min-w-0">{note}</span>
            </li>
          ))}
        </ol>
      </section>

      {/*
       * The foot: `mt-auto` holds it against the bottom edge whatever the
       * terms above come to, so the sheet closes on a line rather than
       * trailing off. The two diamonds are the mark's own plate at 1.6 mm —
       * the shape the warranty paper already uses to bullet its terms.
       */}
      <footer className="mt-auto flex justify-center">
        <PaperThanks>{t("printThanksShort")}</PaperThanks>
      </footer>
    </article>
  );
}

/* ── الضمان — A5 ──────────────────────────────────────────────────────────── */

export function WarrantySheet({ facts }: { facts: RepairPrintFacts }) {
  const t = useTranslations("Admin");
  const days = facts.warrantyDays ?? 30;
  const start = facts.warrantyStart ?? baghdadDay(Date.parse(facts.receivedAt));

  const lines = [
    { label: t("warrantyCustomer"), value: facts.customerName },
    { label: t("warrantyDevice"), value: facts.device },
    { label: t("warrantyFault"), value: facts.fault },
  ];

  return (
    <article className="print-paper mx-auto flex h-[147mm] w-[209mm] flex-col overflow-hidden bg-white px-[5mm] py-[4.5mm] text-[#000]">
      <div className="flex flex-1 flex-col gap-[4mm] rounded-[3mm] border-[0.25mm] border-[#f3939e] px-[11mm] py-[7mm]">
        {/*
         * The same company lockup the receipt carries. The repair department's
         * own logo came off both A5 papers together: two sheets handed over at
         * one counter, on the same day, under two different identities is the
         * shop looking like two shops.
         */}
        {/*
         * ⚠️ The same three parts the receipt carries, at the same sizes and
         * in the same colours — see {@link PaperEyebrow}. The shield stays,
         * inside the pill rather than beside red type: it says which of the
         * two papers this is, which is the one thing that should differ.
         */}
        <div className="flex flex-col gap-[1.5mm]">
          <Letterhead markClass="size-[19mm]">
            <PaperEyebrow Icon={ShieldCheck}>{t("warrantyEyebrow")}</PaperEyebrow>
            <PaperTitle>{t("warrantySheetTitle")}</PaperTitle>
            <PaperStamps stamps={[{ label: t("counterTicketCode"), value: facts.code }]} />
          </Letterhead>
          <PaperRule />
        </div>

        <dl className="space-y-[2.6mm]">
          {lines.map((line) => (
            <div key={line.label} className="grid grid-cols-[32mm_1fr] items-baseline gap-[3mm] border-b-[0.25mm] border-dotted border-[#000] pb-[1.2mm]">
              <dt className="text-[10pt] font-medium text-[#000]">{line.label}</dt>
              <dd className="text-[12.5pt] font-bold text-[#000]">{line.value}</dd>
            </div>
          ))}
        </dl>

        <dl className="grid grid-cols-3 overflow-hidden rounded-[2.4mm] border-[0.3mm] border-[#000] text-center">
          <div className="px-[2mm] py-[2.2mm]">
            <dt className="text-[8.5pt] font-medium text-[#000]">{t("warrantyFrom")}</dt>
            <dd className="text-[13pt] font-bold text-[#000]" data-numeric>{start}</dd>
          </div>
          {/*
           * ⚠️ **The figure is red INK on the paper's own tint, and it was a
           * filled red block.** The shop asked for the red by name on
           * 2026-11-12 — "the ضمان paper must colorful the 30 days with the
           * red color of our visual identity" — and on 2026-11-13, looking at
           * a printed one, asked again: *"make the colour of the days of
           * guarantee of وصل الضمان to be red instead of black background."*
           *
           * Both are the same instruction and the first was answered the
           * wrong way round. ⚠️ **A solid `#e11d2e` field does not print as
           * red on the machine this paper actually goes through** — a mono
           * laser, or a colour one somebody has set to greyscale — it prints
           * as a near-black slab with white type knocked out of it, which is
           * exactly what the shop photographed. A **filled block is the one
           * treatment that cannot degrade gracefully**: the ink carries the
           * whole of it, so losing the hue loses the design. Red type on a
           * near-white tint degrades to dark type on white, which is the same
           * picture with the colour taken out.
           *
           * So the tint is the receipt's own `#fdeff1` — the 4% wash every
           * other panel on these two sheets stands on, which is why this cell
           * now reads as part of the same paper rather than as a stamp applied
           * to it. `#e11d2e` on it is 4.27:1, comfortable at 13 pt bold; the
           * label takes `#a90f1d` at 6.75:1, the deeper red this sheet already
           * reserves for small type, because 8.5 pt of the bright red prints
           * thin.
           *
           * The side rules stay the full red and are the one thing kept from
           * the filled version: they frame the figure, echo the table head on
           * the receipt, and are what still separates this cell from its two
           * white neighbours once the hue is gone. ⚠️ Not `#f2c4ca` — the
           * tint's own hairline is invisible against a white cell, so the
           * divider would vanish on exactly the print this change is for.
           *
           * Nothing is said in colour alone: the label names the figure and
           * the unit is written out beside it.
           */}
          <div className="border-x-[0.3mm] border-[#e11d2e] bg-[#fdeff1] px-[2mm] py-[2.2mm]">
            <dt className="text-[8.5pt] font-medium text-[#a90f1d]">{t("warrantyDuration")}</dt>
            <dd className="text-[13pt] font-bold text-[#e11d2e]">{t("warrantyDurationValue", { count: days, days: String(days) })}</dd>
          </div>
          <div className="px-[2mm] py-[2.2mm]">
            <dt className="text-[8.5pt] font-medium text-[#000]">{t("warrantyTo")}</dt>
            <dd className="text-[13pt] font-bold text-[#000]" data-numeric>{warrantyEnd(start, days)}</dd>
          </div>
        </dl>

        {/*
         * The terms take the space the shop marked for them: under the dates,
         * on the reader's start, stopping short of the signature column — and
         * the thanks line keeps the foot. Each term carries a small diamond,
         * the mark's own shape, and the dotted rule the rows above use.
         */}
        <footer className="flex min-h-0 flex-1 items-end justify-between gap-[8mm]">
          <div className="flex h-full min-w-0 flex-1 flex-col justify-between gap-[3mm]">
            <section>
              <h2 className="mb-[1.4mm] text-[9pt] font-bold text-[#e11d2e]">{t("warrantyTermsTitle")}</h2>
              <ul className="space-y-[1.6mm]">
                {[t("warrantyTerm1"), t("warrantyTerm2")].map((term) => (
                  <li
                    key={term}
                    className="flex items-center gap-[2.4mm] border-b-[0.25mm] border-dotted border-[#000] pb-[1.2mm] text-[11pt] font-bold leading-snug text-[#000]"
                  >
                    <span className="size-[1.7mm] shrink-0 rotate-45 bg-[#000]" aria-hidden />
                    {term}
                  </li>
                ))}
              </ul>
            </section>
            <PaperThanks>{t("printThanks", { phones: site.repairCardPhones.join(" - ") })}</PaperThanks>
          </div>
          <p className="w-[46mm] shrink-0 border-t-[0.3mm] border-[#000] pt-[1mm] text-center text-[8pt] font-medium text-[#000]">
            {t("warrantySignature")}
          </p>
        </footer>
      </div>
    </article>
  );
}

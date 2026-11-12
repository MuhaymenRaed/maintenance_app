"use client";

import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, Printer, ShieldCheck } from "lucide-react";
import { EntityDialog, Field, input, NumberInput } from "@/components/admin/form-kit";
import { updateRepair } from "@/lib/actions/sections";
import { MARK_DOT, MARK_MONO_PATH, MARK_PATH, MARK_VIEWBOX } from "@/lib/brand/mark";
import { baghdadDay } from "@/lib/data/date-window";
import { daysBetween, warrantyEnd } from "@/lib/data/repair-desk";
import type { RepairPrintFacts } from "@/lib/data/repair-print-facts";
import { site } from "@/lib/data/site";
import { formatPrice } from "@/lib/format";
import { startPrint } from "@/lib/print/station";
import { cn } from "@/lib/utils";

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
const PAGE: Record<Paper, string> = {
  label: "@page { size: 57mm 39mm; margin: 0; }",
  receipt: "@page { size: A5 landscape; margin: 0; }",
  warranty: "@page { size: A5 landscape; margin: 0; }",
};

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
  return createPortal(
    <div role="status" className="fixed inset-x-0 bottom-6 z-110 flex justify-center px-4">
      <p className="pointer-events-none flex items-center gap-2 rounded-chip bg-ink/90 px-4 py-2 text-[0.78rem] font-extrabold text-canvas shadow-lg">
        <Printer className="size-4 shrink-0" aria-hidden />
        {t("printingNow", { paper, step: String(step), total: String(total) })}
      </p>
    </div>,
    document.body,
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
   * Held in a ref so the print effect below runs exactly once on mount without
   * a changing callback identity re-running it. A second run is a second print
   * dialog, which is the one thing this component must never produce.
   */
  const report = useRef<() => void>(undefined);
  useEffect(() => {
    report.current = () => onFinished(index);
  });

  useEffect(() => {
    let spent = false;
    let stopped = false;
    const timers: number[] = [];
    const end = () => {
      if (spent) return;
      spent = true;
      timers.push(window.setTimeout(() => report.current?.(), SETTLE_MS));
    };
    window.addEventListener("afterprint", end);
    // After the commit, and cancellable: StrictMode runs this twice in
    // development, and two print dialogs is what a bare call would open. A logo
    // still downloading would otherwise print as an empty box.
    timers.push(
      window.setTimeout(() => {
        const pictures = [...(sheet.current?.querySelectorAll("img") ?? [])];
        void Promise.all(
          pictures.map((picture) => picture.decode().catch(() => undefined)),
        ).then(() => {
          if (stopped) return;
          window.print();
          end();
        });
      }, 0),
    );
    return () => {
      stopped = true;
      spent = true;
      for (const timer of timers) window.clearTimeout(timer);
      window.removeEventListener("afterprint", end);
    };
  }, []);

  const Sheet = paper === "label" ? LabelSheet : paper === "receipt" ? ReceiptSheet : WarrantySheet;

  return createPortal(
    <div ref={sheet} className="print-sheet">
      <style>{`${PAGE[paper]} ${COPY_BREAK}`}</style>
      {Array.from({ length: copies }, (_, copy) => (
        <Sheet key={copy} facts={facts} printedAt={printedAt} />
      ))}
    </div>,
    document.body,
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
  function print(at: number) {
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
            <input
              type="date"
              value={start}
              onChange={(event) => event.target.value && setStart(event.target.value)}
              disabled={!canEdit}
              dir="ltr"
              className={input}
            />
          </Field>
          <Field label={t("warrantyTo")}>
            <input
              type="date"
              value={end}
              min={start}
              onChange={(event) => {
                if (event.target.value) setDays(Math.max(1, daysBetween(start, event.target.value)));
              }}
              disabled={!canEdit}
              dir="ltr"
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
          onClick={() => print(Date.now())}
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
 *     #111111   ink               every value a customer reads off the paper
 *     #54545a   soft              secondary type that is not a heading
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
function CompanyMark({ className }: { className?: string }) {
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
function CompanyLockup({ markClass }: { markClass: string }) {
  const brand = useTranslations("Brand");
  return (
    <div className="flex shrink-0 items-center gap-[3.2mm]">
      <CompanyMark className={markClass} />
      <div className="min-w-0">
        <p className="whitespace-nowrap text-[14pt] font-bold leading-[1.1] text-[#333333]">
          {brand("name")}
        </p>
        <p className="mt-[1mm] whitespace-nowrap text-[8.8pt] font-bold leading-[1.15] text-[#e11d2e]">
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
 * The mark's size is passed as a whole class string, written out at the call
 * site: Tailwind only emits a class it can read in the source.
 */
function Letterhead({ children, markClass }: { children: ReactNode; markClass: string }) {
  return (
    <header className="flex items-center justify-between gap-[6mm]">
      <div className="min-w-0 flex-1">{children}</div>
      <CompanyLockup markClass={markClass} />
    </header>
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

export function LabelSheet({
  facts,
  layout = LABEL_SHEET,
}: {
  facts: RepairPrintFacts;
  layout?: LabelLayout;
}) {
  const t = useTranslations("Admin");
  const fits = layout.heightMm === null;
  const rows = [
    { label: t("printName"), value: facts.customerName },
    // The one row allowed to wrap: it is what was wrong with the phone, and
    // three faults cut to one and an ellipsis is the bench guessing. Three
    // lines now that the device and warranty rows are gone.
    { label: t("printFault"), value: facts.fault, wrap: true },
    { label: t("printAmount"), value: formatPrice(facts.amount), numeric: true, strong: true },
    {
      label: t("printPayment"),
      value: t(facts.terms === "deferred" ? "printDeferred" : "printCash"),
    },
  ];
  // 0.25 mm = exactly 2 dots at 203 dpi; see the note on PAGE above.
  const rule = "border-0 border-t-[0.25mm] border-solid border-[#000]";

  return (
    <article
      data-label-sheet
      style={{ width: `${layout.widthMm}mm`, height: fits ? undefined : `${layout.heightMm}mm` }}
      className="print-paper mx-auto my-[1mm] flex flex-col overflow-hidden bg-white px-[1.5mm] text-[#000]"
    >
      <header className="flex items-center gap-[1.5mm] pb-[0.75mm] pt-[0.25mm]">
        <svg viewBox={MARK_VIEWBOX} className="size-[5.5mm] shrink-0" aria-hidden>
          <path d={MARK_MONO_PATH} fillRule="evenodd" fill="#000" />
        </svg>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[7.6pt] font-bold leading-[1.1]">{t("printBadge")}</p>
          <p className="truncate text-[6.4pt] font-semibold leading-[1.2]">{t("printDept")}</p>
        </div>
      </header>

      <hr className={rule} />

      <div className={cn("flex py-[0.5mm]", fits ? "items-start" : "min-h-0 flex-1 items-center")}>
        <dl className="flex min-w-0 flex-1 flex-col justify-center gap-[0.5mm]">
          {rows.map((row) => (
            <div
              key={row.label}
              className="grid grid-cols-[auto_1fr] items-baseline gap-[1.25mm]"
            >
              <dt className="whitespace-nowrap text-[6.4pt] font-semibold leading-[1.05]">{row.label}</dt>
              <dd
                className={cn(
                  "min-w-0 font-bold",
                  row.strong ? "text-[8.8pt]" : "text-[7.4pt]",
                  /*
                   * ⚠️ After the size, never before it. `cn` is tailwind-merge,
                   * which reads a later `text-[…]` size as overriding an earlier
                   * `leading-*` and drops it — the rows then took the page's 1.5,
                   * six of them no longer fit 37 mm, and the first and last sat
                   * on the two rules. Measured: 14.8 px of line for a 9.87 px font.
                   */
                  "leading-[1.05]",
                  fits ? "break-words" : "wrap" in row && row.wrap ? "line-clamp-3 break-words" : "truncate",
                )}
              >
                {row.numeric ? <span data-numeric>{row.value}</span> : row.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <hr className={rule} />

      <footer className="pb-[0.25mm] pt-[0.75mm] text-center">
        <p className="truncate text-[5.4pt] font-bold leading-[1.25]">{t("printThanksShort")}</p>
        <p className="truncate text-[5.8pt] font-bold leading-[1.25]">
          {t("printPhoneLine", { phones: site.repairCardPhones.join(" - ") })}
        </p>
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
   * ⚠️ **On paper the cut has no ellipsis, and the height still holds.** The
   * print station draws the sheet by copying it with every *computed* style
   * written inline — `height` included — so the picture is frozen at the
   * geometry the live DOM measured and cannot reflow past it. What the
   * sandboxed re-layout does not reproduce is the clamp's own ellipsis glyph,
   * so an over-long fault ends mid-word rather than on a «…». That is
   * cosmetic and only on a ticket with more faults than this row can hold;
   * the guarantee that matters — the terms and the foot stay on the page —
   * comes from the frozen height, not from the clamp being re-evaluated.
   */
  const columns = [
    { label: t("receiptCustomer"), value: facts.customerName, lines: "line-clamp-3" },
    { label: t("receiptDevice"), value: facts.device, lines: "line-clamp-3" },
    { label: t("receiptFault"), value: facts.fault, lines: "line-clamp-4" },
    /*
     * The total alone. It carried «منها الضمان» under it, and the shop struck it
     * off on 2026-11-05: the warranty has a paper of its own, and the receipt
     * says what is owed.
     */
    { label: t("receiptTotal"), value: formatPrice(facts.amount), numeric: true, strong: true },
    { label: t("receiptDate"), value: `${baghdadDay(received)}  ${clock(received)}`, numeric: true },
  ];

  /* The code, then when it was printed — one chip each. */
  const stamps = [
    { label: t("counterTicketCode"), value: facts.code },
    { label: t("receiptPrintDate"), value: baghdadDay(printedAt) },
    { label: t("receiptTime"), value: clock(printedAt) },
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

  const notes = [t("receiptNote1"), t("receiptNote2"), t("receiptNote3"), t("receiptNote4")];

  return (
    <article className="print-paper mx-auto flex h-[147mm] w-[209mm] flex-col gap-[3mm] overflow-hidden bg-white px-[10mm] py-[5mm] text-[#111]">
      {/*
       * The rule sits close under the stamps, as the shop marked it: the
       * header and its rule are one group with their own small gap rather
       * than two children of the page's 3.4 mm rhythm. The lockup is sized to
       * the title block's own height, so it never pushes the rule down.
       */}
      <div className="flex flex-col gap-[1.8mm]">
        <Letterhead markClass="size-[17mm]">
          {/*
           * The department as a filled pill rather than a line of red type.
           * Two red lines stacked — the eyebrow and the title — read as one
           * block that has been coloured in; reversed out of the red, the
           * eyebrow becomes a tab the title hangs from, which is the shape a
           * letterhead wants and the strongest single note of colour on the
           * sheet for the least ink.
           */}
          <p className="inline-flex rounded-full bg-[#e11d2e] px-[3.6mm] py-[1mm] text-[8pt] font-bold leading-none tracking-wide text-white">
            {t("receiptEyebrow")}
          </p>
          <h1 className="mt-[1.6mm] text-[21pt] font-bold leading-[1.1] text-[#e11d2e]">
            {t("receiptTitle")}
          </h1>
          <dl className="mt-[2mm] flex flex-wrap gap-[1.8mm]">
            {stamps.map((stamp) => (
              <div
                key={stamp.label}
                className="flex items-baseline gap-[1.6mm] rounded-[1.4mm] border-[0.25mm] border-[#f2c4ca] bg-[#fdeff1] px-[2.6mm] py-[1mm]"
              >
                <dt className="whitespace-nowrap text-[7.6pt] font-bold leading-none text-[#a90f1d]">
                  {stamp.label}
                </dt>
                <dd className="text-[9pt] font-bold leading-none text-[#111]" data-numeric>
                  {stamp.value}
                </dd>
              </div>
            ))}
          </dl>
        </Letterhead>

        {/*
         * Two flat blocks, never a gradient: a laser bands a gradient across
         * 190 mm and a photocopier turns the band into stripes. The charcoal
         * tail is the mark's own colour, so the rule closes on the lockup
         * above its end rather than running out of the page.
         */}
        <div className="flex h-[0.9mm] overflow-hidden rounded-full" aria-hidden>
          <span className="flex-1 bg-[#e11d2e]" />
          <span className="w-[26mm] bg-[#333333]" />
        </div>
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
                  "h-[12mm] border-[#f2c4ca] px-[2.4mm] py-[1.8mm] text-center align-middle font-bold leading-snug",
                  /* The amount: the tint lifts it off the row, the red names it. */
                  column.strong ? "bg-[#fdeff1] text-[13.5pt] text-[#e11d2e]" : "text-[9.5pt] text-[#111]",
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
            sizes="21mm"
            loading="eager"
            className="h-auto w-[21mm]"
          />
          {/* One line: «الاسناد» alone on a second line reads as a stray word. */}
          <figcaption className="whitespace-nowrap text-center text-[6.6pt] font-bold leading-tight text-[#333333]">
            {t("receiptAccounts")}
          </figcaption>
        </figure>

        <dl className="flex flex-col justify-center gap-[1.6mm]">
          {money.map((row) => (
            <div
              key={row.label}
              className="flex items-center justify-between rounded-[1.8mm] border-[0.25mm] border-[#f2c4ca] bg-[#fdeff1] px-[3.4mm] py-[1.4mm]"
            >
              <dt className="text-[9pt] font-bold text-[#a90f1d]">{row.label}</dt>
              <dd className={cn("text-[11pt] font-bold", row.red ? "text-[#e11d2e]" : "text-[#111]")}>
                {row.numeric ? <span data-numeric>{row.value}</span> : row.value}
              </dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-col items-center justify-center gap-[1.4mm] rounded-[1.8mm] border-[0.25mm] border-[#f2c4ca] bg-[#fdeff1] px-[2mm]">
          <p className="text-[8.5pt] font-bold text-[#a90f1d]">{t("receiptPhones")}</p>
          <p className="text-[12.5pt] font-bold text-[#111]" data-numeric>{FORM_PHONE}</p>
        </div>
      </div>

      {/*
       * ⚠️ The terms box is sized to its own text and is **not** `flex-1`.
       * Stretched, it took every millimetre the three blocks above left over
       * and printed a tinted band a centimetre deep with nothing in it, which
       * reads as a panel that failed to fill rather than as the end of a page.
       * The four notes are fixed strings at a fixed width, so its height is
       * deterministic; what is left over goes under the foot instead.
       */}
      <section className="flex gap-[3.4mm] rounded-[2.4mm] border-[0.25mm] border-[#f2c4ca] bg-[#fdeff1] px-[3.4mm] py-[2mm]">
        <h2 className="shrink-0 text-[9.5pt] font-bold text-[#e11d2e]">{t("receiptNotes")}</h2>
        <div className="min-w-0 flex-1 text-[8.6pt] font-medium leading-[1.65] text-[#222]">
          <p className="font-bold text-[#a90f1d]">{t("receiptDear")}</p>
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
           * browser rather than reasoned about (`scratchpad/bidi-marker.mjs`);
           * reasoning about it got it backwards first.
           *
           * The flex row is for the hanging indent: a note that wraps to a
           * second line aligns under its own words rather than under its
           * number.
           *
           * "…إذ لا يوجد ضمان بعد الفحص" is on every receipt, the shop's own
           * wording (2026-11-05). It replaces a "(لا يوجد ضمان)" drawn only
           * when no warranty was sold: this one is about claims once the
           * device has been checked and taken, which holds either way.
           */}
          <ol className="grid grid-cols-2 gap-x-[5mm]">
            {notes.map((note, index) => (
              <li key={note} className="flex gap-[1.6mm]">
                <span className="shrink-0 font-bold text-[#e11d2e]">{index + 1}-</span>
                <span className="min-w-0">{note}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/*
       * The foot: `mt-auto` holds it against the bottom edge whatever the
       * terms above come to, so the sheet closes on a line rather than
       * trailing off. The two diamonds are the mark's own plate at 1.6 mm —
       * the shape the warranty paper already uses to bullet its terms.
       */}
      <footer className="mt-auto flex items-center justify-center gap-[2.6mm] rounded-full bg-[#fdeff1] px-[4mm] py-[1.5mm]">
        <span className="size-[1.6mm] shrink-0 rotate-45 bg-[#e11d2e]" aria-hidden />
        <p className="text-[9pt] font-bold leading-none text-[#a90f1d]">{t("printThanksShort")}</p>
        <span className="size-[1.6mm] shrink-0 rotate-45 bg-[#e11d2e]" aria-hidden />
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
    <article className="print-paper mx-auto flex h-[147mm] w-[209mm] flex-col overflow-hidden bg-white px-[12mm] py-[8mm] text-[#111]">
      <div className="flex flex-1 flex-col gap-[5mm] rounded-[3mm] border-[0.5mm] border-[#111] px-[9mm] py-[6mm]">
        {/*
         * The same company lockup the receipt carries. The repair department's
         * own logo came off both A5 papers together: two sheets handed over at
         * one counter, on the same day, under two different identities is the
         * shop looking like two shops.
         */}
        <Letterhead markClass="size-[16mm]">
          <p className="flex items-center gap-[1.6mm] text-[9pt] font-bold text-[#e11d2e]">
            <ShieldCheck className="size-[4.4mm]" aria-hidden />
            {t("warrantyEyebrow")}
          </p>
          <h1 className="text-[25pt] font-bold leading-[1.15] text-[#111]">{t("warrantySheetTitle")}</h1>
          <p className="mt-[1mm] text-[8.5pt] font-medium text-[#555]">
            {t("counterTicketCode")} <span className="font-bold text-[#111]" data-numeric>{facts.code}</span>
          </p>
        </Letterhead>

        <dl className="space-y-[2.6mm]">
          {lines.map((line) => (
            <div key={line.label} className="grid grid-cols-[32mm_1fr] items-baseline gap-[3mm] border-b-[0.25mm] border-dotted border-[#888] pb-[1.2mm]">
              <dt className="text-[10pt] font-medium text-[#444]">{line.label}</dt>
              <dd className="text-[12.5pt] font-bold text-[#111]">{line.value}</dd>
            </div>
          ))}
        </dl>

        <dl className="grid grid-cols-3 overflow-hidden rounded-[2.4mm] border-[0.3mm] border-[#111] text-center">
          <div className="px-[2mm] py-[2.2mm]">
            <dt className="text-[8.5pt] font-medium text-[#444]">{t("warrantyFrom")}</dt>
            <dd className="text-[13pt] font-bold text-[#111]" data-numeric>{start}</dd>
          </div>
          <div className="border-x-[0.3mm] border-[#111] bg-[#111] px-[2mm] py-[2.2mm]">
            <dt className="text-[8.5pt] font-medium text-[#ddd]">{t("warrantyDuration")}</dt>
            <dd className="text-[13pt] font-bold text-white">{t("warrantyDurationValue", { count: days, days: String(days) })}</dd>
          </div>
          <div className="px-[2mm] py-[2.2mm]">
            <dt className="text-[8.5pt] font-medium text-[#444]">{t("warrantyTo")}</dt>
            <dd className="text-[13pt] font-bold text-[#111]" data-numeric>{warrantyEnd(start, days)}</dd>
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
                    className="flex items-center gap-[2.4mm] border-b-[0.25mm] border-dotted border-[#888] pb-[1.2mm] text-[11pt] font-bold leading-snug text-[#111]"
                  >
                    <span className="size-[1.7mm] shrink-0 rotate-45 bg-[#111]" aria-hidden />
                    {term}
                  </li>
                ))}
              </ul>
            </section>
            <p className="text-[8pt] font-bold text-[#111]">
              {t("printThanks", { phones: site.repairCardPhones.join(" - ") })}
            </p>
          </div>
          <p className="w-[46mm] shrink-0 border-t-[0.3mm] border-[#111] pt-[1mm] text-center text-[8pt] font-medium text-[#444]">
            {t("warrantySignature")}
          </p>
        </footer>
      </div>
    </article>
  );
}

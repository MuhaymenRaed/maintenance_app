"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CheckCircle2, Loader2, Printer, RefreshCw, Unplug } from "lucide-react";
import {
  Callout,
  ChoiceCards,
  Disclosure,
  EntityDialog,
  Field,
  Grid,
  NumberInput,
  Section,
  SelectField,
  Toggle,
} from "@/components/admin/form-kit";
import type { RepairPrintFacts } from "@/lib/data/repair-print-facts";
import { clearPrintLog, printLog, printLogText } from "@/lib/print/print-log";
import { narrowMediaOnly, suggestRoles, supportsA5, type PrinterInfo, type PrinterRole } from "@/lib/print/printer-match";
import {
  AGENT_START_MS,
  agentEverSeen,
  agentStatus,
  listPrinters,
  wakeAgent,
  waitForAgent,
} from "@/lib/print/agent-client";
import type { StationSettings } from "@/lib/print/station-settings";
import {
  closePrinterSetup,
  connectionProblem,
  openPrinterSetup,
  resumeAfterSetup,
  startPrint,
  type StationPaper,
} from "@/lib/print/station";
import { saveStationSettings, stationSettingsStore } from "@/lib/print/station-store";

/**
 * Which printer is which on this computer, and how the label is printed.
 *
 * Everything here is saved in this browser only — see
 * `lib/print/station-settings.ts` for why the mapping belongs to the machine
 * and not to the deployment. Opened from the desk's header, from the print
 * panel, and on its own the first time a run cannot tell the printers apart
 * (`mode: "confirm"`), in which case saving carries the run on.
 */

type Listing =
  | { state: "connecting" }
  | { state: "waking" }
  | { state: "ready"; printers: PrinterInfo[]; machine: string }
  | { state: "failed"; code: string };

export function PrinterSetupDialog({ mode }: { mode: "open" | "confirm" }) {
  const t = useTranslations("Admin");
  const locale = useLocale();
  const saved = useSyncExternalStore(stationSettingsStore.subscribe, stationSettingsStore.snapshot, stationSettingsStore.server);
  const [draft, setDraft] = useState<StationSettings>(saved);
  const [listing, setListing] = useState<Listing>({ state: "connecting" });
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        await agentStatus();
      } catch (error) {
        /*
         * The same bargain the print run makes: an agent that is not running
         * is started rather than reported. Here it matters more, because this
         * dialog is where somebody goes to fix printing — and until the agent
         * answers it can show no printers at all, so there is nothing on the
         * screen to fix anything with.
         */
        const code = connectionProblem(error).code;
        if (code !== "not_running") {
          if (alive) setListing({ state: "failed", code });
          return;
        }
        if (alive) setListing({ state: "waking" });
        wakeAgent();
        if (!(await waitForAgent(AGENT_START_MS))) {
          /*
           * ⚠️ A PC the installer has never run on is the likeliest reason
           * this dialog is empty, and it is the one reason the reader can
           * act on — see `agentEverSeen`. Reported as "not running" it
           * sends somebody to a .cmd file that would have worked all along,
           * had it ever been double-clicked.
           */
          if (alive) setListing({ state: "failed", code: agentEverSeen() ? code : "not_installed" });
          return;
        }
      }
      try {
        const { machine } = await agentStatus();
        const printers = await listPrinters({ fresh: true });
        if (alive) setListing({ state: "ready", printers, machine });
      } catch (error) {
        if (alive) setListing({ state: "failed", code: connectionProblem(error).code });
      }
    })();
    return () => {
      alive = false;
    };
  }, [attempt]);

  /*
   * ⚠️ `force`, because this is a press. The browser wants a user activation
   * before it will offer to open a program, and "try again" is the one moment
   * the reader has plainly asked for it.
   */
  const reconnect = () => {
    wakeAgent({ force: true });
    setListing({ state: "connecting" });
    setAttempt((value) => value + 1);
  };

  /* Connecting and starting are one state to everything but the sentence. */
  const busy = listing.state === "connecting" || listing.state === "waking";
  const printers = listing.state === "ready" ? listing.printers : [];
  const guess = suggestRoles(printers);
  const set = (change: (current: StationSettings) => StationSettings) => setDraft((current) => change(current));
  const label = draft.label;

  function options(role: PrinterRole) {
    const suggestion = guess[role];
    const automatic = suggestion
      ? t(suggestion.confident ? "psSetupAuto" : "psSetupAutoUnsure", { name: suggestion.name })
      : t("psSetupAutoNone");
    const chosen = draft.printers[role];
    const list = printers.map((printer) => ({
      value: printer.name,
      label: printer.name,
      hint:
        [
          printer.connected === false ? t("psSetupUnplugged") : null,
          printer.driver,
          printer.connection,
        ]
          .filter(Boolean)
          .join(" · ") || undefined,
    }));
    if (chosen && !printers.some((printer) => printer.name === chosen)) {
      list.push({ value: chosen, label: chosen, hint: t("psSetupMissing") });
    }
    return [{ value: "", label: automatic }, ...list];
  }

  /** The queue a role would print to with the draft as it stands. */
  const target = (role: PrinterRole) => draft.printers[role] ?? guess[role]?.name ?? null;
  const a5Printer = printers.find((printer) => printer.name === target("a5"));
  const labelPrinter = printers.find((printer) => printer.name === target("label"));

  function save() {
    // An unconfirmed guess becomes the saved choice when the person saves the
    // dialog with it showing — that is what confirming it means.
    const confirmed: StationSettings = {
      ...draft,
      printers: { a5: target("a5"), label: target("label") },
    };
    saveStationSettings(confirmed);
    if (mode === "confirm") resumeAfterSetup();
    else closePrinterSetup();
  }

  /** `at` is stamped by the press, for the reason the desk's own print is. */
  function test(paper: StationPaper, at: number, from: Document) {
    saveStationSettings({ ...draft, printers: { a5: target("a5"), label: target("label") } });
    const facts: RepairPrintFacts = {
      code: "TEST-0001",
      customerName: t("psTestCustomer"),
      device: "Samsung Galaxy A17",
      fault: t("psTestFault"),
      amount: 25_000,
      warranty: 0,
      collected: 25_000,
      remaining: 0,
      terms: "cash",
      receivedAt: new Date(at).toISOString(),
      hasWarranty: false,
      warrantyDays: null,
      warrantyStart: null,
    };
    const started = startPrint({
      ticketId: null,
      facts,
      printedAt: at,
      papers: [{ paper, copies: 1 }],
      locale,
      test: true,
      from,
    });
    setNotice(started === "busy" ? t("psBusy") : null);
    if (started === "started") closePrinterSetup();
  }

  return (
    <EntityDialog
      // A viewer: nothing typed here can be lost by closing it.
      confirmClose={false}
      title={t("psSetupTitle")}
      subtitle={t("psSetupSubtitle")}
      closeLabel={t("psClose")}
      onClose={closePrinterSetup}
      width={680}
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <button
            type="button"
            onClick={closePrinterSetup}
            className="rounded-control px-3 py-2 text-[0.8rem] font-bold text-muted hover:text-ink"
          >
            {t("psCancel")}
          </button>
          <button
            type="button"
            onClick={save}
            className="press rounded-control bg-brand px-4 py-2 text-[0.82rem] font-extrabold text-white hover:bg-brand-hover"
          >
            {mode === "confirm" ? t("psSetupSaveContinue") : t("psSetupSave")}
          </button>
        </div>
      }
    >
      {mode === "confirm" && (
        <Callout title={t("psProblem_setup_needed_title")}>{t("psProblem_setup_needed")}</Callout>
      )}
      {notice && <Callout tone="warning">{notice}</Callout>}

      <Section
        title={t("psSetupConnection")}
        hint={t("psSetupConnectionHint")}
        aside={
          <button
            type="button"
            onClick={reconnect}
            disabled={busy}
            className="press inline-flex items-center gap-1.5 rounded-control border border-line px-3 py-1.5 text-[0.72rem] font-extrabold text-ink hover:border-brand hover:text-brand disabled:opacity-50"
          >
            <RefreshCw className="size-3.5" aria-hidden />
            {listing.state === "failed" ? t("psSetupConnect") : t("psSetupRefresh")}
          </button>
        }
      >
        {busy && (
          <p className="flex items-center gap-2 text-[0.78rem] font-bold text-muted">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {listing.state === "waking" ? t("psSetupStarting") : t("psSetupConnecting")}
          </p>
        )}
        {listing.state === "ready" && (
          <div className="space-y-2">
            <p className="flex items-center gap-1.5 text-[0.78rem] font-bold text-success">
              <CheckCircle2 className="size-4" aria-hidden />
              {t("psSetupConnected", { count: String(listing.printers.length), machine: listing.machine })}
            </p>
            {/* What Windows has, as it stands — so "it could not find my
                printer" is answered on screen: here is every queue, and which
                are plugged in. */}
            <ul className="space-y-1 rounded-control border border-line bg-canvas px-3 py-2">
              {listing.printers.map((printer) => (
                <li key={printer.name} className="flex items-center gap-2 text-[0.72rem] font-bold" dir="auto">
                  {printer.connected === false ? (
                    <Unplug className="size-3.5 shrink-0 text-warning" aria-hidden />
                  ) : (
                    <Printer className="size-3.5 shrink-0 text-muted" aria-hidden />
                  )}
                  {/* The name wins the room; a port like OneNote's 120-character one
                      is truncated rather than pushing the name out of its row. */}
                  <span className="max-w-[65%] shrink-0 truncate text-ink">{printer.name}</span>
                  <span className="ms-auto min-w-0 truncate text-end text-[0.66rem] font-medium text-muted" dir={printer.connected == null ? "ltr" : undefined}>
                    {printer.connected === false
                      ? t("psSetupUnplugged")
                      : printer.connected
                        ? t("psSetupPlugged")
                        : printer.connection}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {listing.state === "failed" && (
          <Callout tone="warning" title={t(`psProblem_${listing.code}_title` as "psProblem_not_running_title")}>
            {t(`psProblem_${listing.code}` as "psProblem_not_running")}
          </Callout>
        )}
      </Section>

      <Section title={t("psSetupPrinters")} hint={t("psSetupPrintersHint")}>
        <Grid>
          <div className="space-y-2">
            <Field label={t("psSetupA5")}>
              <SelectField
                value={draft.printers.a5 ?? ""}
                onChange={(value) => set((current) => ({ ...current, printers: { ...current.printers, a5: value || null } }))}
                options={options("a5")}
                ariaLabel={t("psSetupA5")}
              />
            </Field>
            {/*
              The warning has always been able to say a printer lists no A5.
              It now says what to do about it, because the thing to do exists.
            */}
            {a5Printer && supportsA5(a5Printer) === false && draft.a5.page === "a5" && (
              <p className="text-[0.68rem] font-bold text-warning">{t("psSetupNoA5")}</p>
            )}
            <TestButton disabled={!target("a5") || listing.state !== "ready"} onTest={(at, from) => test("receipt", at, from)} />
          </div>
          <div className="space-y-2">
            <Field label={t("psSetupLabel")}>
              <SelectField
                value={draft.printers.label ?? ""}
                onChange={(value) => set((current) => ({ ...current, printers: { ...current.printers, label: value || null } }))}
                options={options("label")}
                ariaLabel={t("psSetupLabel")}
              />
            </Field>
            {labelPrinter && narrowMediaOnly(labelPrinter) && label.mode === "tspl" && (
              <p className="text-[0.68rem] font-medium leading-relaxed text-muted">{t("psSetupReceiptDriver")}</p>
            )}
            <TestButton disabled={!target("label") || listing.state !== "ready"} onTest={(at, from) => test("label", at, from)} />
          </div>
        </Grid>
      </Section>

      <Section title={t("psSetupLabelSection")}>
        <Field label={t("psSetupMode")}>
          <ChoiceCards
            value={label.mode}
            onChange={(mode) => set((current) => ({ ...current, label: { ...current.label, mode } }))}
            options={[
              { value: "tspl", label: t("psSetupModeTspl"), hint: t("psSetupModeTsplHint") },
              { value: "driver", label: t("psSetupModeDriver"), hint: t("psSetupModeDriverHint") },
            ]}
          />
        </Field>
        <Field label={t("psSetupMedia")}>
          <ChoiceCards
            value={label.media}
            onChange={(media) => set((current) => ({ ...current, label: { ...current.label, media } }))}
            options={[
              { value: "gap", label: t("psSetupMediaGap"), hint: t("psSetupMediaGapHint") },
              { value: "continuous", label: t("psSetupMediaContinuous"), hint: t("psSetupMediaContinuousHint") },
            ]}
          />
        </Field>
        <Grid cols={3}>
          <Field label={t("psSetupWidth")}>
            <NumberInput value={label.widthMm} min={10} max={110} step={0.5} onChange={(widthMm) => set((current) => ({ ...current, label: { ...current.label, widthMm } }))} />
          </Field>
          {label.media === "gap" && (
            <Field label={t("psSetupHeight")}>
              <NumberInput value={label.heightMm} min={10} max={400} step={0.5} onChange={(heightMm) => set((current) => ({ ...current, label: { ...current.label, heightMm } }))} />
            </Field>
          )}
          {label.media === "gap" && label.mode === "tspl" && (
            <Field label={t("psSetupGap")}>
              <NumberInput value={label.gapMm} min={0} max={20} step={0.5} onChange={(gapMm) => set((current) => ({ ...current, label: { ...current.label, gapMm } }))} />
            </Field>
          )}
          {label.mode === "tspl" && (
            <>
              <Field label={t("psSetupDensity")}>
                <NumberInput value={label.density} min={0} max={15} onChange={(density) => set((current) => ({ ...current, label: { ...current.label, density } }))} />
              </Field>
              <Field label={t("psSetupSpeed")}>
                <NumberInput value={label.speed} min={1} max={6} onChange={(speed) => set((current) => ({ ...current, label: { ...current.label, speed } }))} />
              </Field>
            </>
          )}
        </Grid>
        <Disclosure title={t("psSetupAdvanced")} hint={t("psSetupAdvancedHint")}>
          <div className="space-y-3.5">
            <Grid cols={3}>
              <Field label={t("psSetupShiftX")}>
                <NumberInput value={label.shiftX} min={-200} max={200} onChange={(shiftX) => set((current) => ({ ...current, label: { ...current.label, shiftX } }))} />
              </Field>
              <Field label={t("psSetupShiftY")}>
                <NumberInput value={label.shiftY} min={-200} max={200} onChange={(shiftY) => set((current) => ({ ...current, label: { ...current.label, shiftY } }))} />
              </Field>
              <Field label={t("psSetupThreshold")}>
                <NumberInput value={label.threshold} min={1} max={254} onChange={(threshold) => set((current) => ({ ...current, label: { ...current.label, threshold } }))} />
              </Field>
              {label.mode === "tspl" && (
                <Field label={t("psSetupHead")}>
                  <NumberInput value={label.headDots} min={128} max={1000} onChange={(headDots) => set((current) => ({ ...current, label: { ...current.label, headDots } }))} />
                </Field>
              )}
            </Grid>
            {label.mode === "tspl" && (
              <div className="flex flex-wrap gap-2">
                <Toggle label={t("psSetupRotate")} on={label.rotate} onChange={(rotate) => set((current) => ({ ...current, label: { ...current.label, rotate } }))} />
                <Toggle label={t("psSetupInvert")} on={label.invert} onChange={(invert) => set((current) => ({ ...current, label: { ...current.label, invert } }))} />
              </div>
            )}
          </div>
        </Disclosure>
      </Section>

      <Section title={t("psSetupA5Section")} hint={t("psSetupFitHint")}>
        {/*
          ⚠️ `ChoiceCards` rather than a toggle, because the choice changes what
          comes out of the machine rather than tuning it — the rule this back
          office already follows for an offer's kind and a product's.
        */}
        <ChoiceCards
          value={draft.a5.page}
          onChange={(sheetPage) => set((current) => ({ ...current, a5: { ...current.a5, page: sheetPage } }))}
          options={[
            { value: "a5", label: t("psSetupPageA5"), hint: t("psSetupPageA5Hint") },
            { value: "a4", label: t("psSetupPageA4"), hint: t("psSetupPageA4Hint") },
          ]}
        />
        <Toggle
          label={t("psSetupFit")}
          on={draft.a5.fit === "page"}
          onChange={(on) => set((current) => ({ ...current, a5: { ...current.a5, fit: on ? "page" : "actual" } }))}
        />
      </Section>

      <Section title={t("psSetupBehaviour")}>
        <ChoiceCards
          value={draft.method}
          onChange={(method) => set((current) => ({ ...current, method }))}
          options={[
            { value: "agent", label: t("psSetupMethodAgent"), hint: t("psSetupMethodAgentHint") },
            { value: "dialog", label: t("psSetupMethodDialog"), hint: t("psSetupMethodDialogHint") },
          ]}
        />
        <Toggle
          label={t("psSetupCheckStatus")}
          on={draft.checkStatus}
          onChange={(checkStatus) => set((current) => ({ ...current, checkStatus }))}
        />
      </Section>

      <PrintLogSection />
    </EntityDialog>
  );
}

function TestButton({ disabled, onTest }: { disabled: boolean; onTest: (at: number, from: Document) => void }) {
  const t = useTranslations("Admin");
  return (
    <button
      type="button"
      onClick={(event) => onTest(Date.now(), event.currentTarget.ownerDocument)}
      disabled={disabled}
      className="press inline-flex items-center gap-1.5 rounded-control border border-line px-3 py-1.5 text-[0.72rem] font-extrabold text-ink hover:border-brand hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Printer className="size-3.5" aria-hidden />
      {t("psSetupTest")}
    </button>
  );
}

function PrintLogSection() {
  const t = useTranslations("Admin");
  const entries = useSyncExternalStore(printLog.subscribe, printLog.snapshot, printLog.server);
  const [copied, setCopied] = useState(false);
  const recent = entries.slice(-30).reverse();

  return (
    <Disclosure title={t("psSetupLog")} hint={t("psSetupLogHint")}>
      <div className="space-y-2">
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!entries.length}
            onClick={() => {
              void navigator.clipboard?.writeText(printLogText(entries)).then(() => setCopied(true));
            }}
            className="press rounded-control border border-line px-3 py-1.5 text-[0.72rem] font-extrabold text-ink hover:border-brand hover:text-brand disabled:opacity-50"
          >
            {copied ? t("psSetupCopied") : t("psSetupCopyLog")}
          </button>
          <button
            type="button"
            disabled={!entries.length}
            onClick={clearPrintLog}
            className="rounded-control px-3 py-1.5 text-[0.72rem] font-bold text-muted hover:text-ink disabled:opacity-50"
          >
            {t("psSetupClearLog")}
          </button>
        </div>
        {recent.length === 0 ? (
          <p className="text-[0.72rem] font-medium text-muted">{t("psSetupLogEmpty")}</p>
        ) : (
          <ol dir="ltr" className="max-h-56 space-y-1 overflow-y-auto rounded-control border border-line bg-canvas p-2.5 font-mono text-[0.66rem] leading-relaxed text-ink">
            {recent.map((entry) => (
              <li key={`${entry.at}-${entry.message}`} className={entry.level === "error" ? "text-brand" : entry.level === "warn" ? "text-warning" : undefined}>
                <span className="text-muted">{new Date(entry.at).toLocaleTimeString("en-GB")}</span>{" "}
                {entry.ticket && <span className="font-bold">{entry.ticket} </span>}
                {entry.printer && <span className="text-muted">→ {entry.printer} </span>}
                {entry.message}
              </li>
            ))}
          </ol>
        )}
      </div>
    </Disclosure>
  );
}

/** The desk header's way in. Absent for anybody who cannot print. */
export function PrinterSetupButton() {
  const t = useTranslations("Admin");
  return (
    <button
      type="button"
      onClick={(event) => openPrinterSetup(event.currentTarget.ownerDocument)}
      className="press inline-flex items-center gap-2 rounded-control border border-line px-3.5 py-2 text-[0.78rem] font-extrabold text-ink transition-colors hover:border-brand hover:text-brand"
    >
      <Printer className="size-4" aria-hidden />
      {t("psSetupButton")}
    </button>
  );
}

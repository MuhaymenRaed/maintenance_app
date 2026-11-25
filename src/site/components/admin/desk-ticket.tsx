"use client";

import { useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import {
  CheckCircle2,
  ChevronDown,
  Cpu,
  FilePlus2,
  ListChecks,
  Loader2,
  Printer,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { EntityDialog, Field, FieldGroup, Grid, input, MoneyInput, NumberInput, SelectField } from "@/components/admin/form-kit";
import { RepairWarrantyDialog, TICKET_RUN, type RepairPrintFacts } from "@/components/admin/repair-print";
import { isPrinting, printStation, startPrint } from "@/lib/print/station";
import type { DeskHolder } from "@/components/admin/repairs-board";
import { FaultPicker } from "@/components/admin/fault-picker";
import { DeviceFields } from "@/components/admin/repair-ticket/device-fields";
import { OwedLine, PriceRows, TicketCard } from "@/components/admin/repair-ticket/ticket-parts";
import { createDeskTicket } from "@/lib/actions/repair-desk";
import type { StockModel } from "@/lib/data/device-catalogue";
import type { RecentDevice } from "@/lib/data/recent-devices";
import { faultText, isNewFault, splitFaults, type RecentFault } from "@/lib/data/repair-faults";
import { repairMoney, repairTotal, type PaymentTerms, type RepairService } from "@/lib/data/repair-desk";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * A ticket opened at the counter — «إضافة تذكرة», the first tab of the
 * rebuilt maintenance section (the shop, 2026-11-24). A manager's and an
 * assistant's, never a technician's.
 *
 * Five numbered cards in the order the counter fills them — الزبون, الجهاز,
 * الأعطال, المال, التسليم — one concern each. The money is two stacked rows
 * (مبلغ الصيانة, then سعر الشراء) with the profit under them; what is left to
 * pay and the profit are worked out, never typed.
 *
 * After saving, the window turns into its own receipt: the code, the papers
 * to print, «عرض كل التذاكر» back to the list, and «تذكرة جديدة» for the next
 * customer at the counter.
 *
 * ⚠️ The customer sees the repair and the warranty as one amount. The purchase
 * price and what has been paid go to `repair_ticket_finance`, which a customer
 * cannot read.
 */

type Branch = { id: string; name: string };
type Brand = { code: string; name: string };
type Issue = { code: string; name: string };

export type NewTicketProps = {
  /** The bench's default holder — the window opens on it when the reader may hand to it. */
  defaultHolderId?: string | null;
  service: RepairService;
  branches: Branch[];
  brands: Brand[];
  /** The shop's own models per make, floated above the curated list. */
  models: Record<string, StockModel[]>;
  /** The bench's latest devices, newest first — what the picker opens on. */
  recentDevices?: RecentDevice[];
  /** The bench's faults by their last ticket — what the fault picker opens on. */
  recentFaults?: RecentFault[];
  issues: Issue[];
  /** Who this reader may hand a ticket to. */
  holders: DeskHolder[];
  viewerId: string;
  /** Today's Baghdad day, from the server. */
  today: string;
  financeAvailable: boolean;
  warrantyAvailable: boolean;
  /** «عرض كل التذاكر» — the maintenance section's own ticket list. */
  onShowTickets?: () => void;
};

/**
 * Every "add a ticket" window open now. Each press opens another — two
 * customers at the counter are two tickets filled side by side — and each
 * keeps its own fields until it is saved or closed. See `app-window.tsx`.
 */
export function useNewTicketWindows(props: NewTicketProps): { open: () => void; count: number; windows: ReactNode } {
  const [windows, setWindows] = useState<number[]>([]);
  const [next, setNext] = useState(1);
  return {
    open: () => {
      setWindows((current) => [...current, next]);
      setNext((n) => n + 1);
    },
    count: windows.length,
    windows: windows.map((number) => (
      <DeskTicketDialog
        key={number}
        number={number}
        {...props}
        onClose={() => setWindows((current) => current.filter((n) => n !== number))}
      />
    )),
  };
}

/** The bare button — for a page that is not the maintenance section's shell. */
export function DeskTicketButton(props: NewTicketProps) {
  const t = useTranslations("Admin");
  const { open, count, windows } = useNewTicketWindows(props);
  const Icon = props.service === "software" ? Cpu : Wrench;
  return (
    <>
      <button
        type="button"
        onClick={open}
        className="press inline-flex shrink-0 items-center gap-2 rounded-control bg-brand px-4 py-2.5 text-[0.8rem] font-extrabold text-white transition-colors hover:bg-brand-hover"
      >
        <Icon className="size-4" aria-hidden />
        {t("deskNewTicket")}
        {count > 0 && (
          <span className="rounded-full bg-white/25 px-1.5 text-[0.7rem]" data-numeric>
            {count}
          </span>
        )}
      </button>
      {windows}
    </>
  );
}

function DeskTicketDialog({
  number,
  service,
  branches,
  brands,
  models,
  recentDevices = [],
  recentFaults = [],
  issues,
  holders,
  viewerId,
  defaultHolderId = null,
  today,
  financeAvailable,
  warrantyAvailable,
  onShowTickets,
  onClose,
}: NewTicketProps & {
  /** Which "new ticket" window this is — the dock tells several apart by it. */
  number: number;
  onClose: () => void;
}) {
  const t = useTranslations("Admin");
  const locale = useLocale();
  const router = useRouter();
  /*
   * The bench's default account until the counter hands it to somebody else
   * (the shop, 2026-11-18) — only when this reader may hand to it.
   */
  const firstHolder =
    defaultHolderId && holders.some((holder) => holder.id === defaultHolderId) ? defaultHolderId : viewerId;
  const blank = {
    name: "",
    phone: "",
    phone2: "",
    branchId: branches.length === 1 ? branches[0].id : "",
    brandCode: "",
    model: "",
    faults: [] as string[],
    notes: "",
    terms: "cash" as PaymentTerms,
    price: null as number | null,
    warranty: null as number | null,
    warrantyDays: null as number | null,
    cost: null as number | null,
    collected: null as number | null,
    holderId: firstHolder,
  };
  const [form, setForm] = useState(blank);
  const set = <K extends keyof typeof blank>(key: K, value: (typeof blank)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{
    id: string;
    code: string;
    at: string;
    financeSaved: boolean;
    warrantySaved: boolean;
    customSaved: boolean;
    listSaved: boolean;
    /** The form as it was saved — what the papers print. */
    saved: typeof blank;
  } | null>(null);
  const [warrantyOpen, setWarrantyOpen] = useState(false);
  /** The warranty's fields, folded until asked for (2026-11-17). */
  const [warrantyShown, setWarrantyShown] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);
  // Read only for the button's spinner: the run lives in the print station,
  // so closing this window mid-print cannot stop the papers.
  const station = useSyncExternalStore(printStation.subscribe, printStation.snapshot, printStation.server);
  const printing = !!station.run && isPrinting();
  const [pending, start] = useTransition();

  const source = done?.saved ?? form;
  const total = repairTotal(source.price, source.warranty);
  const money = repairMoney({
    price: total,
    warranty: source.warranty,
    cost: source.cost,
    collected: source.collected,
    terms: source.terms,
    completed: false,
  });
  const rankLabel = (rank: DeskHolder["rank"]) => t(`rank_${rank}`);

  function submit() {
    setError(null);
    // ⚠️ Required: a ticket opened without its fee is a ticket the receipt,
    // the till and the profit report all read as free.
    if (form.price == null || form.price <= 0) {
      setError("price_required");
      return;
    }
    const picked = splitFaults(form.faults);
    if (!picked.codes.length && !picked.names.length) {
      setError("issue_required");
      return;
    }
    const sent = form;
    start(async () => {
      const result = await createDeskTicket({
        service,
        customerName: sent.name,
        customerPhone: sent.phone,
        customerPhone2: sent.phone2.trim() || null,
        branchId: sent.branchId,
        deviceBrandCode: sent.brandCode || null,
        deviceModel: sent.model,
        issueCodes: picked.codes,
        newFaults: picked.names,
        notes: sent.notes,
        price: sent.price,
        warranty: sent.warranty,
        warrantyDays: sent.warrantyDays,
        costPrice: sent.cost,
        collected: sent.terms === "cash" ? null : sent.collected,
        paymentTerms: sent.terms,
        holderId: sent.holderId,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone({
        id: result.id,
        code: result.code,
        at: result.at,
        financeSaved: result.financeSaved,
        warrantySaved: result.warrantySaved,
        customSaved: result.customSaved,
        // A queued ticket in the desk app answers without it: nothing to say.
        listSaved: result.listSaved ?? true,
        saved: sent,
      });
      // The list behind is a server read; refreshing it shows the ticket.
      router.refresh();
    });
  }

  /** «تذكرة جديدة» — the same window, emptied for the next customer. */
  function another() {
    setDone(null);
    setError(null);
    setWarrantyShown(false);
    setForm({ ...blank, branchId: form.branchId, holderId: form.holderId });
  }

  const printFacts: RepairPrintFacts | null = done && {
    code: done.code,
    customerName: done.saved.name.trim(),
    device: done.saved.model.trim(),
    fault: done.saved.faults
      .flatMap((value) => {
        const match = issues.find((issue) => issue.code === value);
        return match ? [match.name] : isNewFault(value) ? [faultText(value)] : [];
      })
      .join("، "),
    amount: money.price,
    warranty: money.warranty,
    collected: money.collected,
    remaining: money.remaining,
    terms: done.saved.terms,
    receivedAt: done.at,
    hasWarranty: (done.saved.warranty ?? 0) > 0 || done.saved.warrantyDays != null,
    warrantyDays: done.saved.warrantyDays,
    warrantyStart: null,
  };

  function printAll(from: Document) {
    if (!printFacts || !done) return;
    // The date on the paper is the press's; the station reads the ticket it
    // just saved before printing it.
    const started = startPrint({
      ticketId: done.id,
      facts: printFacts,
      printedAt: Date.now(),
      papers: TICKET_RUN,
      locale,
      from,
    });
    setPrintBusy(started === "busy");
  }

  const text = cn(input, "font-bold");
  const benchName = service === "software" ? t("deskNewProgramming") : t("deskNewRepair");

  return (
    <EntityDialog
      windowId={`desk-new-${service}-${number}`}
      // A window of its own on the desktop — see the ticket window's note.
      detach
      title={done ? `${benchName} · ${done.code}` : `${benchName} #${number}`}
      subtitle={[source.name.trim(), source.model.trim()].filter(Boolean).join(" · ") || undefined}
      closeLabel={t("close")}
      onClose={onClose}
      // Saved, there is nothing left in it to lose.
      confirmClose={!done}
      width={760}
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          {done ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-control px-3 py-2 text-[0.8rem] font-bold text-muted hover:text-ink"
            >
              {t("close")}
            </button>
          ) : (
            <>
              <p className="me-auto text-[0.74rem] font-bold text-muted">
                {t("newTicketTotal")}{" "}
                <span className="text-[0.95rem] font-black text-brand" data-numeric>
                  {formatPrice(total ?? 0)}
                </span>{" "}
                {t("currency")}
              </p>
              <button type="button" onClick={onClose} className="rounded-control px-3 py-2 text-[0.8rem] font-bold text-muted hover:text-ink">
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={pending}
                className="press inline-flex items-center gap-2 rounded-control bg-brand px-5 py-2.5 text-[0.86rem] font-black text-white transition-colors hover:bg-brand-hover disabled:opacity-60"
              >
                {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FilePlus2 className="size-4" aria-hidden />}
                {t("counterBook")}
              </button>
            </>
          )}
        </div>
      }
    >
      {done ? (
        <div className="space-y-4">
          <div className="flex flex-col items-center gap-2 rounded-panel border border-success/35 bg-success/8 px-5 py-7 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-success text-white shadow-card">
              <CheckCircle2 className="size-8" aria-hidden />
            </span>
            <p className="text-[1.15rem] font-black text-ink">{t("newTicketDone")}</p>
            <p className="text-[0.82rem] font-bold text-muted">
              {t("counterTicketCode")}{" "}
              <span className="text-[1.05rem] font-black text-success" data-numeric>
                {done.code}
              </span>
            </p>
            {!done.financeSaved && financeAvailable && (
              <p className="text-[0.76rem] font-semibold text-warning">{t("deskFinanceNotSaved")}</p>
            )}
            {!done.warrantySaved && <p className="text-[0.76rem] font-semibold text-warning">{t("warrantyNotSaved")}</p>}
            {!done.customSaved ? (
              <p className="text-[0.76rem] font-semibold text-warning">{t("deskFaultsNotSaved")}</p>
            ) : (
              !done.listSaved && <p className="text-[0.76rem] font-semibold text-warning">{t("deskNewFaultsAsText")}</p>
            )}
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2">
            <button
              type="button"
              onClick={(event) => printAll(event.currentTarget.ownerDocument)}
              disabled={printing}
              aria-busy={printing}
              className="press flex items-center gap-3 rounded-panel bg-brand px-4 py-3.5 text-start text-white transition-colors hover:bg-brand-hover disabled:cursor-wait disabled:opacity-60 sm:col-span-2"
            >
              {printing ? <Loader2 className="size-6 shrink-0 animate-spin" aria-hidden /> : <Printer className="size-6 shrink-0" aria-hidden />}
              <span>
                <span className="block text-[0.95rem] font-black">{t("newTicketPrintAll")}</span>
                <span className="block text-[0.72rem] font-semibold text-white/80">{t("newTicketPrintAllHint")}</span>
              </span>
            </button>
            <DoneAction icon={ShieldCheck} tone="info" title={t("printWarrantyPaper")} onPress={() => setWarrantyOpen(true)} />
            {onShowTickets && (
              <DoneAction
                icon={ListChecks}
                tone="ink"
                title={t("newTicketShowAll")}
                onPress={() => {
                  onClose();
                  onShowTickets();
                }}
              />
            )}
            <DoneAction icon={FilePlus2} tone="success" title={t("newTicketAnother")} onPress={another} />
          </div>
          {printBusy && (
            <p role="alert" className="text-[0.74rem] font-bold text-warning">
              {t("psBusy")}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {error && (
            <p role="alert" className="rounded-control border border-brand/30 bg-brand/8 px-3 py-2 text-[0.78rem] font-bold text-brand">
              {t.has(error) ? t(error as "counterFailed") : t("counterFailed")}
            </p>
          )}

          {/* 1 — who */}
          <TicketCard number={1} title={t("counterCustomer")} hint={t("newTicketCustomerHint")}>
            <Grid cols={3}>
              <Field label={t("counterName")}>
                <input value={form.name} onChange={(e) => set("name", e.target.value)} className={text} />
              </Field>
              <Field label={t("counterPhone")}>
                <input
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  inputMode="tel"
                  dir="ltr"
                  placeholder="07XXXXXXXXX"
                  className={text}
                  data-numeric
                />
              </Field>
              <Field label={t("counterPhone2")}>
                <input
                  value={form.phone2}
                  onChange={(e) => set("phone2", e.target.value)}
                  inputMode="tel"
                  dir="ltr"
                  placeholder="07XXXXXXXXX"
                  className={text}
                  data-numeric
                />
              </Field>
            </Grid>
          </TicketCard>

          {/* 2 — the device */}
          <TicketCard number={2} title={t("counterDevice")} hint={t("newTicketDeviceHint")}>
            <DeviceFields
              brandCode={form.brandCode}
              model={form.model}
              brands={brands}
              stock={models}
              recent={recentDevices}
              onChange={(next) => setForm((current) => ({ ...current, brandCode: next.brandCode, model: next.model }))}
            />
            {branches.length > 1 && (
              <Field label={t("counterBranch")}>
                <SelectField
                  value={form.branchId}
                  onChange={(value) => set("branchId", value)}
                  options={branches.map((b) => ({ value: b.id, label: b.name }))}
                  placeholder={t("counterBranchPick")}
                />
              </Field>
            )}
          </TicketCard>

          {/* 3 — what is wrong */}
          <TicketCard number={3} title={t("newTicketFaults")} hint={t("deskFaultHint")}>
            <FieldGroup label={t("deskFault")} required>
              <FaultPicker
                values={form.faults}
                onChange={(next) => {
                  set("faults", next);
                  if (error === "issue_required" && next.length) setError(null);
                }}
                issues={issues}
                recent={recentFaults}
                manage={service}
              />
              {error === "issue_required" && (
                <span role="alert" className="mt-1 block text-[0.72rem] font-bold text-brand">
                  {t("issue_required")}
                </span>
              )}
            </FieldGroup>
            <Field label={t("deskNotes")}>
              <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} className={cn(input, "resize-y")} />
            </Field>
          </TicketCard>

          {/* 4 — the money */}
          <TicketCard number={4} title={t("financeTitle")} hint={t("newTicketMoneyHint")} tone="success">
            <PriceRows
              base={form.price}
              cost={form.cost}
              warranty={form.warranty ?? 0}
              showCost={financeAvailable}
              missing={error === "price_required"}
              onBase={(next) => {
                set("price", next);
                if (error === "price_required" && next != null && next > 0) setError(null);
              }}
              onCost={(next) => set("cost", next)}
            />

            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("financeTerms")}>
              {(["cash", "deferred"] as PaymentTerms[]).map((option) => {
                const on = form.terms === option;
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() =>
                      // Cash is paid in full, so the figure goes with the switch.
                      setForm((current) => ({ ...current, terms: option, collected: option === "cash" ? null : current.collected }))
                    }
                    className={cn(
                      "press flex flex-col items-start gap-0.5 rounded-control border-2 px-3.5 py-2.5 text-start transition-colors",
                      on
                        ? option === "deferred"
                          ? "border-warning bg-warning/10"
                          : "border-success bg-success/10"
                        : "border-line bg-surface hover:border-ink/30",
                    )}
                  >
                    <span className={cn("text-[0.95rem] font-black", on ? (option === "deferred" ? "text-warning" : "text-success") : "text-ink")}>
                      {t(option === "cash" ? "termsCash" : "termsDeferred")}
                    </span>
                    <span className="text-[0.68rem] font-semibold leading-snug text-muted">
                      {t(option === "cash" ? "termsCashHint" : "termsDeferredHint")}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* ⚠️ Only once «آجل» is chosen — the shop, 2026-11-17. */}
            {form.terms === "deferred" && (
              <div className="space-y-2.5 rounded-card border border-warning/35 bg-warning/5 p-3">
                <Field label={t("financeDeposit")}>
                  <MoneyInput value={form.collected} clearable onChange={(next) => set("collected", next)} min={0} />
                </Field>
                <OwedLine remaining={money.remaining} />
              </div>
            )}

            {/* The warranty — its own decision with its own price, folded with
                what it holds on the fold. It joins the repair in what the
                customer pays and is never profit. */}
            <div className="rounded-card border-2 border-info/40 bg-info/6">
              <button
                type="button"
                onClick={() => setWarrantyShown((value) => !value)}
                aria-expanded={warrantyShown}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-start"
              >
                <ShieldCheck className="size-4 shrink-0 text-info" aria-hidden />
                <span className="flex-1 text-[0.82rem] font-black text-ink">{t("warrantyTitle")}</span>
                <span className="text-[0.72rem] font-extrabold text-info">
                  {(form.warranty ?? 0) > 0
                    ? `${formatPrice(form.warranty!)} ${t("currency")}${form.warrantyDays ? ` · ${t("warrantyDaysShort", { days: String(form.warrantyDays) })}` : ""}`
                    : t("warrantyNone")}
                </span>
                <ChevronDown
                  className={cn("size-4 shrink-0 text-muted transition-transform duration-150", warrantyShown && "rotate-180")}
                  aria-hidden
                />
              </button>
              {warrantyShown && (
                <div className="space-y-2 border-t border-info/25 px-3 pt-2.5 pb-3">
                  {warrantyAvailable ? (
                    <>
                      <Grid>
                        <Field label={t("warrantyPrice")}>
                          <MoneyInput value={form.warranty} clearable onChange={(next) => set("warranty", next)} min={0} />
                        </Field>
                        <Field label={t("warrantyDurationField")}>
                          <NumberInput
                            value={form.warrantyDays}
                            clearable
                            onChange={(next) => set("warrantyDays", next)}
                            min={1}
                            max={3650}
                          />
                        </Field>
                      </Grid>
                      <p className="text-[0.74rem] font-medium leading-relaxed text-muted">{t("warrantyHint")}</p>
                      {form.price == null && (form.warranty ?? 0) > 0 && (
                        <p className="text-[0.72rem] font-bold text-warning">{t("warrantyNeedsPrice")}</p>
                      )}
                    </>
                  ) : (
                    <p className="text-[0.76rem] font-bold text-warning">{t("warrantyUnavailable")}</p>
                  )}
                </div>
              )}
            </div>
            {!financeAvailable && <p className="text-[0.74rem] font-bold text-warning">{t("financeUnavailable")}</p>}
          </TicketCard>

          {/* 5 — who takes it */}
          <TicketCard number={5} title={t("newTicketHolder")} hint={t("deskAssignHint")}>
            <Field label={t("deskHolder")}>
              <SelectField
                value={form.holderId}
                onChange={(value) => set("holderId", value)}
                options={[
                  // Nobody yet — it waits for a technician (2026-11-18).
                  { value: "", label: t("unassigned") },
                  ...holders.map((holder) => ({
                    value: holder.id,
                    label:
                      holder.id === viewerId
                        ? t("deskAssignSelf", { rank: rankLabel(holder.rank) })
                        : `${holder.name} — ${rankLabel(holder.rank)}`,
                  })),
                ]}
              />
            </Field>
          </TicketCard>
        </div>
      )}
      {warrantyOpen && printFacts && done && (
        <RepairWarrantyDialog
          facts={printFacts}
          ticketId={done.id}
          canEdit={done.warrantySaved}
          warrantyAvailable={warrantyAvailable}
          today={today}
          onClose={() => setWarrantyOpen(false)}
        />
      )}
    </EntityDialog>
  );
}

function DoneAction({
  icon: Icon,
  tone,
  title,
  onPress,
}: {
  icon: typeof Printer;
  tone: "info" | "success" | "ink";
  title: string;
  onPress: () => void;
}) {
  const look = {
    info: "border-info/40 text-info hover:bg-info/8",
    success: "border-success/40 text-success hover:bg-success/8",
    ink: "border-line-strong text-ink hover:bg-subtle",
  }[tone];
  return (
    <button
      type="button"
      onClick={onPress}
      className={cn("press flex items-center gap-2.5 rounded-panel border-2 bg-surface px-4 py-3 text-start text-[0.86rem] font-black transition-colors", look)}
    >
      <Icon className="size-5 shrink-0" aria-hidden />
      {title}
    </button>
  );
}

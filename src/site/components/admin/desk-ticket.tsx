"use client";

import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { ChevronDown, Cpu, Loader2, Printer, ShieldCheck, Wrench } from "lucide-react";
import { EntityDialog, Field, FieldGroup, Grid, input, NumberInput, Section, SelectField, MoneyInput } from "@/components/admin/form-kit";
import {
  RepairWarrantyDialog,
  TICKET_RUN,
  type RepairPrintFacts,
} from "@/components/admin/repair-print";
import { isPrinting, printStation, startPrint } from "@/lib/print/station";
import type { DeskHolder } from "@/components/admin/repairs-board";
import { FaultPicker } from "@/components/admin/fault-picker";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { createDeskTicket } from "@/lib/actions/repair-desk";
import type { StockModel } from "@/lib/data/device-catalogue";
import { deskModelOptions, type RecentDevice } from "@/lib/data/recent-devices";
import { faultText, isNewFault, splitFaults, type RecentFault } from "@/lib/data/repair-faults";
import { formatDayNumeric } from "@/lib/data/datetime";
import { useWorldModels } from "@/lib/hooks/use-world-models";
import { repairMoney, repairTotal, type PaymentTerms, type RepairService } from "@/lib/data/repair-desk";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * A ticket opened at the counter — the repair desk's and the programming
 * desk's "add a ticket". A manager's and an assistant's, never a technician's.
 *
 * Everything the brief listed, in the order the desk fills it: the customer
 * (name, number), what is wrong (the fault, picked from the bench's own list
 * rather than typed, so the ticket files under the right bench and the right
 * price row), the money — cash or deferred, the repair, the warranty, what the
 * part cost, what has been paid — and who holds it. What is left to pay and the
 * profit are worked out as the fields are typed, never entered.
 *
 * ⚠️ The customer sees the repair and the warranty as one amount. The purchase
 * price and what has been paid go to `repair_ticket_finance`, which a customer
 * cannot read.
 *
 * The holder is a technician straight away, or a manager or assistant keeping
 * it for now — it opens on whoever is typing, which is what "temporarily" means
 * at a counter with a customer waiting.
 */

type Branch = { id: string; name: string };
type Brand = { code: string; name: string };
type Issue = { code: string; name: string };

export function DeskTicketButton({
  service,
  branches,
  brands,
  models,
  recentDevices = [],
  recentFaults = [],
  issues,
  holders,
  viewerId,
  today,
  financeAvailable,
  warrantyAvailable,
}: {
  service: RepairService;
  branches: Branch[];
  brands: Brand[];
  /** The shop own models per make, floated above the curated list. */
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
}) {
  const t = useTranslations("Admin");
  /*
   * Every "add a ticket" window open now. Each press opens another — two
   * customers at the counter are two tickets filled side by side — and each
   * keeps its own fields until it is saved or closed. See `app-window.tsx`.
   */
  const [windows, setWindows] = useState<number[]>([]);
  const [next, setNext] = useState(1);
  const Icon = service === "software" ? Cpu : Wrench;
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setWindows((current) => [...current, next]);
          setNext((n) => n + 1);
        }}
        className="press inline-flex shrink-0 items-center gap-2 rounded-control bg-brand px-4 py-2.5 text-[0.8rem] font-extrabold text-white transition-colors hover:bg-brand-hover"
      >
        <Icon className="size-4" aria-hidden />
        {t("deskNewTicket")}
        {windows.length > 0 && (
          <span className="rounded-full bg-white/25 px-1.5 text-[0.7rem]" data-numeric>
            {windows.length}
          </span>
        )}
      </button>
      {windows.map((number) => (
        <DeskTicketDialog
          key={number}
          number={number}
          service={service}
          branches={branches}
          brands={brands}
          models={models}
          recentDevices={recentDevices}
          recentFaults={recentFaults}
          issues={issues}
          holders={holders}
          viewerId={viewerId}
          today={today}
          financeAvailable={financeAvailable}
          warrantyAvailable={warrantyAvailable}
          onClose={() => setWindows((current) => current.filter((n) => n !== number))}
        />
      ))}
    </>
  );
}

function DeskTicketDialog({
  number,
  service,
  branches,
  brands,
  models,
  recentDevices,
  recentFaults,
  issues,
  holders,
  viewerId,
  today,
  financeAvailable,
  warrantyAvailable,
  onClose,
}: {
  /** Which "new ticket" window this is — the dock tells several apart by it. */
  number: number;
  service: RepairService;
  branches: Branch[];
  brands: Brand[];
  models: Record<string, StockModel[]>;
  recentDevices: RecentDevice[];
  recentFaults: RecentFault[];
  issues: Issue[];
  holders: DeskHolder[];
  viewerId: string;
  today: string;
  financeAvailable: boolean;
  warrantyAvailable: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("Admin");
  /*
   * The shared picker vocabulary — “type to search”, “no match”,
   * “use ‹name›”, “we sell this”. The customer’s wizard reads the same
   * five strings for the same control, and six Admin copies of them would be
   * six strings to reword twice. `/admin` provides every namespace, so
   * this is simply the one that owns these words.
   */
  const tPicker = useTranslations("Picker");
  const locale = useLocale();
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [branchId, setBranchId] = useState(branches.length === 1 ? branches[0].id : "");
  const [brandCode, setBrandCode] = useState("");
  const [model, setModel] = useState("");
  /*
   * The faults: codes off the bench's list, and `new:` names typed at the
   * counter that the save files on the list. One control for both — see
   * `fault-picker.tsx`.
   */
  const [faults, setFaults] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState<PaymentTerms>("cash");
  const [price, setPrice] = useState<number | null>(null);
  const [warranty, setWarranty] = useState<number | null>(null);
  const [warrantyDays, setWarrantyDays] = useState<number | null>(null);
  const [cost, setCost] = useState<number | null>(null);
  const [collected, setCollected] = useState<number | null>(null);
  const [holderId, setHolderId] = useState(viewerId);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{
    id: string;
    code: string;
    at: string;
    financeSaved: boolean;
    warrantySaved: boolean;
    customSaved: boolean;
    listSaved: boolean;
  } | null>(null);
  const [warrantyOpen, setWarrantyOpen] = useState(false);
  /** The warranty's fields, folded until asked for (2026-11-17). */
  const [warrantyShown, setWarrantyShown] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);
  // Read only for the button's spinner: the run lives in the print station,
  // so closing this dialog mid-print cannot stop the papers.
  const station = useSyncExternalStore(printStation.subscribe, printStation.snapshot, printStation.server);
  const printing = !!station.run && isPrinting();
  const [pending, start] = useTransition();

  const total = repairTotal(price, warranty);
  const money = repairMoney({ price: total, warranty, cost, collected, terms });
  const rankLabel = (rank: DeskHolder["rank"]) => t(`rank_${rank}`);

  const { models: worldModels, loading: modelsLoading } = useWorldModels(
    brandCode || null,
    locale,
  );

  /**
   * Every device of this make the counter is likely to see — what the shop
   * sells first, then the curated list, then the make's own back catalogue.
   *
   * The same three sources the customer's wizard offers, through the same
   * `mergeBrandModels`. The desk was a bare text box: a staff member retyping
   * "Galaxy A17" by hand is how one handset ends up filed under four spellings,
   * none of which matches the price list or the parts board.
   *
   * Every row is the **standard** name — "Samsung Galaxy A17", never "Samsung
   * Galaxy A17 256GB / 8GB" — because that string is the whole of the device
   * line on the label, the receipt and the warranty certificate this dialog
   * prints. See `lib/data/device-name.ts`.
   */
  /*
   * ⚠️ No `inStockMark`, and that is the shop's own instruction: the mark is
   * for customers. Staff know what is on the shelf, and on a ticket dialog it
   * is a word in brackets on every row that nobody reads.
   *
   * With no make chosen — the default, "every make" — the list is every
   * make's models at once, opening on the devices this bench prepared
   * receipts for most recently; a search ranks those first too (`rank`).
   * See `lib/data/recent-devices.ts`.
   */
  const modelOptions = useMemo(
    () =>
      deskModelOptions({
        brandCode: brandCode || null,
        brands,
        stock: models,
        world: worldModels,
        recent: recentDevices,
        dayLabel: (at) => t("deskRecentOn", { day: formatDayNumeric(locale, at) }),
      }),
    [brandCode, brands, models, worldModels, recentDevices, t, locale],
  );
  const brandOfModel = useMemo(
    () => new Map(modelOptions.map((option) => [option.value, option.brandCode])),
    [modelOptions],
  );

  /*
   * ⚠️ Changing the make clears the model, in the handler and never an effect.
   * The field would otherwise keep the previous make's phone — which reads as
   * a filled-in answer and is the kind of wrong a ticket carries to the bench.
   */
  function pickBrand(next: string) {
    setBrandCode(next);
    setModel("");
  }

  function submit() {
    setError(null);
    // ⚠️ Required: a ticket opened without its fee is a ticket the receipt,
    // the till and the profit report all read as free. The action refuses it
    // too; asking here keeps the reader at the field rather than the footer.
    if (price == null || price <= 0) {
      setError("price_required");
      return;
    }
    const picked = splitFaults(faults);
    if (!picked.codes.length && !picked.names.length) {
      setError("issue_required");
      return;
    }
    start(async () => {
      const result = await createDeskTicket({
        service,
        customerName: name,
        customerPhone: phone,
        branchId,
        deviceBrandCode: brandCode || null,
        deviceModel: model,
        issueCodes: picked.codes,
        newFaults: picked.names,
        notes,
        price,
        warranty,
        warrantyDays,
        costPrice: cost,
        collected: terms === "cash" ? null : collected,
        paymentTerms: terms,
        holderId,
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
      });
    });
  }

  const printFacts: RepairPrintFacts | null = done && {
    code: done.code,
    customerName: name.trim(),
    device: model.trim(),
    fault: faults
      .flatMap((value) => {
        const match = issues.find((issue) => issue.code === value);
        return match ? [match.name] : isNewFault(value) ? [faultText(value)] : [];
      })
      .join("، "),
    amount: money.price,
    warranty: money.warranty,
    collected: money.collected,
    remaining: money.remaining,
    terms,
    receivedAt: done.at,
    hasWarranty: (warranty ?? 0) > 0 || warrantyDays != null,
    warrantyDays,
    warrantyStart: null,
  };

  const text = "w-full rounded-control border border-line bg-canvas px-3 py-2 text-[0.85rem] font-semibold text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/25";

  return (
    <EntityDialog
      windowId={`desk-new-${service}-${number}`}
      // A window of its own on the desktop — see the ticket window's note.
      detach
      title={
        done
          ? `${service === "software" ? t("deskNewProgramming") : t("deskNewRepair")} · ${done.code}`
          : `${service === "software" ? t("deskNewProgramming") : t("deskNewRepair")} #${number}`
      }
      subtitle={[name.trim(), model.trim()].filter(Boolean).join(" · ") || undefined}
      closeLabel={t("close")}
      onClose={onClose}
      // Saved and printed, there is nothing left in it to lose.
      confirmClose={!done}
      width={680}
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          {done ? (
            <>
              {/* One press: the customer's two receipts, then the device's
                  label. The warranty asks for a length and a start date, so
                  it keeps a control of its own. */}
              <button
                type="button"
                onClick={(event) => {
                  if (!printFacts || !done) return;
                  // The date on the paper is the press's, and the station
                  // reads the ticket it just saved before printing it.
                  const started = startPrint({
                    ticketId: done.id,
                    facts: printFacts,
                    printedAt: Date.now(),
                    papers: TICKET_RUN,
                    locale,
                    from: event.currentTarget.ownerDocument,
                  });
                  setPrintBusy(started === "busy");
                }}
                disabled={printing}
                aria-busy={printing}
                className="press inline-flex items-center gap-2 rounded-control border border-line px-4 py-2 text-[0.82rem] font-extrabold text-ink transition-colors hover:border-brand hover:text-brand disabled:cursor-wait disabled:opacity-60"
              >
                {printing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Printer className="size-4" aria-hidden />}
                {t("deskPrint")}
              </button>
              <button
                type="button"
                onClick={() => setWarrantyOpen(true)}
                className="press inline-flex items-center gap-2 rounded-control border border-line px-4 py-2 text-[0.82rem] font-extrabold text-ink transition-colors hover:border-info hover:text-info"
              >
                <ShieldCheck className="size-4" aria-hidden />
                {t("printWarrantyPaper")}
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  // The board is a server read; refreshing it shows the ticket.
                  router.refresh();
                }}
                className="rounded-control bg-brand px-4 py-2 text-[0.82rem] font-extrabold text-white"
              >
                {t("close")}
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={onClose} className="rounded-control px-3 py-2 text-[0.8rem] font-bold text-muted hover:text-ink">
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={pending}
                className="inline-flex items-center gap-2 rounded-control bg-brand px-4 py-2 text-[0.82rem] font-extrabold text-white disabled:opacity-60"
              >
                {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {t("counterBook")}
              </button>
            </>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        {done ? (
          <div className="rounded-panel border border-success/30 bg-success/8 px-4 py-3">
            <p className="text-[0.85rem] font-bold text-ink">
              {t("counterTicketCode")}{" "}
              <span className="font-black text-success" data-numeric>{done.code}</span>
            </p>
            {!done.financeSaved && financeAvailable && (
              <p className="mt-1 text-[0.76rem] font-semibold text-warning">{t("deskFinanceNotSaved")}</p>
            )}
            {!done.warrantySaved && (
              <p className="mt-1 text-[0.76rem] font-semibold text-warning">{t("warrantyNotSaved")}</p>
            )}
            {/* A fault typed at the counter that the list could not take is
                kept on the ticket as text; one that could be kept nowhere is
                said plainly. Neither, and there is nothing to report. */}
            {!done.customSaved ? (
              <p className="mt-1 text-[0.76rem] font-semibold text-warning">{t("deskFaultsNotSaved")}</p>
            ) : (
              !done.listSaved && (
                <p className="mt-1 text-[0.76rem] font-semibold text-warning">{t("deskNewFaultsAsText")}</p>
              )
            )}
          </div>
        ) : (
          <>
            {error && (
              <p role="alert" className="rounded-control border border-brand/30 bg-brand/8 px-3 py-2 text-[0.78rem] font-bold text-brand">
                {t.has(error) ? t(error as "counterFailed") : t("counterFailed")}
              </p>
            )}

            <Section title={t("counterCustomer")}>
              <Grid>
                <Field label={t("counterName")}>
                  <input value={name} onChange={(e) => setName(e.target.value)} className={text} />
                </Field>
                <Field label={t("counterPhone")}>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    inputMode="tel"
                    dir="ltr"
                    placeholder="07XXXXXXXXX"
                    className={text}
                    data-numeric
                  />
                </Field>
              </Grid>
            </Section>

            <Section title={t("counterDevice")}>
              <Grid>
                <Field label={t("counterBranch")}>
                  <SelectField
                    value={branchId}
                    onChange={setBranchId}
                    options={branches.map((b) => ({ value: b.id, label: b.name }))}
                    placeholder={t("counterBranchPick")}
                  />
                </Field>
                <Field label={t("counterBrand")}>
                  <SelectField
                    value={brandCode}
                    onChange={pickBrand}
                    // "Every make" is a real choice and the default: the model
                    // list then holds them all, newest tickets first.
                    options={[
                      { value: "", label: t("counterBrandAll") },
                      ...brands.map((b) => ({ value: b.code, label: b.name })),
                    ]}
                  />
                </Field>
              </Grid>

              {/* The make comes first and the model is searched, not retyped.
                  With no make chosen there is no list to search, and the field
                  still takes whatever is typed — `allowCustom` is what makes
                  one control serve both, so an unlisted phone and a counter
                  that skipped the make are never dead ends. */}
              <Field label={t("counterModel")}>
                <SearchableSelect
                  options={modelOptions}
                  loading={modelsLoading}
                  value={model || null}
                  onChange={(next) => {
                    setModel(next ?? "");
                    // Picked from every make: the make is filled in from the
                    // device, so the ticket still files under its brand.
                    const make = next ? brandOfModel.get(next) : null;
                    if (!brandCode && make) setBrandCode(make);
                  }}
                  placeholder={brandCode ? t("deskModelPick") : t("deskModelAll")}
                  searchPlaceholder={tPicker("search")}
                  emptyLabel={tPicker("empty")}
                  clearLabel={tPicker("clear")}
                  allowCustom
                  formatCustom={(typed) => tPicker("use", { name: typed })}
                />
              </Field>

              {/* One control for every fault: pick from the bench's list —
                  most recently used first — or type one it does not have and
                  press Enter. A typed fault is filed on the list when the
                  ticket is saved, so the next ticket is offered it. */}
              <FieldGroup label={t("deskFault")} hint={t("deskFaultHint")} required>
                <FaultPicker
                  values={faults}
                  onChange={(next) => {
                    setFaults(next);
                    if (error === "issue_required" && next.length) setError(null);
                  }}
                  issues={issues}
                  recent={recentFaults}
                />
                {error === "issue_required" && (
                  <span role="alert" className="mt-1 block text-[0.72rem] font-bold text-brand">
                    {t("issue_required")}
                  </span>
                )}
              </FieldGroup>

              <Field label={t("deskNotes")}>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={cn(input, "resize-y")} />
              </Field>
            </Section>

            <Section title={t("financeTitle")} hint={t("financeHint")}>
              <Field label={t("financeTerms")}>
                <div className="inline-flex rounded-control border border-line p-0.5" role="radiogroup" aria-label={t("financeTerms")}>
                  {(["cash", "deferred"] as PaymentTerms[]).map((option) => (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={terms === option}
                      onClick={() => {
                        setTerms(option);
                        // Cash is paid in full, so the figure goes with the switch.
                        if (option === "cash") setCollected(null);
                      }}
                      className={cn(
                        "rounded-[calc(var(--radius-control)-2px)] px-3.5 py-1.5 text-[0.76rem] font-extrabold transition-colors",
                        terms === option
                          ? option === "deferred"
                            ? "bg-warning text-white"
                            : "bg-success text-white"
                          : "text-muted hover:text-ink",
                      )}
                    >
                      {t(option === "cash" ? "termsCash" : "termsDeferred")}
                    </button>
                  ))}
                </div>
              </Field>
              <Grid>
                <Field label={`${t("financeBasePrice")} *`}>
                  <MoneyInput
                    value={price}
                    clearable
                    onChange={(next) => {
                      setPrice(next);
                      if (error === "price_required" && next != null && next > 0) setError(null);
                    }}
                    min={0}
                  />
                  {error === "price_required" && (
                    <span role="alert" className="mt-1 block text-[0.72rem] font-bold text-brand">
                      {t("price_required")}
                    </span>
                  )}
                </Field>
                <Field label={t("financeCost")}>
                  <MoneyInput value={cost} clearable onChange={setCost} min={0} />
                </Field>
              </Grid>

              {/* ⚠️ Only once «آجل» is chosen — the shop, 2026-11-17: "the آجل
                  must show its fields only when the user chooses it". A cash
                  ticket is paid in full at the counter. */}
              {terms === "deferred" && (
                <div className="rounded-card border border-warning/35 bg-warning/5 p-3">
                  <Field label={t("financeCollected")}>
                    <MoneyInput value={collected} clearable onChange={setCollected} min={0} />
                  </Field>
                </div>
              )}

              {/* Its own block, because it is its own decision with its own
                  price — and it joins the repair in what the customer pays.
                  Folded until asked for, with what it holds on the fold. */}
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
                    {(warranty ?? 0) > 0
                      ? `${formatPrice(warranty!)} ${t("currency")}${warrantyDays ? ` · ${t("warrantyDaysShort", { days: String(warrantyDays) })}` : ""}`
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
                        <MoneyInput value={warranty} clearable onChange={setWarranty} min={0} />
                      </Field>
                      <Field label={t("warrantyDurationField")}>
                        <NumberInput value={warrantyDays} clearable onChange={setWarrantyDays} min={1} max={3650} />
                      </Field>
                    </Grid>
                    <p className="text-[0.74rem] font-medium leading-relaxed text-muted">{t("warrantyHint")}</p>
                    {/* The same three cells the ticket dialog draws, so the
                        split reads identically wherever a warranty is priced:
                        the repair, the warranty, and what the two come to. */}
                    <dl className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-control bg-surface px-2 py-1.5">
                        <dt className="text-[0.64rem] font-bold text-muted">{t("warrantyBase")}</dt>
                        <dd className="text-[0.84rem] font-black text-ink" data-numeric>{formatPrice(price ?? 0)}</dd>
                      </div>
                      <div className="rounded-control bg-surface px-2 py-1.5">
                        <dt className="text-[0.64rem] font-bold text-muted">{t("warrantyTitle")}</dt>
                        <dd className="text-[0.84rem] font-black text-info" data-numeric>{formatPrice(warranty ?? 0)}</dd>
                      </div>
                      <div className="rounded-control bg-surface px-2 py-1.5">
                        <dt className="text-[0.64rem] font-bold text-muted">{t("warrantyTotal")}</dt>
                        <dd className="text-[0.84rem] font-black text-brand" data-numeric>{formatPrice(total ?? 0)}</dd>
                      </div>
                    </dl>
                    {price == null && (warranty ?? 0) > 0 && (
                      <p className="text-[0.72rem] font-bold text-warning">{t("warrantyNeedsPrice")}</p>
                    )}
                  </>
                ) : (
                  <p className="text-[0.76rem] font-bold text-warning">{t("warrantyUnavailable")}</p>
                )}
                </div>
                )}
              </div>

              <dl className={cn("grid gap-2", terms === "deferred" ? "grid-cols-3" : "grid-cols-2")}>
                <div className="rounded-card border border-brand/35 bg-brand/6 px-3 py-2">
                  <dt className="text-[0.68rem] font-bold text-muted">{t("warrantyTotal")}</dt>
                  <dd className="text-[1rem] font-black text-brand" data-numeric>{formatPrice(total ?? 0)}</dd>
                </div>
                {terms === "deferred" && (
                  <div className="rounded-card border border-warning/40 bg-warning/6 px-3 py-2">
                    <dt className="text-[0.68rem] font-bold text-muted">{t("financeRemaining")}</dt>
                    <dd className="text-[1rem] font-black text-warning" data-numeric>{formatPrice(money.remaining)}</dd>
                  </div>
                )}
                <div className="rounded-card border border-success/35 bg-success/6 px-3 py-2">
                  <dt className="text-[0.68rem] font-bold text-muted">{t("financeProfit")}</dt>
                  <dd className={cn("text-[1rem] font-black", money.profit != null && money.profit < 0 ? "text-brand" : "text-success")}>
                    {money.profit == null ? (
                      <span className="text-[0.74rem] font-bold text-muted">{t("financeNoCost")}</span>
                    ) : (
                      <span data-numeric>{formatPrice(money.profit)}</span>
                    )}
                  </dd>
                  {money.warranty > 0 && (
                    <p className="mt-0.5 text-[0.64rem] font-bold leading-tight text-muted">
                      {t("financeProfitHint")}
                    </p>
                  )}
                </div>
              </dl>
              {!financeAvailable && (
                <p className="text-[0.74rem] font-bold text-warning">{t("financeUnavailable")}</p>
              )}
            </Section>

            <Section title={t("workTitle")} hint={t("deskAssignHint")}>
              <Field label={t("deskHolder")}>
                <SelectField
                  value={holderId}
                  onChange={setHolderId}
                  options={holders.map((holder) => ({
                    value: holder.id,
                    label:
                      holder.id === viewerId
                        ? t("deskAssignSelf", { rank: rankLabel(holder.rank) })
                        : `${holder.name} — ${rankLabel(holder.rank)}`,
                  }))}
                />
              </Field>
            </Section>
          </>
        )}
      </div>
      {printBusy && (
        <p role="alert" className="mt-3 text-[0.74rem] font-bold text-warning">
          {t("psBusy")}
        </p>
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

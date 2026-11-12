"use client";

import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Cpu, Loader2, Plus, Printer, ShieldCheck, Wrench, X } from "lucide-react";
import { EntityDialog, Field, FieldGroup, Grid, input, NumberInput, Section, SelectField, MoneyInput } from "@/components/admin/form-kit";
import {
  RepairWarrantyDialog,
  TICKET_RUN,
  type RepairPrintFacts,
} from "@/components/admin/repair-print";
import { isPrinting, printStation, startPrint } from "@/lib/print/station";
import type { DeskHolder } from "@/components/admin/repairs-board";
import { ChipMultiSelect } from "@/components/ui/chip-multi-select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { createDeskTicket } from "@/lib/actions/repair-desk";
import { mergeBrandModels, type StockModel } from "@/lib/data/device-catalogue";
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
  issues,
  holders,
  viewerId,
  today,
  financeAvailable,
  warrantyAvailable,
  customFaultsAvailable,
}: {
  service: RepairService;
  branches: Branch[];
  brands: Brand[];
  /** The shop own models per make, floated above the curated list. */
  models: Record<string, StockModel[]>;
  issues: Issue[];
  /** Who this reader may hand a ticket to. */
  holders: DeskHolder[];
  viewerId: string;
  /** Today's Baghdad day, from the server. */
  today: string;
  financeAvailable: boolean;
  warrantyAvailable: boolean;
  /**
   * False until `20261103_repair_custom_faults.sql` runs. The dialog then
   * omits the field rather than taking words and dropping them.
   */
  customFaultsAvailable: boolean;
}) {
  const t = useTranslations("Admin");
  const [open, setOpen] = useState(false);
  const Icon = service === "software" ? Cpu : Wrench;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="press inline-flex shrink-0 items-center gap-2 rounded-control bg-brand px-4 py-2.5 text-[0.8rem] font-extrabold text-white transition-colors hover:bg-brand-hover"
      >
        <Icon className="size-4" aria-hidden />
        {t("deskNewTicket")}
      </button>
      {open && (
        <DeskTicketDialog
          service={service}
          branches={branches}
          brands={brands}
          models={models}
          issues={issues}
          holders={holders}
          viewerId={viewerId}
          today={today}
          financeAvailable={financeAvailable}
          warrantyAvailable={warrantyAvailable}
          customFaultsAvailable={customFaultsAvailable}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function DeskTicketDialog({
  service,
  branches,
  brands,
  models,
  issues,
  holders,
  viewerId,
  today,
  financeAvailable,
  warrantyAvailable,
  customFaultsAvailable,
  onClose,
}: {
  service: RepairService;
  branches: Branch[];
  brands: Brand[];
  models: Record<string, StockModel[]>;
  issues: Issue[];
  holders: DeskHolder[];
  viewerId: string;
  today: string;
  financeAvailable: boolean;
  warrantyAvailable: boolean;
  customFaultsAvailable: boolean;
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
  const [issueCodes, setIssueCodes] = useState<string[]>([]);
  const [customFaults, setCustomFaults] = useState<string[]>([]);
  /** What is in the "anything else" box, before it becomes a chip. */
  const [customDraft, setCustomDraft] = useState("");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState<PaymentTerms>("cash");
  const [price, setPrice] = useState<number | null>(null);
  const [warranty, setWarranty] = useState<number | null>(null);
  const [warrantyDays, setWarrantyDays] = useState<number | null>(null);
  const [cost, setCost] = useState<number | null>(null);
  const [collected, setCollected] = useState<number | null>(null);
  const [holderId, setHolderId] = useState(viewerId);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; code: string; at: string; financeSaved: boolean; warrantySaved: boolean; customSaved: boolean } | null>(null);
  const [warrantyOpen, setWarrantyOpen] = useState(false);
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
  const modelOptions = useMemo(
    () =>
      /*
       * ⚠️ No `inStockMark`, and that is the shop's own instruction: the mark
       * is for customers. Staff know what is on the shelf, and on a ticket
       * dialog it is a word in brackets on every row that nobody reads and
       * that lengthens every label.
       *
       * The flag itself still earns its keep — `mergeBrandModels` floats the
       * stocked models to the top of the list either way, which is the useful
       * half and is invisible.
       */
      mergeBrandModels(
        brandCode || null,
        brandCode ? (models[brandCode] ?? []) : [],
        worldModels,
      ).map((option) => ({
        // Spread, not rebuilt: `keywords` is what the picker folds into its
        // search haystack, so a hand-made object loses the search.
        ...option,
        // The release year, which is what tells sixteen years of "Galaxy A5"
        // apart.
        hint: option.year ? String(option.year) : undefined,
      })),
    [brandCode, models, worldModels],
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

  function addCustomFault() {
    const fault = customDraft.trim().slice(0, 120);
    if (!fault || customFaults.includes(fault) || customFaults.length >= 10) return;
    setCustomFaults([...customFaults, fault]);
    setCustomDraft("");
  }

  function submit() {
    setError(null);
    start(async () => {
      const result = await createDeskTicket({
        service,
        customerName: name,
        customerPhone: phone,
        branchId,
        deviceBrandCode: brandCode || null,
        deviceModel: model,
        issueCodes,
        customFaults,
        notes,
        price,
        warranty,
        warrantyDays,
        costPrice: cost,
        collected,
        paymentTerms: terms,
        holderId,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone({ id: result.id, code: result.code, at: result.at, financeSaved: result.financeSaved, warrantySaved: result.warrantySaved, customSaved: result.customSaved });
    });
  }

  const printFacts: RepairPrintFacts | null = done && {
    code: done.code,
    customerName: name.trim(),
    device: model.trim(),
    fault: [
      ...issueCodes.flatMap((code) => {
        const match = issues.find((issue) => issue.code === code);
        return match ? [match.name] : [];
      }),
      ...customFaults,
    ].join("، "),
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
      title={service === "software" ? t("deskNewProgramming") : t("deskNewRepair")}
      closeLabel={t("close")}
      onClose={onClose}
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
                onClick={() => {
                  if (!printFacts || !done) return;
                  // The date on the paper is the press's, and the station
                  // reads the ticket it just saved before printing it.
                  const started = startPrint({
                    ticketId: done.id,
                    facts: printFacts,
                    printedAt: Date.now(),
                    papers: TICKET_RUN,
                    locale,
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
            {/* Only when something was actually typed and then not stored —
                the field is absent otherwise, so there is nothing to report. */}
            {!done.customSaved && (
              <p className="mt-1 text-[0.76rem] font-semibold text-warning">{t("deskFaultsNotSaved")}</p>
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
                    options={brands.map((b) => ({ value: b.code, label: b.name }))}
                    placeholder={t("counterBrandAny")}
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
                  onChange={(next) => setModel(next ?? "")}
                  placeholder={brandCode ? t("deskModelPick") : t("deskModelType")}
                  searchPlaceholder={tPicker("search")}
                  emptyLabel={tPicker("empty")}
                  clearLabel={tPicker("clear")}
                  allowCustom
                  formatCustom={(typed) => tPicker("use", { name: typed })}
                />
              </Field>

              <FieldGroup label={t("deskFault")} hint={t("deskFaultHint")} required>
                <ChipMultiSelect
                  values={issueCodes}
                  onChange={setIssueCodes}
                  options={issues.map((issue) => ({ value: issue.code, label: issue.name }))}
                  addLabel={t("deskFaultPick")}
                  emptyLabel={t("deskFaultNone")}
                  removeLabel={t("remove")}
                  searchPlaceholder={tPicker("search")}
                  noMatchLabel={tPicker("empty")}
                  clearLabel={tPicker("clear")}
                />
              </FieldGroup>

              {/* ⚠️ Absent, never disabled, when the column is not there — a
                  box that takes a fault and silently drops it is worse than no
                  box. And deliberately its own control rather than another
                  chip in the list above: these carry no code, no price and
                  nothing the service trigger can read, so drawing them as
                  identical chips would invite somebody to expect a quote
                  against one. */}
              {customFaultsAvailable && (
                <FieldGroup label={t("deskCustomFault")} hint={t("deskCustomFaultHint")}>
                  <div className="space-y-2">
                    {customFaults.length > 0 && (
                      <ul className="flex flex-wrap gap-1.5">
                        {customFaults.map((fault) => (
                          <li key={fault}>
                            <span className="inline-flex items-center gap-1.5 rounded-chip border border-dashed border-line bg-canvas py-1 pe-1.5 ps-2.5 text-[0.75rem] font-bold text-ink">
                              <span className="max-w-[16rem] truncate">{fault}</span>
                              <button
                                type="button"
                                onClick={() =>
                                  setCustomFaults(customFaults.filter((f) => f !== fault))
                                }
                                aria-label={`${t("remove")} — ${fault}`}
                                className="flex size-4 items-center justify-center rounded-full text-muted transition-colors hover:bg-brand/15 hover:text-brand"
                              >
                                <X className="size-3" aria-hidden />
                              </button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex gap-2">
                      <input
                        value={customDraft}
                        onChange={(e) => setCustomDraft(e.target.value)}
                        /* Enter adds the chip rather than submitting the
                           dialog, which is what a counter expects of a field
                           with an Add button beside it. */
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addCustomFault();
                          }
                        }}
                        maxLength={120}
                        placeholder={t("deskCustomFaultPlaceholder")}
                        className={text}
                      />
                      <button
                        type="button"
                        onClick={addCustomFault}
                        disabled={!customDraft.trim() || customFaults.length >= 10}
                        className="press inline-flex shrink-0 items-center gap-1.5 rounded-control border border-line px-3 py-2 text-[0.78rem] font-extrabold text-ink transition-colors hover:border-brand hover:text-brand disabled:opacity-50"
                      >
                        <Plus className="size-3.5" aria-hidden />
                        {t("deskCustomFaultAdd")}
                      </button>
                    </div>
                  </div>
                </FieldGroup>
              )}

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
                      onClick={() => setTerms(option)}
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
                <Field label={t("financeBasePrice")}>
                  <MoneyInput value={price} clearable onChange={setPrice} min={0} />
                </Field>
                <Field label={t("financeCost")}>
                  <MoneyInput value={cost} clearable onChange={setCost} min={0} />
                </Field>
                <Field label={t("financeCollected")}>
                  <MoneyInput value={collected} clearable onChange={setCollected} min={0} placeholder={terms === "cash" && total ? formatPrice(total) : undefined} />
                </Field>
              </Grid>

              {/* Its own block, because it is its own decision with its own
                  price — and it joins the repair in what the customer pays. */}
              <div className="space-y-2 rounded-card border-2 border-info/40 bg-info/6 p-3">
                <p className="flex items-center gap-2 text-[0.82rem] font-black text-ink">
                  <ShieldCheck className="size-4 text-info" aria-hidden />
                  {t("warrantyTitle")}
                </p>
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

              <dl className="grid grid-cols-3 gap-2">
                <div className="rounded-card border border-brand/35 bg-brand/6 px-3 py-2">
                  <dt className="text-[0.68rem] font-bold text-muted">{t("warrantyTotal")}</dt>
                  <dd className="text-[1rem] font-black text-brand" data-numeric>{formatPrice(total ?? 0)}</dd>
                </div>
                <div className="rounded-card border border-warning/40 bg-warning/6 px-3 py-2">
                  <dt className="text-[0.68rem] font-bold text-muted">{t("financeRemaining")}</dt>
                  <dd className="text-[1rem] font-black text-warning" data-numeric>{formatPrice(money.remaining)}</dd>
                </div>
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

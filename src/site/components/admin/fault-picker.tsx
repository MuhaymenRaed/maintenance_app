"use client";

import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, ListChecks, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { ChipMultiSelect } from "@/components/ui/chip-multi-select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EntityDialog, input } from "@/components/admin/form-kit";
import { addRepairIssue, editRepairIssue, updateRepairFaults } from "@/lib/actions/repair-desk";
import { useEditConfirm } from "@/components/admin/edit-confirm";
import { faultEdits, withFaultEdits } from "@/lib/repair/fault-edits";
import type { RepairService } from "@/lib/data/repair-desk";
import { cn } from "@/lib/utils";
import {
  cleanFaultName,
  faultOptions,
  faultText,
  isNewFault,
  isOldFault,
  MAX_TICKET_FAULTS,
  oldFaultValue,
  splitFaults,
  valueForTyped,
  type RecentFault,
} from "@/lib/data/repair-faults";
import type { DeskRow } from "@/lib/queries/repair-desk";

/**
 * A ticket's faults, picked — the counter's "add a ticket" and the ticket
 * window's editor draw the same control, so a fault is chosen and typed the
 * same way in both. See `lib/data/repair-faults.ts` for the rules.
 *
 * - The list opens on the faults this bench used most recently.
 * - Typing a fault the list does not have and pressing Enter adds it as a
 *   chip marked "new"; the save files it on the bench's list, where every
 *   ticket after this one is offered it.
 * - The list stays open after a pick, so three faults are three presses.
 * - Eight at most, the bound the database holds a ticket to.
 */
export function FaultPicker({
  values,
  onChange,
  issues,
  recent,
  extra,
  disabled,
  manage,
}: {
  /** Codes, `new:` names and the ticket's `old:` typed faults. */
  values: string[];
  onChange: (values: string[]) => void;
  /** The bench's list. */
  issues: readonly { code: string; name: string }[];
  /** The bench's recent faults, newest first. */
  recent: readonly RecentFault[];
  /** Faults the ticket carries that the bench's list does not. */
  extra?: readonly { code: string; name: string }[];
  disabled?: boolean;
  /**
   * The bench whose list may be edited from here — a manager's picker only.
   * Draws "edit the list": rename a fault or take it off, each behind a
   * confirmation (the shop, 2026-11-18).
   */
  manage?: RepairService;
}) {
  const t = useTranslations("Admin");
  const tPicker = useTranslations("Picker");
  const overrides = useSyncExternalStore(faultEdits.subscribe, faultEdits.snapshot, faultEdits.server);
  const list = useMemo(() => withFaultEdits(issues, overrides, values), [issues, overrides, values]);
  const options = useMemo(() => faultOptions({ issues: list, recent, extra }), [list, recent, extra]);
  const [managing, setManaging] = useState(false);
  // A ticket's old typed faults carry no code, so they do not count against
  // the eight the list may hold.
  const old = values.filter(isOldFault).length;

  return (
    <>
    <ChipMultiSelect
      values={values}
      onChange={onChange}
      options={options}
      addLabel={t("deskFaultPick")}
      emptyLabel={t("deskFaultNone")}
      removeLabel={t("remove")}
      searchPlaceholder={t("deskFaultSearch")}
      noMatchLabel={tPicker("empty")}
      clearLabel={tPicker("clear")}
      disabled={disabled}
      stayOpen
      max={MAX_TICKET_FAULTS + old}
      maxLabel={t("deskFaultMax")}
      create={{
        label: (typed) => t("deskFaultAddNew", { name: cleanFaultName(typed) }),
        value: (typed) => valueForTyped(typed, options),
      }}
      describe={(value) =>
        isNewFault(value)
          ? { label: faultText(value), tag: t("deskFaultNewTag") }
          : isOldFault(value)
            ? { label: faultText(value), tag: t("deskFaultOldTag") }
            : null
      }
    />
    {manage && !disabled && (
      <button
        type="button"
        onClick={() => setManaging(true)}
        className="mt-1.5 inline-flex items-center gap-1.5 rounded-control px-1 py-0.5 text-[0.72rem] font-bold text-info hover:underline"
      >
        <ListChecks className="size-3.5" aria-hidden />
        {t("deskFaultManage")}
      </button>
    )}
    {managing && manage && (
      <FaultListEditor service={manage} issues={list} onClose={() => setManaging(false)} />
    )}
    </>
  );
}

/** The bench's list in its own window — opened from a ticket's fault picker. */
function FaultListEditor({
  service,
  issues,
  onClose,
}: {
  service: RepairService;
  issues: readonly { code: string; name: string }[];
  onClose: () => void;
}) {
  const t = useTranslations("Admin");
  return (
    <EntityDialog
      title={t("deskFaultManageTitle")}
      subtitle={t("deskFaultManageHint")}
      closeLabel={t("close")}
      onClose={onClose}
      windowId={`fault-list:${service}`}
      width={460}
      height={560}
      confirmClose={false}
      footer={
        <button
          type="button"
          onClick={onClose}
          className="press inline-flex h-10 items-center rounded-control border border-line px-4 text-[0.82rem] font-bold"
        >
          {t("close")}
        </button>
      }
    >
      <FaultList service={service} issues={issues} />
    </EntityDialog>
  );
}

/**
 * The bench's list, editable: each fault's name, saved behind a "rename?"
 * confirmation, and a bin behind a "take it off?" one. A ticket that carries
 * a fault keeps it either way — a rename shows on it, a retired fault stays
 * on it and is simply not offered to the next ticket. In الإعدادات it also
 * takes a new fault (`allowAdd`), filed the way a fault typed at the counter
 * is, so the next ticket is offered it.
 */
export function FaultList({
  service,
  issues: given,
  allowAdd = false,
}: {
  service: RepairService;
  issues: readonly { code: string; name: string }[];
  allowAdd?: boolean;
}) {
  const t = useTranslations("Admin");
  const overrides = useSyncExternalStore(faultEdits.subscribe, faultEdits.snapshot, faultEdits.server);
  const issues = useMemo(() => withFaultEdits(given, overrides, []), [given, overrides]);
  const [adding, setAdding] = useState("");
  const [added, setAdded] = useState<{ code: string; name: string }[]>([]);
  const locale = useLocale() === "en" ? "en" : "ar";
  const [names, setNames] = useState<Record<string, string>>({});
  const [asking, setAsking] = useState<
    | { kind: "rename"; code: string; from: string; to: string }
    | { kind: "retire"; code: string; name: string }
    | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    if (!asking) return;
    const ask = asking;
    setError(null);
    startTransition(async () => {
      const result = await editRepairIssue(
        ask.kind === "rename"
          ? { service, code: ask.code, name: ask.to, locale }
          : { service, code: ask.code, retire: true, locale },
      );
      setAsking(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (ask.kind === "rename") faultEdits.renamed(ask.code, cleanFaultName(ask.to));
      else faultEdits.retired(ask.code);
      setNames((current) => {
        const next = { ...current };
        delete next[ask.code];
        return next;
      });
    });
  }

  function add() {
    const name = cleanFaultName(adding);
    if (name.length < 2) return;
    setError(null);
    startTransition(async () => {
      const result = await addRepairIssue(service, name);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setAdding("");
      setAdded((current) => (current.some((issue) => issue.code === result.id) ? current : [...current, { code: result.id, name }]));
    });
  }
  // Just added, until the page's own list carries it.
  const shown = [...issues, ...added.filter((issue) => !issues.some((other) => other.code === issue.code))];

  return (
    <>
      {error && (
        <p role="alert" className="mb-3 rounded-card bg-brand/10 px-3 py-2 text-[0.78rem] font-bold text-brand">
          {t.has(error) ? t(error as "updateFailed") : t("updateFailed")}
        </p>
      )}
      {allowAdd && (
        <div className="mb-3 flex items-center gap-2">
          <input
            value={adding}
            onChange={(event) => setAdding(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
            placeholder={t("settingsFaultAdd")}
            aria-label={t("settingsFaultAdd")}
            className={cn(input, "h-10 min-w-0 flex-1")}
          />
          <button
            type="button"
            onClick={add}
            disabled={pending || cleanFaultName(adding).length < 2}
            className="press inline-flex h-10 shrink-0 items-center gap-1.5 rounded-control bg-brand px-4 text-[0.8rem] font-extrabold text-white hover:bg-brand-hover disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
            {t("settingsFaultAddButton")}
          </button>
        </div>
      )}
      <ul className="space-y-2">
        {shown.map((issue) => {
          const draft = names[issue.code] ?? issue.name;
          const changed = cleanFaultName(draft) !== issue.name && cleanFaultName(draft).length >= 2;
          return (
            <li key={issue.code} className="flex items-center gap-2">
              <input
                value={draft}
                onChange={(event) => setNames((current) => ({ ...current, [issue.code]: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && changed) {
                    event.preventDefault();
                    setAsking({ kind: "rename", code: issue.code, from: issue.name, to: draft });
                  }
                }}
                aria-label={t("deskFaultNameFor", { name: issue.name })}
                className={cn(input, "h-10 min-w-0 flex-1")}
              />
              <button
                type="button"
                disabled={!changed || pending}
                onClick={() => setAsking({ kind: "rename", code: issue.code, from: issue.name, to: draft })}
                aria-label={t("deskFaultRename")}
                title={t("deskFaultRename")}
                className="press flex size-10 shrink-0 items-center justify-center rounded-control border border-info/40 bg-info/8 text-info transition-opacity disabled:opacity-35"
              >
                <Pencil className="size-4" aria-hidden />
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setAsking({ kind: "retire", code: issue.code, name: issue.name })}
                aria-label={t("deskFaultRetire", { name: issue.name })}
                title={t("deskFaultRetire", { name: issue.name })}
                className="press flex size-10 shrink-0 items-center justify-center rounded-control border border-brand/40 bg-brand/8 text-brand disabled:opacity-35"
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={asking !== null}
        tone={asking?.kind === "retire" ? "danger" : "normal"}
        title={asking?.kind === "retire" ? t("deskFaultRetireTitle") : t("deskFaultRenameTitle")}
        body={
          asking?.kind === "retire"
            ? t("deskFaultRetireBody", { name: asking.name })
            : asking?.kind === "rename"
              ? t("deskFaultRenameBody", { from: asking.from, to: cleanFaultName(asking.to) })
              : undefined
        }
        confirmLabel={asking?.kind === "retire" ? t("deskFaultRetireConfirm") : t("deskFaultRenameConfirm")}
        cancelLabel={t("cancel")}
        pending={pending}
        onConfirm={run}
        onCancel={() => setAsking(null)}
      />
    </>
  );
}

/**
 * A ticket's faults, changed after it was opened — in the ticket's own
 * window, by whoever runs it (`control === "full"`).
 *
 * The shop's words, 2026-11-16: a fault found on the bench is added to the
 * ticket "instead of creating an entire new ticket for that need". So the
 * chips are the editor: pick or type to add, press × to take one off, and
 * each change is saved as it is made — the way the rest of this window saves
 * a field on blur.
 *
 * ⚠️ Never disabled while a save is going: three faults typed in a row are
 * three changes, and an adder that went grey after the first would drop the
 * reader's focus. Each save sends the whole set, and Server Actions run one
 * after another, so the last change is the one the database keeps. What is on
 * screen is that last change until its answer arrives — `draft` is cleared
 * only by the call that sent it (compared by reference), never by an earlier
 * one finishing late.
 */
export function TicketFaults({
  repair,
  issues,
  recent,
  onPatch,
}: {
  repair: Pick<DeskRow, "id" | "code" | "faults" | "customFaults" | "service">;
  issues: readonly { code: string; name: string }[];
  recent: readonly RecentFault[];
  /** What the database now holds, written onto the board's row. */
  onPatch: (next: Pick<DeskRow, "faults" | "issueCodes" | "issues" | "customFaults">) => void;
}) {
  const t = useTranslations("Admin");
  const locale = useLocale();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<string[] | null>(null);
  const [state, setState] = useState<"idle" | "saved" | { error: string }>("idle");

  const saved = useMemo(
    () => [...repair.faults.map((fault) => fault.code), ...repair.customFaults.map(oldFaultValue)],
    [repair.faults, repair.customFaults],
  );
  const shown = draft ?? saved;
  /** Asked before the faults change — see `edit-confirm.tsx`. */
  const edits = useEditConfirm();
  const names = useMemo(() => {
    const byCode = new Map<string, string>();
    for (const issue of issues) byCode.set(issue.code, issue.name);
    for (const fault of repair.faults) byCode.set(fault.code, fault.name);
    return (values: readonly string[]) =>
      values.map((value) => byCode.get(value) ?? faultText(value)).join("، ") || t("editEmpty");
  }, [issues, repair.faults, t]);

  function change(next: string[]) {
    const picked = splitFaults(next);
    // A ticket is about something: the last fault cannot be taken off.
    if (!picked.codes.length && !picked.names.length) {
      setState({ error: "deskFaultKeepOne" });
      return;
    }
    // Shown at once and saved only once confirmed; «تراجع» puts it back.
    setDraft(next);
    edits.request({
      subject: repair.code,
      field: t("editFaults"),
      from: names(shown),
      to: names(next),
      run: () => save(next, picked),
      revert: () => setDraft(null),
    });
  }

  function save(next: string[], picked: ReturnType<typeof splitFaults>) {
    setState("idle");
    setDraft(next);
    start(async () => {
      const result = await updateRepairFaults(repair.id, {
        codes: picked.codes,
        newFaults: picked.names,
        custom: picked.old,
        locale,
      });
      setDraft((current) => (current === next ? null : current));
      if (!result.ok) {
        setState({ error: result.error });
        return;
      }
      onPatch({
        faults: result.faults,
        issueCodes: result.faults.map((fault) => fault.code),
        issues: result.faults.map((fault) => fault.name),
        customFaults: result.custom,
      });
      setState("saved");
    });
  }

  const error = typeof state === "object" ? state.error : null;
  return (
    <div className="space-y-1.5">
      <FaultPicker
        values={shown}
        onChange={change}
        issues={issues}
        recent={recent}
        // The ticket's own faults, named, wherever they are filed.
        extra={repair.faults}
        manage={repair.service}
      />
      {edits.dialog}
      <p className="flex min-h-4 items-center gap-1.5 text-[0.7rem] font-bold" aria-live="polite">
        {pending ? (
          <span className="inline-flex items-center gap-1.5 text-muted">
            <Loader2 className="size-3 animate-spin" aria-hidden />
            {t("deskFaultsSaving")}
          </span>
        ) : error ? (
          <span role="alert" className="text-brand">
            {t.has(error) ? t(error as "updateFailed") : t("updateFailed")}
          </span>
        ) : state === "saved" ? (
          <span className="inline-flex items-center gap-1.5 text-success">
            <Check className="size-3" aria-hidden />
            {t("deskFaultsSaved")}
          </span>
        ) : (
          <span className="font-medium text-muted">{t("deskFaultsEditHint")}</span>
        )}
      </p>
    </div>
  );
}

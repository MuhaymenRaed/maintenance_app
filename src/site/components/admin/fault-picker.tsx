"use client";

import { useMemo, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Loader2 } from "lucide-react";
import { ChipMultiSelect } from "@/components/ui/chip-multi-select";
import { updateRepairFaults } from "@/lib/actions/repair-desk";
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
}) {
  const t = useTranslations("Admin");
  const tPicker = useTranslations("Picker");
  const options = useMemo(() => faultOptions({ issues, recent, extra }), [issues, recent, extra]);
  // A ticket's old typed faults carry no code, so they do not count against
  // the eight the list may hold.
  const old = values.filter(isOldFault).length;

  return (
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
  repair: Pick<DeskRow, "id" | "faults" | "customFaults">;
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

  function change(next: string[]) {
    const picked = splitFaults(next);
    // A ticket is about something: the last fault cannot be taken off.
    if (!picked.codes.length && !picked.names.length) {
      setState({ error: "deskFaultKeepOne" });
      return;
    }
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
      />
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

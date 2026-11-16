"use client";

import { X } from "lucide-react";
import { SearchableSelect } from "@/components/ui/searchable-select";

/**
 * Choosing several things out of a long list.
 *
 * ---------------------------------------------------------------------------
 * Why not `<select multiple>`
 * ---------------------------------------------------------------------------
 * It is the platform's answer and it is a poor one: ctrl-clicking to build a
 * set is a desktop idiom half the people here have never met, the chosen items
 * are only visible while the box is tall enough to show them, and on a phone it
 * degrades into something close to unusable. Chips plus a searchable adder
 * makes the selection a thing you can *see*, and removing one is a press
 * rather than a modifier key.
 *
 * The adder's list excludes whatever is already chosen, so it never offers a
 * press that would do nothing — the same rule the showcase picker follows.
 *
 * ---------------------------------------------------------------------------
 * Why it is in `components/ui` and not beside its first caller
 * ---------------------------------------------------------------------------
 * It grew up inside `offers-board.tsx` as `ScopePicker`, wired to that dialog's
 * four scopes. The second thing that needed it — filling a brand new filter
 * with products, so it is not created empty — would have had to either import a
 * component that takes an `OfferScope`, or copy it. Two copies of a control
 * this fiddly are two controls that drift, which is the argument
 * `lib/showcase/membership-store.ts` already makes about the star on a product
 * card, and it drifts silently because both halves keep working.
 *
 * So the *options* are the caller's problem and the interaction is this
 * component's. `ScopePicker` still exists as the thin thing that maps a scope
 * to a list of options and hands it over.
 *
 * ---------------------------------------------------------------------------
 * Adding what the list does not have — `create`
 * ---------------------------------------------------------------------------
 * The repair desks' fault picker (2026-11-16): a fault typed at the counter is
 * added as a chip on Enter, and filed on the bench's list when the ticket is
 * saved. The typed words come back through `create.value`, which answers the
 * value to add — an existing one when the words name it, so nothing is filed
 * twice — and `describe` names a chip whose value is not one of `options`.
 * Without `create` the control behaves exactly as it always has.
 */
export function ChipMultiSelect({
  values,
  options,
  onChange,
  addLabel,
  emptyLabel,
  removeLabel,
  searchPlaceholder,
  noMatchLabel,
  clearLabel,
  disabled,
  create,
  max,
  maxLabel,
  describe,
  stayOpen = false,
}: {
  values: string[];
  /** `hint` is drawn quietly after the label — a parent, a code, a count. */
  options: { value: string; label: string; hint?: string; rank?: number }[];
  onChange: (values: string[]) => void;
  /** The adder's placeholder — a verb, because it is an action not a field. */
  addLabel: string;
  /** Shown in place of the chips when nothing is chosen. */
  emptyLabel: string;
  removeLabel: string;
  searchPlaceholder: string;
  noMatchLabel: string;
  clearLabel: string;
  disabled?: boolean;
  /**
   * Let the reader add what the list does not have. `label` is the row
   * offered under the matches for the typed words; `value` turns them into
   * the value to add, or null to refuse them.
   */
  create?: {
    label: (typed: string) => string;
    value: (typed: string) => string | null;
  };
  /**
   * At most this many. The adder is disabled at the bound and says so, rather
   * than offering a press the save would refuse.
   */
  max?: number;
  /** What the disabled adder reads at `max`. */
  maxLabel?: string;
  /** The chip of a value that is not one of `options`: its words and a tag. */
  describe?: (value: string) => { label: string; tag?: string } | null;
  /** Keep the list open after a pick, for choosing several in a row. */
  stayOpen?: boolean;
}) {
  const labelOf = new Map(options.map((option) => [option.value, option.label]));
  const chosen = new Set(values);
  const full = max !== undefined && values.length >= max;

  function add(value: string | null) {
    if (!value || full) return;
    if (labelOf.has(value)) {
      if (!chosen.has(value)) onChange([...values, value]);
      return;
    }
    // Not on the list: what the reader typed, offered by `allowCustom`.
    const next = create?.value(value) ?? null;
    if (next && !chosen.has(next)) onChange([...values, next]);
  }

  return (
    <div className="space-y-2.5">
      {values.length === 0 ? (
        <p className="rounded-card border border-dashed border-line px-3.5 py-3 text-[0.75rem] font-medium text-muted">
          {emptyLabel}
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {values.map((value) => {
            const described = labelOf.has(value) ? null : (describe?.(value) ?? null);
            // Falls back to the raw value: an option that has since been
            // removed from the list is still part of the selection, and
            // drawing it as an empty chip would hide it.
            const label = labelOf.get(value) ?? described?.label ?? value;
            return (
              <li key={value}>
                <span
                  className={
                    described
                      ? "inline-flex items-center gap-1.5 rounded-chip border border-dashed border-brand/50 bg-canvas py-1 pe-1.5 ps-2.5 text-[0.75rem] font-bold text-ink"
                      : "inline-flex items-center gap-1.5 rounded-chip border border-brand/35 bg-brand/6 py-1 pe-1.5 ps-2.5 text-[0.75rem] font-bold text-ink"
                  }
                >
                  <span className="max-w-[14rem] truncate">{label}</span>
                  {described?.tag && (
                    <span className="rounded-full bg-brand/12 px-1.5 text-[0.62rem] font-extrabold text-brand">
                      {described.tag}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => onChange(values.filter((v) => v !== value))}
                    disabled={disabled}
                    aria-label={`${removeLabel} — ${label}`}
                    className="flex size-4 items-center justify-center rounded-full text-muted transition-colors hover:bg-brand/15 hover:text-brand disabled:opacity-50"
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <SearchableSelect
        options={options.filter((option) => !chosen.has(option.value))}
        // Always null: this is an adder, not a field. What it has chosen lives
        // in the chips above, which are the record of the selection.
        value={null}
        disabled={disabled || full}
        onChange={add}
        placeholder={full && maxLabel ? maxLabel : addLabel}
        searchPlaceholder={searchPlaceholder}
        emptyLabel={noMatchLabel}
        clearLabel={clearLabel}
        allowCustom={Boolean(create)}
        formatCustom={create?.label}
        // The pick that fills the last place closes the list: a list left open
        // over a disabled adder offers rows that can no longer be chosen.
        stayOpen={stayOpen && (max === undefined || values.length + 1 < max)}
      />
    </div>
  );
}

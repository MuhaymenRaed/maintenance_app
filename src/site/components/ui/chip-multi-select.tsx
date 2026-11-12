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
}: {
  values: string[];
  /** `hint` is drawn quietly after the label — a parent, a code, a count. */
  options: { value: string; label: string; hint?: string }[];
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
}) {
  const labelOf = new Map(options.map((option) => [option.value, option.label]));
  const chosen = new Set(values);

  return (
    <div className="space-y-2.5">
      {values.length === 0 ? (
        <p className="rounded-card border border-dashed border-line px-3.5 py-3 text-[0.75rem] font-medium text-muted">
          {emptyLabel}
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {values.map((value) => (
            <li key={value}>
              <span className="inline-flex items-center gap-1.5 rounded-chip border border-brand/35 bg-brand/6 py-1 pe-1.5 ps-2.5 text-[0.75rem] font-bold text-ink">
                <span className="max-w-[14rem] truncate">
                  {/* Falls back to the raw value: an option that has since been
                      removed from the list is still part of the selection, and
                      drawing it as an empty chip would hide it. */}
                  {labelOf.get(value) ?? value}
                </span>
                <button
                  type="button"
                  onClick={() => onChange(values.filter((v) => v !== value))}
                  aria-label={`${removeLabel} — ${labelOf.get(value) ?? value}`}
                  className="flex size-4 items-center justify-center rounded-full text-muted transition-colors hover:bg-brand/15 hover:text-brand"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <SearchableSelect
        options={options.filter((option) => !chosen.has(option.value))}
        // Always null: this is an adder, not a field. What it has chosen lives
        // in the chips above, which are the record of the selection.
        value={null}
        disabled={disabled}
        onChange={(value) => {
          if (value && !chosen.has(value)) onChange([...values, value]);
        }}
        placeholder={addLabel}
        searchPlaceholder={searchPlaceholder}
        emptyLabel={noMatchLabel}
        clearLabel={clearLabel}
      />
    </div>
  );
}

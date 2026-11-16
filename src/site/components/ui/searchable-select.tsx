"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, Search, X } from "lucide-react";
import { createPortal } from "react-dom";
import { fuzzyScore, normalizeSearch } from "@/lib/search";
import {
  popoverPanel,
  popoverStyle,
  usePopoverAnchor,
} from "@/lib/hooks/use-popover-anchor";
import { useScrollUnderLock } from "@/lib/hooks/use-scroll-under-lock";
import { swallowNextClick } from "@/lib/ui/swallow-click";
import { DRAG_SLOP, PickerBusyLine, PickerGlyph } from "@/components/ui/select";

/** Rows per page of the list — see `limit`. */
const PAGE = 40;
import { cn } from "@/lib/utils";

/**
 * A one-of-many picker with a search box in it.
 *
 * ---------------------------------------------------------------------------
 * Why this is not `<Select>`
 * ---------------------------------------------------------------------------
 * `components/ui/field.tsx` says a native `<select>` is the right control for
 * "short, flat lists (province, branch)", and that is still true — the platform
 * picker is faster on a phone and arrives with RTL, keyboard and screen-reader
 * behaviour already correct. That reasoning runs out at length. Once a brand
 * offers sixty handsets, the native picker is a scroll through sixty rows with
 * no way to jump: iOS gives a spinning drum, and Android a full-screen list
 * whose only search is type-ahead on the *first letter*, which is useless when
 * every option starts with "Galaxy" or "Redmi Note".
 *
 * So this exists for exactly one reason — lists long enough that finding a row
 * beats reading them all. Keep using `<Select>` everywhere else; two controls
 * for the same job is only worth it because the jobs genuinely differ.
 *
 * ---------------------------------------------------------------------------
 * Matching
 * ---------------------------------------------------------------------------
 * Through `normalizeSearch`, the same fold the catalogue's own search uses, so
 * "ايفون" finds "iPhone 15" and "s24" finds "Galaxy S24" — this shop's
 * customers type the model in either script and frequently in both at once.
 * Every token has to match, in any order: "note pro" finds "Redmi Note 13 Pro"
 * and so does "pro note", while neither finds a plain "Note 13".
 *
 * Options carry an optional `keywords` string that is folded into the haystack
 * but never drawn — that is what lets a device be found by an alias it is
 * commonly sold under without putting two names on the row.
 *
 * ---------------------------------------------------------------------------
 * Shape
 * ---------------------------------------------------------------------------
 * The trigger *is* the search field, per the ARIA combobox-with-listbox
 * pattern: one control, so there is never a moment where the thing you pressed
 * and the thing you type into are different boxes. Closed, it shows the chosen
 * label; open, it shows what you have typed. Both are derived from props and
 * state rather than copied in by an effect — mirroring a prop into state is the
 * pattern `react-hooks` rejects and the one that goes stale after a back
 * button.
 */

export type SearchableOption = {
  value: string;
  label: string;
  /** Drawn beside the label, for a group or a brand name. Optional. */
  hint?: string;
  /** Folded into the search haystack but never rendered. */
  keywords?: string;
  /**
   * Lower ranks first among equally good matches — the repair desk ranks the
   * devices it prepared receipts for most recently. A typo never outranks a
   * real match because of it: see the tiers in `matches`.
   */
  rank?: number;
};

const controlBase =
  "w-full rounded-control border border-line bg-surface px-4 py-2.5 text-sm font-medium text-ink transition-colors placeholder:text-muted hover:border-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed disabled:opacity-60";

export function SearchableSelect({
  id,
  options,
  value,
  onChange,
  placeholder,
  searchPlaceholder,
  emptyLabel,
  clearLabel,
  allowCustom = false,
  formatCustom,
  disabled = false,
  loading = false,
  stayOpen = false,
  className,
}: {
  id?: string;
  options: SearchableOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  /** Shown when nothing is chosen. */
  placeholder: string;
  /** Shown in the field once it is open and empty. */
  searchPlaceholder: string;
  /** Shown in place of the list when nothing matches. */
  emptyLabel: string;
  /** Accessible name for the button that empties the choice. */
  clearLabel: string;
  /**
   * Let the reader commit whatever they typed, even when nothing matches.
   *
   * On by default nowhere — it is opt-in, because it is only correct where a
   * free-typed answer is *usable*. The repair and trade-in wizards want it: a
   * device missing from the list is a real phone on a real counter, and a
   * picker that refuses it turns an eight-year-old handset into a dead end.
   * The comparison tool must not have it, because a name we hold no specs for
   * produces a table of blanks.
   */
  allowCustom?: boolean;
  /** Row label for the typed value, e.g. `Use "Nokia 3310"`. */
  formatCustom?: (typed: string) => string;
  disabled?: boolean;
  /**
   * The rows are still on their way — the choice that fills this list has not
   * come back. The field cannot be typed into or chosen from yet.
   *
   * ⚠️ A press during the wait is KEPT, not refused. `open` still goes true;
   * only `listOpen` waits. So somebody who picks a make and goes straight to
   * the model field gets the list the moment it exists, rather than having to
   * work out that their press landed too early and make it again — which is
   * what "fast" means when the wait itself cannot be shortened.
   */
  loading?: boolean;
  /**
   * After a choice the list stays open, with the query cleared, rather than
   * closing. For an adder — the chips of a multi-select — where several picks
   * in a row is the common case and reopening the list for each is a press
   * per pick spent on nothing.
   */
  stayOpen?: boolean;
  className?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  /*
   * How many rows are in the DOM. A make can carry several hundred devices
   * once the world catalogue is behind the picker, and a list that mounts
   * them all stalls on the mid-range phones this shop's customers use. The
   * first page is drawn; reaching the foot of the list draws the next, so
   * the reader scrolls straight through to the end of the make without a
   * "load more" to press. Reset with the query, in the same event.
   */
  const [limit, setLimit] = useState(PAGE);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  /*
   * Where a press started, so a *drag* is not read as a choice.
   *
   * ⚠️ This list used to commit on `pointerdown`, which on a touch screen means
   * the first frame of a scroll gesture picked whatever row the finger landed
   * on and closed the panel. The list could not be scrolled at all: every
   * attempt chose something. The comment defending `pointerdown` was about a
   * mouse — a `click` fires after the field's focus change has already torn the
   * list down — and that is still true, so the fix is to keep the press but
   * commit on the *release*, and only when the pointer stayed put.
   */
  const press = useRef<{ x: number; y: number; value: string } | null>(null);

  /*
   * ⚠️ Portalled and `fixed`, not `absolute`.
   *
   * This list used to be `absolute inset-x-0 top-full` inside the field's own
   * wrapper, and it was broken in every dialog it appeared in — which is all
   * of them: the staff editor's account picker, the offers product picker, the
   * repair and trade-in device pickers.
   *
   * Two separate faults, one symptom. Every dashboard dialog scrolls its own
   * body, so the list was *clipped* by that scroller. And Radix's modal
   * `Dialog` puts `pointer-events: none` on `<body>` and hands only its own
   * content `auto` back, so the list could not be clicked or wheel-scrolled —
   * while the keyboard path kept working perfectly, because focus never leaves
   * the input. That asymmetry is what made it read as "the dropdown only works
   * with the keyboard".
   *
   * `components/ui/select` has been portalled for a while and this was not.
   * The arrangement now lives in one hook so a third picker cannot be written
   * without it.
   */
  const listOpen = open && !loading;
  const box = usePopoverAnchor(fieldRef, listOpen, { maxHeight: 288 });
  // Wheel and touch, for a panel a dialog's scroll lock would otherwise
  // freeze. See the hook — the cause is outside this codebase.
  const underLock = useScrollUnderLock();

  const selected = options.find((option) => option.value === value) ?? null;

  /**
   * What the closed field reads.
   *
   * Falls back to `value` itself rather than to the empty string, because with
   * `allowCustom` the committed answer is frequently a model that is on no
   * list at all — and a field that goes blank after you typed a device into it looks
   * exactly like the form having thrown the answer away.
   */
  const shownLabel = selected?.label ?? value ?? "";

  /**
   * Fold every row once per option list rather than once per keystroke: the
   * memo is keyed on `options`, so it only re-runs when the brand changes.
   */
  const haystack = useMemo(
    () =>
      options.map((option) => ({
        option,
        text: normalizeSearch(
          [option.label, option.hint ?? "", option.keywords ?? ""].join(" "),
        ),
      })),
    [options],
  );

  const matches = useMemo(() => {
    const folded = normalizeSearch(query);
    const tokens = folded.split(" ").filter(Boolean);

    // Fuzzy, ranked: a verbatim hit outranks a prefix, which outranks a
    // typo, and the list's own order breaks ties — so "galxy s24" still puts
    // the Galaxy S24 first. See `fuzzyScore`.
    //
    // ⚠️ Two tiers before the rank: a verbatim or prefix hit (score under 1)
    // always outranks a typo. Within a tier an option's `rank` comes first —
    // the desk's "most recently prepared" — and then the score. Options with
    // no rank compare as equal on it (`Infinity - Infinity` is NaN, which the
    // `||` chain reads as "no opinion"), so a list without ranks sorts exactly
    // as it always has.
    const tier = (score: number) => (score < 1 ? 0 : 1);
    const found = tokens.length
      ? haystack
          .flatMap((entry, order) => {
            const score = fuzzyScore(entry.text, folded);
            return score === null ? [] : [{ option: entry.option, score, order }];
          })
          .sort(
            (a, b) =>
              tier(a.score) - tier(b.score) ||
              (a.option.rank ?? Infinity) - (b.option.rank ?? Infinity) ||
              a.score - b.score ||
              a.order - b.order,
          )
          .map((entry) => entry.option)
      : haystack.map((entry) => entry.option);

    // The typed value goes *last*, so a real model always outranks it — typing
    // "iphone 15" should highlight the iPhone 15, not an offer to invent one.
    // Suppressed when the fold already names a row exactly, which is what stops
    // "iPhone 15" appearing twice once it has been matched.
    if (
      allowCustom &&
      tokens.length &&
      !found.some((option) => normalizeSearch(option.label) === folded)
    ) {
      const typed = query.trim();
      if (typed) {
        found.push({
          value: typed,
          label: formatCustom ? formatCustom(typed) : typed,
        });
      }
    }

    return found;
  }, [haystack, query, allowCustom, formatCustom]);

  // Clamped rather than reset: the list shrinks as you type, and an index left
  // pointing past the end would highlight nothing while a list is on screen,
  // so Enter would appear to do nothing.
  const activeIndex = matches.length
    ? Math.min(active, matches.length - 1)
    : -1;

  /** Close and forget the query — reopening should start from the whole list. */
  const close = () => {
    setOpen(false);
    setQuery("");
    setActive(0);
  };

  const commit = (next: string | null) => {
    // The click that follows this release would otherwise land on whatever
    // the list was covering — see `lib/ui/swallow-click.ts`.
    swallowNextClick();
    onChange(next);
    if (stayOpen && next !== null) {
      setQuery("");
      setLimit(PAGE);
      setActive(0);
      return;
    }
    close();
  };

  // `pointerdown` rather than `click`, so opening *another* picker closes this
  // one before that one opens; and `focusin` so tabbing out closes it too.
  // Both are bound only while the list is open.
  //
  // ⚠️ Both refs, the field's wrapper *and* the portalled list. The list is
  // rendered into `<body>`, so it is not inside `rootRef`, and a test that
  // asked only the wrapper read every press on an option as a press *outside*
  // — closing the list on `pointerdown`, before the `pointerup` that commits
  // could arrive. The keyboard kept working because it never presses, which
  // is exactly the shape of "the dropdown can only be chosen with the
  // keyboard". Same lesson the store menu carries in CLAUDE.md.
  useEffect(() => {
    if (!open) return;

    const away = (event: Event) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (rootRef.current?.contains(target) || listRef.current?.contains(target))
      ) {
        return;
      }
      setOpen(false);
      setQuery("");
      setActive(0);
    };

    document.addEventListener("pointerdown", away);
    document.addEventListener("focusin", away);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("focusin", away);
    };
  }, [open]);

  // Keep the highlighted row on screen. `block: "nearest"` so arrowing onto an
  // already-visible row does not scroll the list at all — only the rows at the
  // edges move it, which is what makes a held-down arrow key readable.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    listRef.current?.children[activeIndex]?.scrollIntoView({
      block: "nearest",
    });
  }, [open, activeIndex]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // Tab and Escape still work: leaving the field is not a choice.
    if (loading && event.key !== "Tab" && event.key !== "Escape") return;
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        if (!open) {
          setOpen(true);
          return;
        }
        if (!matches.length) return;
        const step = event.key === "ArrowDown" ? 1 : -1;
        // Wraps: reaching the end of a sixty-row list from the top is one press
        // this way and sixty the other.
        const next = (activeIndex + step + matches.length) % matches.length;
        // The keyboard never lands on a row the scroll has not drawn yet.
        if (next >= limit) setLimit(Math.ceil((next + 1) / PAGE) * PAGE);
        setActive(next);
        return;
      }
      case "Home":
        if (open) {
          event.preventDefault();
          setActive(0);
        }
        return;
      case "End":
        if (open && matches.length) {
          event.preventDefault();
          setLimit(matches.length);
          setActive(matches.length - 1);
        }
        return;
      case "Enter":
        if (open && activeIndex >= 0) {
          event.preventDefault();
          commit(matches[activeIndex].value);
        }
        return;
      case "Escape":
        if (open) {
          // Stopped here so one press dismisses one layer: the wizards and the
          // product editor are modals, and Escape should close the list before
          // it closes the dialog the list is sitting in.
          event.preventDefault();
          event.stopPropagation();
          close();
        }
        return;
      case "Tab":
        if (open) close();
        return;
      default:
    }
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <div ref={fieldRef} className="relative">
        <Search
          className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted"
          aria-hidden
        />

        <input
          id={id}
          ref={inputRef}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-expanded={listOpen}
          aria-controls={listOpen ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={
            listOpen && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined
          }
          aria-busy={loading || undefined}
          disabled={disabled}
          readOnly={loading}
          // Closed it is a label, open it is a query. Derived both ways, so
          // there is nothing to re-sync when `value` changes underneath it.
          value={listOpen ? query : shownLabel}
          placeholder={listOpen ? searchPlaceholder : placeholder}
          onChange={(event) => {
            setQuery(event.target.value);
            setLimit(PAGE);
            setActive(0);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          // The two paddings clear the furniture on either side rather than
          // approximately clearing it. Start: the glyph is inset 12px and is
          // 16px wide, so it ends at 28px and `ps-10` (40px) leaves the same
          // 12px of air on its inner edge as on its outer one. End: the tray is
          // inset 8px and runs 42px (24px clear button + 2px gap + 16px
          // chevron), so it ends at 50px and `pe-16` (64px) keeps a truncated
          // model name's ellipsis off it.
          className={cn(controlBase, "truncate ps-10 pe-16")}
        />

        <span className="absolute inset-y-0 end-2 flex items-center gap-0.5">
          {value && !disabled && !loading && (
            <button
              type="button"
              aria-label={clearLabel}
              onClick={() => {
                commit(null);
                inputRef.current?.focus();
              }}
              className="flex size-6 items-center justify-center rounded-full text-muted transition-colors hover:bg-subtle hover:text-ink"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          )}
          <PickerGlyph open={listOpen} loading={loading} />
        </span>
        {loading && <PickerBusyLine />}
      </div>

      {listOpen && box &&
        createPortal(
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          style={popoverStyle(box)}
          className={cn(popoverPanel, "py-1")}
          /* Same scroll-lock trap as `Select`: this panel is portalled out of
             the dialog that opened it, so Radix cancels every wheel and touch
             over it and only the scrollbar is left working. */
          {...underLock}
          onScroll={(event) => {
            const list = event.currentTarget;
            if (limit < matches.length && list.scrollTop + list.clientHeight >= list.scrollHeight - 160) {
              setLimit((current) => current + PAGE);
            }
          }}
        >
          {matches.length === 0 && (
            // Deliberately not `role="option"`: there is nothing here to
            // choose, and a listbox holding one option would announce "1 of 1"
            // to a screen reader when the honest answer is none.
            <li className="px-4 py-3 text-[0.82rem] font-medium text-muted">
              {emptyLabel}
            </li>
          )}

          {matches.slice(0, limit).map((option, index) => {
            const isActive = index === activeIndex;
            const isSelected = option.value === value;

            return (
              <li
                key={option.value}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={isSelected}
                // The press is captured rather than acted on, and
                // `preventDefault` keeps the field's focus where it is — a
                // `click` would first fire the focus change that closes the
                // list out from under it. See `press` above for why the
                // release is what commits.
                onPointerDown={(event) => {
                  event.preventDefault();
                  press.current = {
                    x: event.clientX,
                    y: event.clientY,
                    value: option.value,
                  };
                }}
                onPointerUp={(event) => {
                  const start = press.current;
                  press.current = null;
                  if (!start || start.value !== option.value) return;
                  const moved =
                    Math.abs(event.clientX - start.x) > DRAG_SLOP ||
                    Math.abs(event.clientY - start.y) > DRAG_SLOP;
                  if (moved) return;
                  commit(option.value);
                }}
                // Hover only: a touch drag fires this for every row it
                // crosses, so the highlight would chase the finger and make a
                // scroll read as a press.
                onPointerMove={(event) => {
                  if (event.pointerType === "mouse") setActive(index);
                }}
                className={cn(
                  "flex cursor-pointer items-center gap-2 px-4 py-2.5 text-[0.85rem] font-medium transition-colors",
                  isActive ? "bg-subtle text-ink" : "text-ink",
                  isSelected && "font-bold text-brand",
                )}
              >
                <span className="min-w-0 flex-1 truncate">
                  {option.label}
                  {option.hint && (
                    <span className="ms-2 text-[0.75rem] font-medium text-muted">
                      {option.hint}
                    </span>
                  )}
                </span>
                {isSelected && (
                  <Check className="size-3.5 shrink-0" aria-hidden />
                )}
              </li>
            );
          })}
        </ul>,
          document.body,
        )}
    </div>
  );
}

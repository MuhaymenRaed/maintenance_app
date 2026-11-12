"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import {
  popoverPanel,
  popoverStyle,
  usePopoverAnchor,
} from "@/lib/hooks/use-popover-anchor";
import { useScrollUnderLock } from "@/lib/hooks/use-scroll-under-lock";
import { swallowNextClick } from "@/lib/ui/swallow-click";
import { cn } from "@/lib/utils";

/**
 * A one-of-many picker that looks like the rest of the site.
 *
 * ---------------------------------------------------------------------------
 * Why this replaced the native control, and what it cost
 * ---------------------------------------------------------------------------
 * A `<select>` renders the *platform's* list, and CSS reaches almost none of
 * it: on Windows that is a white popup with a system-blue highlight, drawn over
 * a dark dialog, in the operating system's font, ignoring every token in
 * `globals.css`. The field could be styled and the list could not, so the two
 * halves of one control disagreed — which is most visible in the back office,
 * where a dense form of matching fields opens onto something from another
 * decade.
 *
 * The native control is genuinely good at things this has to re-earn, and each
 * one is implemented here rather than waved at:
 *
 * - **Keyboard.** Up/Down move the active row, Home/End jump, Enter and Space
 *   commit, Escape cancels, and typing letters jumps to the next option that
 *   starts with them — the type-ahead buffer resets after 600ms, which is what
 *   the platform does.
 * - **Screen readers.** The trigger is a `combobox` owning a `listbox`, and the
 *   active row is named by `aria-activedescendant` rather than by moving focus,
 *   so the trigger keeps it and the relationship stays announced.
 * - **RTL.** Every box is placed with logical properties; only the portal's
 *   coordinates are physical, because `getBoundingClientRect` has no
 *   flow-relative form.
 * - **Small screens.** The list is capped and scrolls, and it flips above the
 *   trigger when there is no room below — which is the case a dialog near the
 *   fold hits constantly.
 *
 * ---------------------------------------------------------------------------
 * Why it is portalled
 * ---------------------------------------------------------------------------
 * Every dialog in the dashboard scrolls its own body, and a listbox positioned
 * inside one is clipped by it — the same fault the showcase menu had inside a
 * product card. Rendering into `<body>` at measured coordinates is the only
 * placement that cannot be cut off by an ancestor's `overflow`.
 *
 * ⚠️ **A portalled listbox must re-declare `pointer-events: auto`.** Radix's
 * modal `Dialog` — which is the cart drawer and every dashboard editor — puts
 * `pointer-events: none` on `<body>` for as long as it is open and hands the
 * dialog's own content `auto` back. This list is a child of `<body>` and *not*
 * of that content, so it inherited the block: the options could not be clicked
 * and the list could not be scrolled with a wheel, while the keyboard path kept
 * working perfectly because focus never leaves the trigger inside the dialog.
 * That is the exact shape of the report — the province picker in the cart and
 * the role picker in the staff editor "only work with the keyboard" — and it
 * is not something the placement code can notice, because nothing about the
 * measurement is wrong.
 *
 * `SearchableSelect` is still the right control for a list long enough that
 * finding a row beats reading them all; this is for the short flat ones.
 */

export type SelectOption = {
  value: string;
  label: string;
  /** Drawn quietly after the label — a count, a group, a code. */
  hint?: string;
  disabled?: boolean;
};

/** How long a type-ahead buffer survives, matching the platform's own. */
const TYPEAHEAD_MS = 600;

/**
 * How far a pointer may travel and still count as a press rather than a drag.
 *
 * Shared by both portalled pickers. Below this a tap on a phone is a tap; above
 * it the gesture was a scroll and must choose nothing.
 */
export const DRAG_SLOP = 8;

/**
 * The picker's end glyph: a chevron, or a spinner while its choice is acted on.
 *
 * ⚠️ The spinner's fade and its spin are on two elements because each is an
 * `animation`, and one element carries one `animation` property — put both
 * on the icon and the delayed fade silently replaces the spin.
 */
export function PickerGlyph({
  open,
  loading,
}: {
  open: boolean;
  loading?: boolean;
}) {
  return (
    <span aria-hidden className="pointer-events-none relative size-4 shrink-0">
      <ChevronDown
        className={cn(
          "absolute inset-0 size-4 text-muted transition-transform duration-150",
          open && "rotate-180",
          loading && "picker-busy-out",
        )}
      />
      {loading && (
        <span className="picker-busy-in absolute inset-0">
          <Loader2 className="size-4 animate-spin text-brand" />
        </span>
      )}
    </span>
  );
}

/**
 * The site's indeterminate sweep along a busy field's foot.
 *
 * Inset rather than edge to edge, so its ends never poke past the field's
 * rounded corners — which also spares the trigger an `overflow-hidden` that
 * would have to come and go with the state.
 */
export function PickerBusyLine() {
  return (
    <span
      aria-hidden
      className="picker-busy-in pointer-events-none absolute inset-x-3 bottom-0 h-0.5 overflow-hidden rounded-full"
    >
      <span className="animate-indeterminate block h-full w-1/3 rounded-full bg-brand" />
    </span>
  );
}

export function Select({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  loading,
  className,
  triggerClassName,
  "aria-label": ariaLabel,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Shown when `value` matches no option — a blank first row, in effect. */
  placeholder?: string;
  disabled?: boolean;
  /**
   * The last choice is still being acted on — the page it filters, or the list
   * it fills, has not arrived. The control takes no further choice until it
   * has, or a second pick races the first and the reader ends up on whichever
   * happened to answer last.
   *
   * ⚠️ Not `disabled`. A disabled button drops keyboard focus to `<body>` on
   * the very press that made it busy, and greys out a value the reader has
   * just chosen. It stays focusable and readable and simply does not answer.
   *
   * The lock is immediate and the drawing is not: the spinner fades in after
   * 180ms (`.picker-busy-in`), so an answer that comes back quickly never
   * flashes one. That delay is CSS rather than a timer so there is no state to
   * clear if the answer beats it.
   */
  loading?: boolean;
  className?: string;
  /** Overrides the field skin, for the places that carry their own. */
  triggerClassName?: string;
  "aria-label"?: string;
  id?: string;
}) {
  const listId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const typed = useRef({ buffer: "", at: 0 });

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  /*
   * Where a press started, so a *drag* is not read as a choice.
   *
   * ⚠️ This is the whole reason the dropdowns could not be scrolled with a
   * finger. The list commits on `pointerup`, which is right for a mouse — the
   * trigger's own `pointerdown` listener closes the panel, so a `click` would
   * arrive after the row it was aimed at had already gone. On a touch screen
   * the *same* event ends every scroll gesture, over whatever row the finger
   * happens to be resting on. So dragging the province list picked a province
   * and shut the panel, and the list appeared frozen: the only way to reach an
   * option below the fold was to guess.
   *
   * A pointer that has moved more than a few pixels was a scroll. The
   * threshold is deliberately generous — nobody taps a list row to within 2px
   * on a phone, and a tap that drifts 8px is still a tap.
   */
  const press = useRef<{ x: number; y: number; index: number } | null>(null);
  // Portalled and `fixed`, from one shared implementation — see the hook for
  // why an `absolute` list cannot work inside this app's dialogs.
  const listOpen = open && !loading;
  const box = usePopoverAnchor(trigger, listOpen);
  // Wheel and touch, for a panel a dialog's scroll lock would otherwise
  // freeze. See the hook — the cause is outside this codebase.
  const underLock = useScrollUnderLock();

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (trigger.current?.contains(target) || list.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  // Keeps the active row in view while arrowing through a list taller than its
  // box. `block: "nearest"` so it only scrolls when it has to.
  useEffect(() => {
    if (!open) return;
    list.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function commit(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    // ⚠️ Before the panel closes. The press that chose this row has not
    // finished: a `click` follows the `pointerup` that got us here, and by
    // the time it is dispatched this list is gone — so it lands on whatever
    // was underneath it. On the settings page that is the theme and language
    // rows, so picking a province also flipped the theme.
    swallowNextClick();
    onChange(option.value);
    setOpen(false);
    trigger.current?.focus();
  }

  function step(from: number, delta: number) {
    let next = from;
    for (let i = 0; i < options.length; i += 1) {
      next = (next + delta + options.length) % options.length;
      if (!options[next].disabled) return next;
    }
    return from;
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (loading) {
      // Swallowed, not ignored: an unhandled Space on a button is a click.
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
      }
      return;
    }
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        setActive(selectedIndex >= 0 ? selectedIndex : 0);
        setOpen(true);
      }
      return;
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActive((index) => step(index, 1));
        return;
      case "ArrowUp":
        event.preventDefault();
        setActive((index) => step(index, -1));
        return;
      case "Home":
        event.preventDefault();
        setActive(step(options.length - 1, 1));
        return;
      case "End":
        event.preventDefault();
        setActive(step(0, -1));
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        commit(active);
        return;
      case "Escape":
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
        return;
      case "Tab":
        setOpen(false);
        return;
    }

    // Type-ahead. One printable character at a time, accumulated while the
    // typing is continuous — "sa" finds Samsung where "s" then "a" would land
    // on Samsung and then on Apple.
    if (event.key.length !== 1 || event.metaKey || event.ctrlKey) return;
    const now = Date.now();
    const buffer =
      now - typed.current.at > TYPEAHEAD_MS
        ? event.key
        : typed.current.buffer + event.key;
    typed.current = { buffer, at: now };
    const needle = buffer.toLowerCase();
    const found = options.findIndex(
      (option) =>
        !option.disabled && option.label.toLowerCase().startsWith(needle),
    );
    if (found >= 0) setActive(found);
  }

  return (
    <div className={cn("relative", className)}>
      <button
        id={id}
        ref={trigger}
        type="button"
        role="combobox"
        aria-controls={listId}
        aria-expanded={listOpen}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        aria-activedescendant={listOpen ? `${listId}-${active}` : undefined}
        aria-busy={loading || undefined}
        disabled={disabled}
        onClick={() => {
          if (loading) return;
          setActive(selectedIndex >= 0 ? selectedIndex : 0);
          setOpen((state) => !state);
        }}
        onKeyDown={onKeyDown}
        className={cn(
          "relative flex w-full cursor-pointer items-center justify-between gap-2 text-start",
          triggerClassName,
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <span className={cn("truncate", !selected && "text-muted")}>
          {selected?.label ?? placeholder ?? ""}
        </span>
        <PickerGlyph open={listOpen} loading={loading} />
        {loading && <PickerBusyLine />}
      </button>

      {listOpen && box
        ? createPortal(
            <div
              ref={list}
              id={listId}
              role="listbox"
              // `fixed`, in `<body>`: see the note above on why an ancestor's
              // `overflow` must not get a vote.
              style={popoverStyle(box)}
              className={cn(popoverPanel, "p-1")}
              /*
                ⚠️ Without this the list is scrollable **only by dragging its
                scrollbar** whenever it is opened from inside a dialog — which
                on the storefront is the province picker in the cart drawer,
                i.e. the one every customer meets. Radix's scroll lock cancels
                wheel and touchmove on anything portalled outside it, and this
                panel is portalled on purpose. See `useScrollUnderLock`.
              */
              {...underLock}
            >
              {options.map((option, index) => {
                const isSelected = option.value === value;
                return (
                  <div
                    key={option.value}
                    id={`${listId}-${index}`}
                    data-index={index}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={option.disabled}
                    // Pointer, not click: the trigger's own `pointerdown`
                    // listener closes the list, and a `click` would arrive
                    // after the row had already gone. See `press` above for
                    // why the release is qualified rather than taken at face
                    // value.
                    onPointerDown={(event) => {
                      press.current = {
                        x: event.clientX,
                        y: event.clientY,
                        index,
                      };
                    }}
                    onPointerUp={(event) => {
                      const start = press.current;
                      press.current = null;
                      if (!start) return;
                      const moved =
                        Math.abs(event.clientX - start.x) > DRAG_SLOP ||
                        Math.abs(event.clientY - start.y) > DRAG_SLOP;
                      // Released on a different row than it started on, or
                      // dragged: that was a scroll, and a scroll chooses
                      // nothing.
                      if (moved || start.index !== index) return;
                      commit(index);
                    }}
                    // Hover only. A touch drag fires `pointermove` for every
                    // row it crosses, so this would repaint the whole list as
                    // the finger travelled — the highlight chasing the gesture
                    // reads as the list being pressed rather than scrolled.
                    onPointerMove={(event) => {
                      if (event.pointerType === "mouse") setActive(index);
                    }}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-[8px] px-2.5 py-2 text-[0.82rem] font-bold transition-colors",
                      option.disabled && "cursor-not-allowed opacity-45",
                      index === active && !option.disabled
                        ? "bg-brand/10 text-brand"
                        : "text-ink",
                    )}
                  >
                    <Check
                      aria-hidden
                      className={cn(
                        "size-3.5 shrink-0",
                        isSelected ? "text-brand" : "opacity-0",
                      )}
                    />
                    <span className="truncate">{option.label}</span>
                    {option.hint ? (
                      <span className="ms-auto shrink-0 text-[0.7rem] font-semibold text-muted">
                        {option.hint}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

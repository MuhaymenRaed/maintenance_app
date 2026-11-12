"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, ChevronDown, Info, Loader2, Trash2, X } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select, type SelectOption } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { dialogOverlay } from "@/components/ui/dialog-chrome";
import {
  caretAfterValueChars,
  countValueChars,
  deleteThroughSeparator,
  readMoney,
  showMoney,
} from "@/lib/data/money-field";

/**
 * The parts every dashboard editor is made of.
 *
 * Extracted once the catalogue editor was joined by four more — branches,
 * technicians, offers, repair quotes. Each had the same Radix shell, the same
 * label-over-control field, the same two-column grid and the same save/delete
 * footer, and five copies of a modal is five places for the RTL translate fix
 * or the focus ring to be forgotten in one of them.
 *
 * Nothing here knows what it is editing. The dialog takes a title and a footer;
 * the fields take a label and a child.
 *
 * ---------------------------------------------------------------------------
 * Why the chrome is quiet
 * ---------------------------------------------------------------------------
 * These forms are long — the catalogue editor alone has twenty fields — and a
 * long form read many times a day is the wrong place to spend contrast. So the
 * dialog spends its emphasis on exactly two things: the field the cursor is in,
 * and the button that commits. Everything else is a hairline.
 *
 * Concretely: separators are `--line` at 70% rather than full strength, section
 * headings are ink-weight text rather than boxed panels, and inputs sit on
 * `--canvas` instead of `--surface` so a field reads as a recess in the dialog
 * rather than as another white box drawn on a white box. That last one is why
 * the fields are legible at all in dark mode, where surface-on-surface was two
 * greys three points apart.
 */

/**
 * One input skin, shared by every `input`, `select` and `textarea` in the back
 * office.
 *
 * The focus treatment is a **ring plus a border**, not a border alone. A 1px
 * colour change on a field that is already bordered is nearly invisible on a
 * dense form, and "which box am I typing in" is the single question the focus
 * state exists to answer.
 */
export const input =
  "w-full rounded-control border border-line bg-canvas px-3.5 py-2.5 text-[0.85rem] font-medium text-ink outline-none transition-[border-color,box-shadow] placeholder:font-medium placeholder:text-muted/70 focus-visible:border-brand focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--brand)_15%,transparent)] disabled:cursor-not-allowed disabled:opacity-60";

/**
 * A picker, with the field skin on its trigger.
 *
 * The list is `components/ui/select.tsx` rather than a native `<select>`,
 * because a native one draws the *platform's* popup: on Windows a white panel
 * with a system-blue row, over a dark dialog, in the OS font, ignoring every
 * token in `globals.css`. The field could be styled and its list could not, so
 * one control looked like two.
 *
 * That component re-implements what the platform gave away for free — keyboard
 * stepping, type-ahead, `aria-activedescendant`, RTL placement, flipping above
 * the trigger near the fold — which is why it is one file and not a `<select>`
 * with a stylesheet on it. `SearchableSelect` is still the right control for a
 * list long enough that finding a row beats reading them all.
 */
export function SelectField({
  value,
  onChange,
  options,
  placeholder,
  disabled,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <Select
      value={value}
      onChange={onChange}
      options={options}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      className={className}
      triggerClassName={input}
    />
  );
}

/**
 * A numeric field that can be typed over.
 *
 * ---------------------------------------------------------------------------
 * The bug this exists to fix
 * ---------------------------------------------------------------------------
 * A controlled `<input type="number" value={0}>` shows `0`. Put the caret after
 * it, type `7`, and the field reads `07` — and *stays* that way. It is not a
 * rendering delay: React's controlled-input update for `type="number"` compares
 * the DOM value against the prop with **loose** equality, and `"07" != 7` is
 * false, so it decides nothing needs writing and leaves the string alone. The
 * value in state is 7 and the value on screen is 07, which is the worst version
 * of this to ship because everything downstream is correct.
 *
 * It bit every price and discount field in the dashboard. The only way to enter
 * 7 was to hold the spinner, or to select the zero first — which nobody does,
 * because a field showing `0` looks empty.
 *
 * So the leading zeros are stripped from the *DOM* value in the handler, not
 * just from what is reported upward. Writing to `event.target.value` inside
 * `onChange` is what React will not do for us here.
 *
 * `type="number"` is kept rather than swapped for `inputMode="numeric"` on a
 * text field, because the spinner buttons are how a lot of this back office is
 * actually driven, and a phone's numeric keypad comes from `inputMode` which is
 * set here anyway.
 */
type NumberInputShape = {
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  /**
   * Fired when the field loses focus, after any empty-to-zero normalisation.
   *
   * The repair and buy-back boards save a quote on blur rather than per
   * keystroke, on the grounds that a price is a decision and not a live figure.
   * It is `onCommit` and not `onBlur` so it cannot be confused with the raw DOM
   * event this component handles itself.
   */
  onCommit?: () => void;
};

/**
 * `clearable` decides whether an empty field is `null` or `0`, and the two
 * shapes are a union rather than one signature with a flag so the *caller* is
 * typed exactly. Most of these fields are quantities and an empty one is zero;
 * a few are genuinely optional — a branch's latitude, an offer's minimum cart
 * total — and there `0` is a different claim from "not set": a branch at 0°N
 * 0°E is in the Atlantic, and a 0 IQD minimum applies to an empty basket.
 *
 * Without the union every one of the fifteen required fields would have to
 * write `value ?? 0` to satisfy a null it can never receive.
 */
type NumberInputProps =
  | (NumberInputShape & {
      clearable: true;
      value: number | null;
      onChange: (value: number | null) => void;
    })
  | (NumberInputShape & {
      clearable?: false;
      value: number;
      onChange: (value: number) => void;
    });

export function NumberInput({
  value,
  onChange,
  clearable = false,
  min = 0,
  max,
  step,
  className,
  disabled,
  placeholder,
  onCommit,
}: NumberInputProps) {
  // One cast at the boundary rather than fifteen at the call sites: the union
  // above is what callers see, and inside there is only one implementation.
  const emit = onChange as (value: number | null) => void;
  return (
    <input
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      placeholder={placeholder}
      value={value ?? ""}
      onChange={(event) => {
        const raw = event.target.value;
        if (raw === "") {
          emit(clearable ? null : 0);
          return;
        }
        // `0012` → `12`, but `0` and `0.5` are left alone: the lookahead only
        // matches when a digit follows, so a bare zero and a decimal survive.
        const cleaned = raw.replace(/^(-?)0+(?=\d)/, "$1");
        if (cleaned !== raw) event.target.value = cleaned;
        emit(Number(cleaned) || 0);
      }}
      // A required field left blank should read as the zero it is about to be
      // saved as rather than as an unanswered question.
      onBlur={(event) => {
        if (!clearable && event.target.value === "") emit(0);
        onCommit?.();
      }}
      dir="ltr"
      data-numeric
      className={cn(input, className)}
    />
  );
}

/**
 * A price field — grouped in threes as it is typed.
 *
 * ---------------------------------------------------------------------------
 * Why money is not a `NumberInput`
 * ---------------------------------------------------------------------------
 * ⚠️ **`<input type="number">` cannot show a separator, and it does worse than
 * refuse one.** A value the browser cannot parse as a number is not rejected
 * character by character — the whole control reports `value === ""`, so a
 * price pasted or typed as `1,495,013` arrives at the handler as *nothing*,
 * emits 0, and the figure is gone with no error anywhere. That is the shop's
 * report of 2026-11-04: "I've updated the number and it is not updated."
 *
 * So the money fields leave `type="number"` behind and the counts keep it.
 * That split is the right way round rather than a compromise:
 *
 * - **Money is long and is read in groups.** 1495013 is eight glyphs nobody
 *   can check at a glance, and it is the one figure on these forms that is
 *   wrong in units of a hundred thousand. The spinner is useless on it — a
 *   price is typed, never nudged.
 * - **A count is short and *is* nudged.** Quantity, months, days, a sort
 *   order: the spinner is how a lot of this back office is driven, and
 *   grouping would never fire on three digits anyway.
 *
 * Everything else about the two is deliberately identical — the same skin, the
 * same `clearable` union, the same `onCommit` on blur, the same leading-zero
 * rule. A reader should not be able to tell which kind of field they are in
 * until they look at what is in it.
 *
 * ⚠️ **The box is written to directly and the caret put back by hand.** React
 * will not reconcile a `value` prop against a DOM value it considers equal,
 * and even where it would, re-rendering a formatted field moves the caret to
 * the end on every keystroke — which makes a grouped field unusable for
 * editing. `lib/data/money-field.ts` owns the arithmetic and is tested on its
 * own, because every failure in it is silent: the field keeps working and
 * saves the wrong figure.
 */
type MoneyInputProps =
  | (NumberInputShape & {
      clearable: true;
      value: number | null;
      onChange: (value: number | null) => void;
    })
  | (NumberInputShape & {
      clearable?: false;
      value: number;
      onChange: (value: number) => void;
    });

export function MoneyInput({
  value,
  onChange,
  clearable = false,
  min = 0,
  className,
  disabled,
  placeholder,
  onCommit,
}: MoneyInputProps) {
  const emit = onChange as (value: number | null) => void;

  /*
   * The box holds a draft and the parent holds a figure, so the two have to be
   * reconciled — but only when the *parent* moves. A plain prop-to-state copy
   * would reformat under the caret on every keystroke; this notices a change
   * the field did not make, which is the catalogue editor's "use the parts
   * total" button and the dialog opening on another row.
   *
   * Set during render rather than in an effect: `react-hooks/set-state-in-effect`
   * is an error here, and an effect would paint the stale draft for a frame.
   */
  /*
   * ⚠️ Zero is drawn as the placeholder, never as a figure in the box.
   *
   * The shop's instruction, 2026-11-05: "the zero value must not shown as a
   * number but as placeholder and the numeric field remain empty till the
   * admin fill it". A box already holding `0` reads as an answer somebody
   * gave, and typing into it means deleting that answer first.
   *
   * ⚠️ Required fields only. On a `clearable` one, empty is `null` and a typed
   * 0 is a real, different answer — a repair priced at nothing is not a
   * repair nobody has priced — so it stays visible there.
   */
  const shown = (figure: number | null) =>
    figure === 0 && !clearable ? "" : showMoney(figure);
  const [text, setText] = useState(() => shown(value));
  const [held, setHeld] = useState<number | null>(value);
  if (value !== held) {
    setHeld(value);
    setText(shown(value));
  }

  function commit(next: string) {
    const draft = readMoney(next, { allowNegative: min < 0 });
    setText(draft.text);
    setHeld(draft.value);
    emit(clearable ? draft.value : (draft.value ?? 0));
    return draft;
  }

  return (
    <input
      type="text"
      // `decimal` rather than `numeric`: the second draws a keypad with no
      // decimal point on iOS, and a variant override can carry one.
      inputMode="decimal"
      autoComplete="off"
      disabled={disabled}
      placeholder={placeholder ?? "0"}
      value={text}
      onKeyDown={(event) => {
        if (event.key !== "Backspace" && event.key !== "Delete") return;
        const el = event.currentTarget;
        const cut = deleteThroughSeparator(
          el.value,
          el.selectionStart ?? 0,
          el.selectionEnd ?? 0,
          event.key,
        );
        if (!cut) return;
        event.preventDefault();
        const draft = commit(cut.text);
        const before = countValueChars(cut.text.slice(0, cut.caret));
        el.value = draft.text;
        const caret = caretAfterValueChars(draft.text, before);
        el.setSelectionRange(caret, caret);
      }}
      onChange={(event) => {
        const el = event.currentTarget;
        const before = countValueChars(el.value.slice(0, el.selectionStart ?? el.value.length));
        const draft = commit(el.value);
        el.value = draft.text;
        const caret = caretAfterValueChars(draft.text, before);
        el.setSelectionRange(caret, caret);
      }}
      // A required field left blank is saved as zero, and stays visibly
      // empty — the placeholder says "0" for it.
      onBlur={(event) => {
        if (!clearable && readMoney(event.target.value).value === null) {
          setText("");
          setHeld(0);
          emit(0);
        } else if (!clearable && readMoney(event.target.value).value === 0) {
          setText("");
        }
        onCommit?.();
      }}
      dir="ltr"
      data-numeric
      className={cn(input, className)}
    />
  );
}

/**
 * A field that is a percentage in one mode and an amount of money in the
 * other — a coupon, a rail discount, a reward. The percentage stays a count
 * (short, nudged, capped at 100); the amount is grouped in threes.
 */
export function AmountInput({
  percent,
  ...props
}: NumberInputProps & { percent: boolean }) {
  return percent ? (
    <NumberInput {...(props as NumberInputProps)} />
  ) : (
    <MoneyInput {...(props as MoneyInputProps)} />
  );
}

export function EntityDialog({
  title,
  subtitle,
  closeLabel,
  onClose,
  children,
  footer,
  width = 620,
  /** A hairline of colour at the top — a status tone, a brand accent. */
  accent,
}: {
  title: string;
  subtitle?: string;
  closeLabel: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
  width?: number;
  accent?: string;
}) {
  return (
    <Dialog.Root open onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlay} />
        <Dialog.Content
          aria-describedby={undefined}
          /*
           * ⚠️ **`dvh`, not `vh`** — every editor in the back office is read
           * on a phone at the counter, and `100vh` on mobile Chrome and Safari
           * is the **large** viewport: the height the page would have with the
           * browser's own address bar hidden. At 92vh the footer — which holds
           * Save and Cancel — sat under that bar until the reader scrolled the
           * page, which inside a scroll-locked dialog they cannot. The
           * storefront has used `dvh` everywhere for exactly this since the
           * iOS pass; `EntityDialog` was the one that never followed.
           *
           * ⚠️ And a fixed gutter rather than `95vw`. A percentage shrinks
           * with the screen, so the margin that reads as deliberate at 1280px
           * is 9px at 390 — a dialog that looks wedged against both edges on
           * the device it is mostly used on. `calc(100vw - 1.5rem)` is the
           * same 12px-a-side the rating dialog and the story panel already
           * take.
           */
          className="fixed start-1/2 top-1/2 z-80 flex max-h-[92dvh] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-panel border border-line bg-surface shadow-lift focus:outline-none data-[state=open]:[animation:dialog-content-in_180ms_ease-out] rtl:translate-x-1/2"
          // The shared keyframe translates by a fixed -50%; under RTL the
          // element is offset the other way, so the custom property flips it.
          style={{
            ["--dialog-content-x" as string]: "-50%",
            width: `min(${width}px, calc(100vw - 1.5rem))`,
          }}
        >
          {accent && (
            <span
              className="h-[3px] shrink-0"
              style={{ background: accent }}
              aria-hidden
            />
          )}

          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line/70 px-6 py-4 max-sm:px-4">
            <div className="min-w-0">
              <Dialog.Title className="text-[1.02rem] font-black leading-tight tracking-[-0.02em] text-ink">
                {title}
              </Dialog.Title>
              {subtitle && (
                <p className="mt-0.5 truncate text-[0.75rem] font-medium text-muted">
                  {subtitle}
                </p>
              )}
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label={closeLabel}
                className="-me-1.5 -mt-1 flex size-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-subtle hover:text-ink"
              >
                <X className="size-4" aria-hidden />
              </button>
            </Dialog.Close>
          </header>

          {/* Sections separate themselves with a hairline (see `Section`), so
              the scroller only owns the outer padding. */}
          <div className="flex-1 overflow-y-auto px-6 py-5 max-sm:px-4">
            {children}
          </div>

          {/*
            ⚠️ On a phone the footer's own buttons are pushed to the end by
            `ms-auto` inside `EditorFooter`, which at 390px leaves Save, Cancel
            and Delete fighting over one line and wrapping into three. Padding
            comes down and the gap closes so the three fit on two rows rather
            than three, and `items-stretch` lets a wrapped row fill the width
            instead of hanging at one end.
          */}
          <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line/70 bg-subtle/40 px-6 py-4 max-sm:gap-1.5 max-sm:px-3 max-sm:py-3">
            {footer}
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * The footer every editor ends with: an error line, a delete on the far side,
 * and cancel/save together.
 *
 * `onDelete` absent hides the button entirely rather than disabling it — the
 * roles that may not delete should not be shown the act at all.
 *
 * ⚠️ **`onDelete` fires only after the reader has confirmed in a dialog.** It
 * used to be called on the first press, and every caller carried its own
 * `confirming` flag, its own "if not armed, arm and return" branch, and its own
 * job of clearing that flag on cancel — five copies of the same six lines, all
 * free to drift, and all defeated by a double press. The state lives here now
 * and the callers just delete.
 */
export function EditorFooter({
  error,
  pending,
  saveLabel,
  cancelLabel,
  deleteLabel,
  confirmDeleteLabel,
  confirmDeleteBody,
  onCancel,
  onSave,
  onDelete,
  disabled,
}: {
  error?: string | null;
  pending: boolean;
  saveLabel: string;
  cancelLabel: string;
  deleteLabel?: string;
  /** The dialog's confirming button. Falls back to `deleteLabel`. */
  confirmDeleteLabel?: string;
  /** One sentence naming what is about to be deleted. */
  confirmDeleteBody?: string;
  onCancel: () => void;
  onSave: () => void;
  onDelete?: () => void;
  disabled?: boolean;
}) {
  const [asking, setAsking] = useState(false);

  return (
    <>
      {error && (
        <p
          role="alert"
          className="w-full rounded-card border border-brand/25 bg-brand/8 px-3.5 py-2.5 text-[0.78rem] font-bold text-brand"
        >
          {error}
        </p>
      )}

      {onDelete && (
        <>
          <button
            type="button"
            onClick={() => setAsking(true)}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-control border border-brand/30 px-3.5 py-2.5 text-[0.78rem] font-extrabold text-brand transition-colors hover:bg-brand/8 disabled:opacity-50"
          >
            <Trash2 className="size-3.5" aria-hidden />
            {deleteLabel}
          </button>

          <ConfirmDialog
            open={asking}
            title={deleteLabel ?? ""}
            body={confirmDeleteBody}
            confirmLabel={confirmDeleteLabel ?? deleteLabel ?? ""}
            cancelLabel={cancelLabel}
            pending={pending}
            onCancel={() => setAsking(false)}
            onConfirm={() => {
              setAsking(false);
              onDelete();
            }}
          />
        </>
      )}

      <div className="ms-auto flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-control px-4 py-2.5 text-[0.78rem] font-extrabold text-muted transition-colors hover:bg-subtle hover:text-ink"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={pending || disabled}
          className="inline-flex items-center gap-2 rounded-control bg-brand px-5 py-2.5 text-[0.78rem] font-extrabold text-white shadow-brand-lift transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
        >
          {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {saveLabel}
        </button>
      </div>
    </>
  );
}

/**
 * A group of fields most people never need, folded away.
 *
 * ---------------------------------------------------------------------------
 * What belongs in here, and what does not
 * ---------------------------------------------------------------------------
 * Exactly one test: **would leaving this field alone produce a correct
 * product?** A slug derives itself from the name, tags are an internal label
 * that nothing on the storefront reads, a sort order has a working default —
 * all three are answerable with "yes", and all three were sitting in the main
 * flow of the catalogue editor between fields that genuinely have to be filled
 * in. Twenty required-looking inputs is how a form stops being read.
 *
 * A price, a category, a name: those never go in here. Folding away something
 * that has to be answered only hides the work.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ `hidden`, not unmounted
 * ---------------------------------------------------------------------------
 * The children stay in the tree and are hidden with the attribute, so their
 * state survives being closed — an admin who types a slug, collapses the
 * panel and saves gets the slug they typed. Unmounting would silently discard
 * it, which is the worst of the three possible behaviours because the form
 * still reports a successful save.
 *
 * It also means the fields are still *findable*: the browser's own in-page
 * search will not reach `[hidden]`, but React's tree and any `required`
 * validation still see them, so nothing can fail validation inside a panel
 * that gives no sign of existing.
 */
export function Disclosure({
  title,
  hint,
  children,
  defaultOpen = false,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="border-t border-line/70 pt-5 first:border-0 first:pt-0 [&+section]:mt-5">
      <button
        type="button"
        onClick={() => setOpen((state) => !state)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-start"
      >
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted transition-transform duration-150",
            open && "rotate-180",
          )}
          aria-hidden
        />
        <span className="min-w-0">
          <span className="block text-[0.85rem] font-extrabold text-ink">
            {title}
          </span>
          {hint && (
            <span className="block text-[0.72rem] font-medium text-muted">
              {hint}
            </span>
          )}
        </span>
      </button>

      {/* `hidden` rather than a conditional — see the note above on why the
          children must not unmount. */}
      <div hidden={!open} className="mt-4 space-y-3.5">
        {children}
      </div>
    </section>
  );
}

/**
 * "There is more of this list than is drawn."
 *
 * ---------------------------------------------------------------------------
 * Why a lid, rather than a taller panel
 * ---------------------------------------------------------------------------
 * Several boards here summarise a set whose size is data rather than design:
 * the voucher vault has 27 denominations and most of them sit at zero, a
 * filter can hold a hundred products, the featured pool is the whole
 * catalogue. Drawing all of any one of them turns a summary into a page, and
 * pushes the thing the reader came to do below the fold.
 *
 * Capping without saying so is worse — a list that silently stops is a list
 * the reader believes is complete. So the count that is *hidden* is on the
 * control, which is the number that decides whether pressing it is worth it;
 * "Show all" says nothing about whether "all" is nine or nine hundred.
 *
 * ⚠️ It reports state, it does not hold it. The caller owns `open` because the
 * caller owns the slicing, and a control that kept its own flag would have to
 * be told the list changed underneath it.
 */
export function Expander({
  open,
  onToggle,
  moreLabel,
  lessLabel,
  className,
}: {
  open: boolean;
  onToggle: () => void;
  /** Already carries the hidden count — "Show 21 more". */
  moreLabel: string;
  lessLabel: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={cn(
        "press inline-flex items-center gap-1.5 text-[0.74rem] font-extrabold transition-colors",
        className,
      )}
    >
      <ChevronDown
        className={cn(
          "size-3.5 shrink-0 transition-transform duration-150",
          open && "rotate-180",
        )}
        aria-hidden
      />
      {open ? lessLabel : moreLabel}
    </button>
  );
}

/**
 * One group of fields.
 *
 * The rule is drawn by the section *above* its heading and suppressed on the
 * first one (`first:border-0`), which is why a dialog can hold six of these
 * without a single explicit divider or a wrapper deciding the spacing for it.
 */
export function Section({
  title,
  hint,
  children,
  /** Right-hand slot for a count, a toggle, a small action. */
  aside,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <section className="space-y-3.5 border-t border-line/70 pt-5 first:border-0 first:pt-0 [&+section]:mt-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-[0.85rem] font-extrabold text-ink">
            <span
              className="size-1.5 shrink-0 rounded-full bg-brand"
              aria-hidden
            />
            {title}
          </h3>
          {hint && (
            <p className="mt-1 text-[0.72rem] font-medium leading-relaxed text-muted">
              {hint}
            </p>
          )}
        </div>
        {aside && <div className="shrink-0">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

export function Grid({
  cols = 2,
  children,
}: {
  cols?: 2 | 3;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid gap-3.5 max-sm:grid-cols-1",
        cols === 2 ? "grid-cols-2" : "grid-cols-3",
      )}
    >
      {children}
    </div>
  );
}

export function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-[0.72rem] font-bold text-muted">
        {label}
        {required && <span className="text-brand"> *</span>}
      </span>
      {children}
      {hint && (
        <span className="block text-[0.66rem] leading-relaxed text-muted">
          {hint}
        </span>
      )}
    </label>
  );
}

/**
 * `Field`'s typography without the `<label>`, for a control that contains its
 * own buttons.
 *
 * ⚠️ `Field` wraps its children in a label, which is right for an input and
 * wrong for a chip list or a picker with a clear button in it: a press on any
 * of those buttons *also* activates the label's implicit control, so removing
 * a chip reopens the adder underneath it. Every `ChipMultiSelect` caller had
 * independently worked that out and reached for `Section` instead, which is
 * the wrong weight for one field among several.
 *
 * It is here rather than copied into a dialog because the five private copies
 * of form-kit's primitives this codebase used to carry had already drifted on
 * the label size and the hint colour — the seam a reader notices and cannot
 * name. One source, several callers.
 */
export function FieldGroup({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="block space-y-1.5">
      <p className="block text-[0.72rem] font-bold text-muted">
        {label}
        {required && <span className="text-brand"> *</span>}
      </p>
      {children}
      {hint && (
        <p className="block text-[0.66rem] leading-relaxed text-muted">{hint}</p>
      )}
    </div>
  );
}

export function Toggle({
  label,
  on,
  onChange,
  tone = "brand",
  disabled,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
  tone?: "brand" | "warning" | "success";
  disabled?: boolean;
}) {
  const accent =
    tone === "warning" ? "warning" : tone === "success" ? "success" : "brand";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cn(
        "inline-flex items-center gap-2 rounded-control border px-3.5 py-2 text-[0.78rem] font-extrabold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        on
          ? accent === "warning"
            ? "border-warning/50 bg-warning/10 text-warning"
            : accent === "success"
              ? "border-success/50 bg-success/10 text-success"
              : "border-brand/50 bg-brand/8 text-brand"
          : "border-line text-muted hover:border-line-strong hover:text-ink",
      )}
    >
      <span
        className={cn(
          "flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors",
          on
            ? accent === "warning"
              ? "bg-warning"
              : accent === "success"
                ? "bg-success"
                : "bg-brand"
            : "bg-line-strong/60",
        )}
      >
        <span
          className={cn(
            "size-3 rounded-full bg-surface transition-transform",
            on && "translate-x-3 rtl:-translate-x-3",
          )}
        />
      </span>
      {label}
    </button>
  );
}

/**
 * A short explanation that belongs *in* the form rather than beside it.
 *
 * Used where a field's effect is not guessable from its name — "tags" being
 * the case that prompted it. A hint under an input is for a format rule; this
 * is for a paragraph, and a paragraph in `Field`'s hint slot sets at 0.66rem
 * and reads as fine print nobody has to follow.
 */
export function Callout({
  title,
  children,
  tone = "info",
}: {
  title?: string;
  children: React.ReactNode;
  tone?: "info" | "warning";
}) {
  return (
    <div
      className={cn(
        "flex gap-2.5 rounded-card border px-3.5 py-3",
        tone === "warning"
          ? "border-warning/30 bg-warning/8"
          : "border-info/25 bg-info/6",
      )}
    >
      <Info
        className={cn(
          "mt-0.5 size-3.5 shrink-0",
          tone === "warning" ? "text-warning" : "text-info",
        )}
        aria-hidden
      />
      <div className="min-w-0 space-y-1">
        {title && (
          <p className="text-[0.75rem] font-extrabold text-ink">{title}</p>
        )}
        <div className="text-[0.72rem] font-medium leading-relaxed text-muted">
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * Pick one of a handful of genuinely different things.
 *
 * A `select` is right for a long flat list — three hundred products, twenty
 * provinces. It is wrong when each option changes *which fields exist below
 * it*, because the consequence of the choice stays invisible until after it is
 * made. An offer's kind and a discount's scope are both that shape, so they get
 * cards, which can carry a sentence of explanation and stay on screen beside
 * the fields they turned on.
 */
export function ChoiceCards<T extends string>({
  value,
  onChange,
  options,
  cols = 2,
  disabled,
}: {
  value: T;
  onChange: (value: T) => void;
  options: {
    value: T;
    label: string;
    hint?: string;
    Icon?: React.ComponentType<{ className?: string }>;
  }[];
  cols?: 2 | 3 | 4;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      className={cn(
        "grid gap-2.5 max-sm:grid-cols-1",
        cols === 2 && "grid-cols-2",
        cols === 3 && "grid-cols-3",
        cols === 4 && "grid-cols-4",
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex gap-2.5 rounded-card border p-3 text-start transition-[border-color,background-color] disabled:cursor-not-allowed disabled:opacity-50",
              active
                ? "border-brand bg-brand/6"
                : "border-line hover:border-line-strong",
            )}
          >
            {option.Icon ? (
              <option.Icon
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  active ? "text-brand" : "text-muted",
                )}
                aria-hidden
              />
            ) : (
              <span
                className={cn(
                  "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
                  active ? "border-brand bg-brand text-white" : "border-line",
                )}
                aria-hidden
              >
                {active && <Check className="size-2.5" />}
              </span>
            )}
            <span className="min-w-0">
              <span
                className={cn(
                  "block text-[0.8rem] font-extrabold",
                  active ? "text-brand" : "text-ink",
                )}
              >
                {option.label}
              </span>
              {option.hint && (
                <span className="mt-0.5 block text-[0.68rem] font-medium leading-relaxed text-muted">
                  {option.hint}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

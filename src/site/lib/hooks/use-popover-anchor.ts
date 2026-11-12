"use client";

import { useLayoutEffect, useState } from "react";
import type { RefObject } from "react";

/**
 * Where a listbox should be drawn, given the control it hangs off.
 *
 * ---------------------------------------------------------------------------
 * Why a portalled, fixed popover is the only arrangement that works here
 * ---------------------------------------------------------------------------
 * Two things in this app break an `absolute` dropdown, and both of them are
 * everywhere in the back office:
 *
 * 1. **Every dashboard dialog scrolls its own body.** An absolutely-positioned
 *    list inside one is clipped by that scroller, so a picker near the bottom
 *    of a long form opens into a few pixels of visible list, or into none.
 * 2. **Radix's modal `Dialog` puts `pointer-events: none` on `<body>`** and
 *    hands its own content `auto` back. A list that is not inside that subtree
 *    inherits the block: it cannot be clicked and it cannot be wheel-scrolled,
 *    while the *keyboard* path keeps working perfectly because focus never
 *    leaves the trigger. That asymmetry is what makes it read as "the dropdown
 *    only works with the keyboard" rather than as a pointer-events problem.
 *
 * So the list is portalled into `<body>`, positioned `fixed` from a measured
 * trigger rect, and re-declares `pointer-events: auto`. `components/ui/select`
 * has worked this way for a while; `SearchableSelect` did not, which is why
 * the picker in the staff editor and the offers product picker could not be
 * scrolled. This hook is that arrangement, extracted, so there is one copy of
 * it and a third picker cannot be written without it.
 *
 * ---------------------------------------------------------------------------
 * Flipping
 * ---------------------------------------------------------------------------
 * Below is preferred and the list only flips above when below genuinely cannot
 * hold a usable one — a menu that changes sides as the page scrolls is worse
 * than a short menu that stays put.
 *
 * ---------------------------------------------------------------------------
 * The trigger sets the *minimum* width, not the width
 * ---------------------------------------------------------------------------
 * This used to hand the list `width: rect.width`, so the popup was exactly as
 * wide as the control it hung off. That is what a native `<select>` does *not*
 * do, and the difference is the whole complaint about the catalogue's sort
 * control: the trigger is `w-38` because "Newest" is a short word, while the
 * options behind it include «السعر: من الأعلى إلى الأدنى», and every one of
 * them arrived in a 152px box under a `truncate` that cut them off. A picker
 * whose list cannot show its own options is a picker you have to guess at.
 *
 * So the box carries a floor and a ceiling and lets the content decide between
 * them: never narrower than the field (a list that is *thinner* than its
 * trigger looks broken), never wider than the room between the field and the
 * edge of the viewport, and its natural width in between.
 *
 * ⚠️ **Which edge it is anchored by depends on the writing direction.** A list
 * pinned by its left edge grows rightwards, which is correct in English and
 * wrong in Arabic — it would walk the options away from the control and off
 * the screen. The direction is read off the trigger rather than off `<html>`,
 * so a control inside an explicitly-`dir`'d subtree is still placed correctly.
 */
export type PopoverBox = {
  top: number;
  /** Physical left, when the list is anchored by its start edge in LTR. */
  left?: number;
  /** Physical right, when anchored by its start edge in RTL. */
  right?: number;
  /** The trigger's width — the list is never narrower than the field. */
  minWidth: number;
  /** The room between the anchored edge and the viewport's. */
  maxWidth: number;
  maxHeight: number;
  above: boolean;
};

/**
 * The part of the page the reader can actually see.
 *
 * ⚠️ `window.innerWidth` is the *layout* viewport, and a `fixed` box is
 * positioned against it. Under pinch zoom — and under the zoom a phone
 * applies on its own when a page is zoomed "to a specific level" — the
 * *visual* viewport is a smaller window onto that layout, offset from its
 * corner. A panel clamped to the layout viewport is then perfectly placed
 * and half of it is past the edge of the screen, which was the report for
 * the bell on a phone: "it gets shown and the rest is after the edge".
 * `visualViewport` gives the visible rectangle in layout coordinates, so
 * clamping to *it* keeps every anchored panel on screen at any zoom. Old
 * browsers without it fall back to the layout viewport, which is what they
 * had.
 */
function viewport() {
  const vv = window.visualViewport;
  return vv
    ? { x: vv.offsetLeft, y: vv.offsetTop, w: vv.width, h: vv.height }
    : { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
}

/** `place` again whenever the visible window moves, not only on resize. */
function watchViewport(place: () => void) {
  const vv = window.visualViewport;
  window.addEventListener("scroll", place, true);
  window.addEventListener("resize", place);
  vv?.addEventListener("resize", place);
  vv?.addEventListener("scroll", place);
  return () => {
    window.removeEventListener("scroll", place, true);
    window.removeEventListener("resize", place);
    vv?.removeEventListener("resize", place);
    vv?.removeEventListener("scroll", place);
  };
}

export function usePopoverAnchor(
  trigger: RefObject<HTMLElement | null>,
  open: boolean,
  { maxHeight = 320, gutter = 8 }: { maxHeight?: number; gutter?: number } = {},
) {
  const [box, setBox] = useState<PopoverBox | null>(null);

  /*
   * Measuring and subscribing are one effect, and `place` is defined inside it.
   *
   * ⚠️ It was a `useCallback` reading `trigger.current`, and the React Compiler
   * refuses that outright: it infers `trigger.current` as a dependency, the
   * declared list says `[trigger]`, and a mismatch on a ref access makes it
   * skip optimising the whole component rather than guess. (`components/ui/
   * select` got away with the same shape only because its ref was a local, not
   * a parameter.) Defining the function where it is used removes the question.
   *
   * `useLayoutEffect`, so the first measurement lands before paint and the list
   * never renders at the wrong place for a frame.
   */
  useLayoutEffect(() => {
    if (!open) return;

    const place = () => {
      const node = trigger.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const v = viewport();
      const below = v.y + v.h - rect.bottom - gutter;
      const room = rect.top - v.y - gutter;
      const above = below < 180 && room > below;
      // Off the trigger, not off `<html>` — see the note at the top.
      const rtl = getComputedStyle(node).direction === "rtl";
      setBox({
        top: above ? Math.max(v.y + gutter, rect.top - 4) : rect.bottom + 4,
        // Anchored by the trigger's *start* edge, so a list wider than its
        // field grows into the page rather than off the side of it.
        left: rtl ? undefined : rect.left,
        right: rtl ? window.innerWidth - rect.right : undefined,
        minWidth: rect.width,
        maxWidth: Math.max(
          rect.width,
          (rtl ? rect.right - v.x : v.x + v.w - rect.left) - gutter,
        ),
        maxHeight: Math.min(maxHeight, above ? room : below),
        above,
      });
    };

    place();

    // Capture, so a scrolling *dialog body* is heard as well as the document —
    // the list is in `<body>` and would otherwise stay put while the field it
    // belongs to scrolls away underneath it.
    return watchViewport(place);
  }, [open, trigger, maxHeight, gutter]);

  return box;
}

/**
 * The inline style a `PopoverBox` becomes.
 *
 * Anchored by `bottom` when flipped above, so the list grows upward from the
 * field rather than downward from a top edge that would have to be recomputed
 * from its own height.
 */
export function popoverStyle(box: PopoverBox): React.CSSProperties {
  return {
    top: box.above ? undefined : box.top,
    bottom: box.above ? window.innerHeight - box.top : undefined,
    left: box.left,
    right: box.right,
    // No `width`. A `fixed` box with neither width nor both insets set is
    // shrink-to-fit, so the list takes its content's natural width and these
    // two clamp it. See the note at the top on why the trigger is a floor
    // rather than the answer.
    minWidth: box.minWidth,
    maxWidth: box.maxWidth,
    maxHeight: box.maxHeight,
  };
}

/**
 * The class every portalled listbox carries.
 *
 * `pointer-events-auto` is load-bearing — see the note at the top of this file.
 * It is here rather than at each call site precisely because it is the sort of
 * thing that gets forgotten in the third copy.
 */
export const popoverPanel =
  "pointer-events-auto fixed z-100 overflow-y-auto overscroll-contain " +
  "rounded-card border border-line bg-surface shadow-lift " +
  "[animation:dialog-content-in_120ms_ease-out]";

/**
 * Where a *wide* panel should be drawn, given the narrow control it hangs off.
 *
 * `usePopoverAnchor` above anchors a list by the trigger's start edge, which is
 * right for a listbox — the list is about as wide as its field and grows into
 * the page. It is wrong for a mega-menu, which is several times wider than the
 * word that opens it and wants to be *centred* on it.
 *
 * ⚠️ **Centring is only half of it; the other half is the clamp, and its
 * absence is the bug this exists to fix.** The catalogue menu used to be an
 * `absolute` box with `start-1/2 -translate-x-1/2` and a
 * `w-[min(52rem,calc(100vw-2rem))]`. That caps the panel's *width* against the
 * viewport and says nothing about where it *starts*: at 1024px the trigger's
 * centre sits around 300px, so a centred 832px panel begins at −116px and its
 * first column is off the side of the screen. `html { overflow-x: clip }` then
 * makes it unreachable rather than merely scrolled-to — which is exactly what
 * "when I zoom, the menu goes outside the borders and I cannot click it" is:
 * browser zoom shrinks the viewport in CSS pixels, so a laptop at 150% is a
 * ~1030px viewport, just over `lg`, where the nav is still drawn and the panel
 * no longer fits beside it.
 *
 * So the left edge is clamped into the viewport, and the height is clamped too
 * — zoom takes the vertical room away just as readily, and a panel taller than
 * the screen needs to scroll rather than spill.
 *
 * **The width is computed, never measured.** It is fully determined by the
 * caller's own `width` cap and the viewport, so there is nothing to read off a
 * rendered element and therefore no first frame drawn in the wrong place.
 */
export type CenteredPanelBox = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  /**
   * `true` on a narrow screen (under `sm`), where an anchored drop-down is
   * the wrong shape whatever the maths says: it is drawn as a bottom sheet
   * spanning the viewport, which cannot overflow an edge at any zoom. Only
   * `useAnchoredPanel` sets it; the caller decides what to do with it.
   */
  sheet?: boolean;
};

export function useCenteredPanel(
  trigger: RefObject<HTMLElement | null>,
  open: boolean,
  { width: cap, gutter = 16 }: { width: number; gutter?: number },
) {
  const [box, setBox] = useState<CenteredPanelBox | null>(null);

  useLayoutEffect(() => {
    if (!open) return;

    const place = () => {
      const node = trigger.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const v = viewport();
      const width = Math.min(cap, v.w - gutter * 2);
      const centred = rect.left + rect.width / 2 - width / 2;
      const top = rect.bottom + 8;
      setBox({
        top,
        left: Math.min(
          Math.max(v.x + gutter, centred),
          v.x + v.w - width - gutter,
        ),
        width,
        maxHeight: Math.max(160, v.y + v.h - top - gutter),
      });
    };

    place();
    // Capture, so an ancestor scroller is heard as well as the document.
    return watchViewport(place);
  }, [open, trigger, cap, gutter]);

  return box;
}

/**
 * A narrow panel hung from the *start* edge of its trigger.
 *
 * `useCenteredPanel` is for a wide panel that should sit under the middle of
 * the bar; this is for a column — the store menu — that should open like a
 * drop-down list does, aligned with the word that opened it, and read the
 * right way round in Arabic (its start edge is the trigger's right edge).
 *
 * Clamped to the viewport on both axes and re-measured on scroll and resize,
 * for the same reason `useCenteredPanel` is: browser zoom takes the room away
 * and `html { overflow-x: clip }` makes an overflowing edge unreachable rather
 * than merely off-screen.
 */
export function useAnchoredPanel(
  trigger: RefObject<HTMLElement | null>,
  open: boolean,
  {
    width: cap,
    gutter = 12,
    align = "start",
    heightShare = 1,
  }: {
    width: number;
    gutter?: number;
    /**
     * Which edge of the trigger the panel hangs from. `start` for a menu
     * under a word at the start of a row; `end` for a control at the far end
     * of the bar — the bell — whose panel has to open *into* the viewport.
     * Both are logical, so they mirror in Arabic on their own.
     */
    align?: "start" | "end";
    /**
     * How much of the viewport the panel may take, 0–1, beyond which it
     * scrolls inside. The store menu passes 0.5: a list of every category,
     * every make and the shortcuts ran from the bar to the foot of the
     * screen and read as a sheet laid over the page rather than a menu
     * under a word. Stopping at the middle keeps the page visible behind
     * it and puts the rest one scroll away.
     */
    heightShare?: number;
  },
) {
  const [box, setBox] = useState<CenteredPanelBox | null>(null);

  useLayoutEffect(() => {
    if (!open) return;

    const place = () => {
      const node = trigger.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const rtl = getComputedStyle(node).direction === "rtl";
      const v = viewport();
      // A phone. See `CenteredPanelBox.sheet`.
      if (window.innerWidth < 640) {
        setBox({
          top: 0,
          left: 0,
          width: 0,
          maxHeight: Math.round(v.h * 0.85),
          sheet: true,
        });
        return;
      }
      const width = Math.min(cap, v.w - gutter * 2);
      // The physical edge the logical one resolves to, then the panel's left
      // from it — and clamped below, which is what stops a 22rem panel hung
      // from a control 60px in from the edge of a 360px phone running 200px
      // off the other side of the screen.
      const fromStart = (align === "start") !== rtl;
      const wanted = fromStart ? rect.left : rect.right - width;
      const top = rect.bottom + 8;
      setBox({
        top,
        left: Math.min(
          Math.max(v.x + gutter, wanted),
          v.x + v.w - width - gutter,
        ),
        width,
        maxHeight: Math.max(
          200,
          Math.min(v.y + v.h - top - gutter, Math.round(v.h * heightShare) - (top - v.y)),
        ),
      });
    };

    place();
    return watchViewport(place);
  }, [open, trigger, cap, gutter, align, heightShare]);

  return box;
}

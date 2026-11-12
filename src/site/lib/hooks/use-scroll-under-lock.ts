"use client";

import { useRef } from "react";

/**
 * Scrolling a portalled panel while a dialog holds the page still.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ The bug this exists for: a listbox you can only scroll by its scrollbar
 * ---------------------------------------------------------------------------
 * Open the cart drawer, press the province picker, and the list scrolls when
 * you drag its scrollbar and does nothing at all for a wheel, a two-finger
 * trackpad swipe or a finger on a phone. It reads as a half-built control.
 *
 * The cause is not in this codebase. Radix's `Dialog` wraps its content in
 * `react-remove-scroll`, whose side effect is (verified in
 * `node_modules/react-remove-scroll/dist/es2019/SideEffect.js`):
 *
 *     document.addEventListener('wheel', shouldPrevent, { passive: false });
 *     document.addEventListener('touchmove', shouldPrevent, { passive: false });
 *
 * and inside `shouldPrevent`, for an event whose target is neither inside the
 * lock nor inside a registered `shard`:
 *
 *     const shouldStop = shardNodes.length > 0 ? … : !noIsolation;
 *     if (shouldStop) event.preventDefault();
 *
 * `components/ui/select.tsx` and `searchable-select.tsx` portal into
 * `document.body` **on purpose** — every dialog in the back office scrolls its
 * own body and a listbox rendered inside one is clipped by it. That places them
 * outside the lock; Radix registers no shard for them and does not set
 * `noIsolation`; so every wheel and every touchmove over the list is cancelled.
 * Dragging a scrollbar is neither event, which is exactly why that one path
 * kept working and made the rest look like a styling problem.
 *
 * It is the same root cause as the `pointer-events: auto` note CLAUDE.md
 * already records for these panels — a portalled child inheriting a modal's
 * defences against the page behind it.
 *
 * ---------------------------------------------------------------------------
 * The fix: scroll it ourselves, but only when something is stopping us
 * ---------------------------------------------------------------------------
 * `preventDefault()` cancels the browser's *default* scrolling. It does not
 * stop anybody assigning `scrollTop`. So the panel moves itself.
 *
 * ⚠️ It must not do that unconditionally, or the panel scrolls **twice** — once
 * by us and once natively — everywhere a dialog is not involved. The
 * discriminator is `document.body[data-scroll-locked]`, which
 * `react-remove-scroll-bar` sets for exactly as long as a lock is mounted
 * (`lockAttribute` in its `component.js`) and which `globals.css` already keys
 * the opaque-header rules off. Locked: we scroll and the native scroll is
 * cancelled a moment later. Not locked: we do nothing and the browser does its
 * job, including its own momentum and overscroll behaviour, which is always
 * better than a hand-rolled imitation.
 *
 * ⚠️ **Ordering is what makes this work, and it is not obvious.** React 19
 * attaches its listeners to the *portal container* — `document.body` — while
 * `react-remove-scroll` listens on `document`. Both are bubble-phase, and body
 * is inside document, so our handler runs **first** and the cancellation lands
 * afterwards on a scroll that has already happened. Reading
 * `event.defaultPrevented` here would therefore always be `false`; that was the
 * first attempt and it silently did nothing.
 */
export function useScrollUnderLock() {
  /** Where the finger was last seen, for the touch path. */
  const lastY = useRef(0);

  /**
   * Is a modal currently holding the page still?
   *
   * Read at event time rather than captured: a picker can be opened on a plain
   * page and still be open when something else opens a dialog over it.
   */
  const locked = () =>
    typeof document !== "undefined" &&
    document.body.hasAttribute("data-scroll-locked");

  const scrollable = (el: HTMLElement) => el.scrollHeight > el.clientHeight;

  return {
    onWheel: (event: React.WheelEvent<HTMLElement>) => {
      const el = event.currentTarget;
      if (!locked() || !scrollable(el)) return;

      /*
       * `deltaMode` is not always pixels. A mouse wheel on Firefox reports
       * lines and a page-scroll gesture reports pages; treating either as
       * pixels moves the list by three pixels per notch, which reads as the
       * fix not having worked.
       */
      const step =
        event.deltaMode === 1
          ? event.deltaY * 16
          : event.deltaMode === 2
            ? event.deltaY * el.clientHeight
            : event.deltaY;

      el.scrollTop += step;
    },

    onTouchStart: (event: React.TouchEvent<HTMLElement>) => {
      lastY.current = event.touches[0]?.clientY ?? 0;
    },

    onTouchMove: (event: React.TouchEvent<HTMLElement>) => {
      const el = event.currentTarget;
      const y = event.touches[0]?.clientY ?? 0;
      if (!locked() || !scrollable(el)) {
        lastY.current = y;
        return;
      }

      // Dragging a finger *up* moves the content up, so the delta is inverted
      // against the pointer — the direction every native scroller uses.
      el.scrollTop += lastY.current - y;
      lastY.current = y;
    },
  };
}

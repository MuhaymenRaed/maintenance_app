/**
 * Eat the `click` that follows a press the page has already acted on.
 *
 * ---------------------------------------------------------------------------
 * The bug this exists for
 * ---------------------------------------------------------------------------
 * Both of this site's listboxes commit on **`pointerup`**, and they have to:
 * the trigger's own `pointerdown` listener tears the panel down, so a `click`
 * would arrive after the row it was aimed at had already gone — which is what
 * made the pickers keyboard-only once, and what made them unscrollable with a
 * finger once. (See the long notes in `components/ui/select.tsx`.)
 *
 * But `pointerup` is not the end of the sequence. The browser dispatches a
 * `click` straight after it, at the same coordinates — and by then the panel
 * has closed, so that click lands on **whatever was underneath the list**. On
 * `/account/settings` the province list is drawn over the theme and language
 * rows, so choosing a province also flipped the theme or switched the site to
 * English: the shop's report, "when I click on an option in the drop list it
 * clicks the buttons behind the drop list".
 *
 * A portalled, `fixed`, non-modal panel cannot avoid this by layering — there
 * is nothing left on screen to absorb the click. So the click is caught on its
 * way down and stopped.
 *
 * ---------------------------------------------------------------------------
 * Why capture on `document`, and why all three calls
 * ---------------------------------------------------------------------------
 * React 19 attaches its delegated listeners to each root container, so a
 * capture-phase listener on `document` runs first and `stopPropagation` is what
 * keeps the event away from every React `onClick` beneath it.
 * `stopImmediatePropagation` covers any other document-level capture listener
 * registered before this one, and `preventDefault` covers the non-React half —
 * a bare `<a href>` or a `<label for>` under the pointer.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ It must expire, and the window is not a guess
 * ---------------------------------------------------------------------------
 * A mouse fires `click` in the same task as `pointerup`. A touch screen
 * synthesises one up to ~350ms later. So the shield cannot be "until the next
 * click" alone — if no click ever comes (a drag that ended on nothing, a
 * gesture the browser swallowed) a permanent listener would eat the reader's
 * *next, deliberate* press instead, which is a far worse bug than the one it
 * was installed for. It disarms itself after one click or `WINDOW_MS`,
 * whichever is first.
 */

const WINDOW_MS = 400;

export function swallowNextClick(): void {
  if (typeof document === "undefined") return;

  let armed = true;

  const disarm = () => {
    if (!armed) return;
    armed = false;
    document.removeEventListener("click", onClick, true);
    window.clearTimeout(timer);
  };

  const onClick = (event: MouseEvent) => {
    if (!armed) return;
    disarm();
    event.stopImmediatePropagation();
    event.stopPropagation();
    event.preventDefault();
  };

  const timer = window.setTimeout(disarm, WINDOW_MS);
  document.addEventListener("click", onClick, true);
}

"use client";

import { createPortal } from "react-dom";
import { useLinkStatus } from "next/link";
import { Loader2 } from "lucide-react";
import { BrandLogo, BrandMark } from "@/components/store/brand-logo";
import { cn } from "@/lib/utils";

/**
 * "That press landed, and we are fetching."
 *
 * ---------------------------------------------------------------------------
 * Why a per-link indicator exists at all
 * ---------------------------------------------------------------------------
 * The App Router's default for a navigation with no loading boundary above it
 * is to leave the **previous page on screen, unchanged**, for the whole of the
 * server round trip. For a warm prefetch that is right and invisible. For a
 * cold one it is indistinguishable from a link that does not work, and the
 * reported symptom is always the same: "it is slow", followed by the reader
 * pressing the control again.
 *
 * `loading.tsx` is the better answer where a route boundary can carry it, and
 * this repo uses one wherever that is true. It cannot be the whole answer for
 * the dashboard: a `loading.tsx` in a segment is the fallback for that
 * segment's *children*, so `admin/loading.tsx` covers every section page and
 * covers **nothing** while `admin/layout.tsx` itself is awaiting `requireStaff`
 * — which is precisely the round trip that makes the first press feel slow.
 * The indicator is in the control the reader is looking at, and it responds on
 * the frame the press happens.
 *
 * ---------------------------------------------------------------------------
 * Constraints worth knowing before reusing it
 * ---------------------------------------------------------------------------
 * - `useLinkStatus` reads a context published by `next/link`, so this **must**
 *   be rendered inside a `<Link>`. Outside one it reports `pending: false`
 *   forever and silently does nothing. `@/i18n/navigation`'s Link renders
 *   `next/link` internally, so next-intl's wrapper is fine.
 * - It only reports while the navigation is *blocked*. A prefetched route
 *   resolves before a frame is painted and this never appears, which is the
 *   behaviour we want: a spinner that flashes on every instant navigation is
 *   noise that teaches people the site is slower than it is.
 *
 * `aria-hidden`, always. The status is already carried for assistive
 * technology by the destination page's own `role="status"`, and a spinner that
 * announces itself on every link press is a screen reader talking over the
 * navigation it is describing.
 */
export function LinkPending({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;

  return (
    <Loader2
      className={cn("size-4 shrink-0 animate-spin", className)}
      aria-hidden
    />
  );
}

/**
 * A control's own glyph, replaced by a spinner while its link is in flight.
 *
 * For an icon-only control, where there is nowhere to put a second mark: the
 * button is 36px square and already full. Swapping keeps the control exactly
 * the size it was, so a row of them does not reflow the moment one is pressed
 * — which on the header's control cluster would shift every button beside it.
 */
export function LinkPendingSwap({ children }: { children: React.ReactNode }) {
  const { pending } = useLinkStatus();
  if (!pending) return children;
  return <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />;
}

/**
 * "This tab was pressed and its page is coming" — inside the tab itself.
 *
 * ---------------------------------------------------------------------------
 * Why the dashboard does not get the full-page veil
 * ---------------------------------------------------------------------------
 * On the storefront a navigation replaces everything, so a veil across the
 * viewport is an honest picture of it. In the back office the chrome *stays* —
 * the bar, the tab strip and the tab you just lit are all still on screen, and
 * only the body below is being fetched. Dimming the whole screen there says
 * something false: it hides the controls that did not move, including the tab
 * that is answering the press.
 *
 * ---------------------------------------------------------------------------
 * Louder than a hairline, and still inside the box
 * ---------------------------------------------------------------------------
 * The first version was a 2px rule along the bottom edge, which was easy to
 * miss on a page that is otherwise not moving. This tints the whole control and
 * sweeps a band of light across it — the same `sheen` idea the skeletons use,
 * which is deliberate: the tab shimmers, then the body's skeleton shimmers,
 * then the content lands. One visual language for "arriving", read twice.
 *
 * ⚠️ It changes no box. `absolute inset-0` inside a control the caller has
 * already made `relative overflow-hidden`, so a tab cannot grow mid-press —
 * which matters in a strip that scrolls, where one tab widening shifts every
 * tab after it out from under a pointer already on its way down.
 */
export function LinkPendingTab({
  /** The tab is already brand-filled, so the wash has to be light-on-dark. */
  onBrand = false,
}: {
  onBrand?: boolean;
}) {
  const { pending } = useLinkStatus();
  if (!pending) return null;

  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]",
        onBrand ? "bg-white/20" : "bg-brand/12",
      )}
    >
      <span
        className={cn(
          "absolute inset-y-0 -inset-x-full block animate-indeterminate",
          onBrand
            ? "bg-gradient-to-r from-transparent via-white/45 to-transparent"
            : "bg-gradient-to-r from-transparent via-brand/30 to-transparent",
        )}
      />
    </span>
  );
}

/**
 * The id `admin/layout.tsx` puts on the box this veil is scoped to.
 *
 * A plain shared string rather than a context: the layout only needs it once,
 * to set the `id`, and this file only needs it once, to look the node up —
 * React context would be one provider for a value that never changes and is
 * read in exactly one place.
 */
export const ADMIN_CONTENT_ID = "admin-content-veil-target";

/**
 * "This section is arriving" — confined to the dashboard's own content box.
 *
 * ---------------------------------------------------------------------------
 * Why the dashboard gets a *third* signal, and why it is not `LinkPendingVeil`
 * ---------------------------------------------------------------------------
 * `LinkPendingTab` says "pressed", right on the word. `admin/loading.tsx` says
 * "arriving", once Next actually suspends. Between the two there was a real
 * gap on a slow connection: the tab lit up and then nothing else changed for a
 * beat, which reads as a press that landed nowhere.
 *
 * `LinkPendingVeil` — the full-viewport one — is the storefront's answer to
 * that gap, and it is the wrong shape here. A dashboard navigation does not
 * replace the page: the header, the tab strip and the tab that was just
 * pressed all stay exactly where they are, and only the body changes.
 * Covering the header and the strip in a page that is telling the truth about
 * what moved would be the veil lying about what moved.
 *
 * So this dims and blurs `#admin-content-veil-target` — the box
 * `admin/layout.tsx` wraps `{children}` in — and nothing outside it.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ The hand-off to the skeleton is the platform's, not a timer
 * ---------------------------------------------------------------------------
 * `useLinkStatus`'s own contract is "`pending`: true before history updates,
 * false after" — and the history update happens the instant the App Router
 * commits the new route, which is the same instant `admin/loading.tsx` mounts
 * as that route's Suspense fallback. So this veil un-mounts on exactly the
 * frame the skeleton mounts, with no `setTimeout` coordinating the two: press
 * → this veil → (gone, skeleton in) → data. Three stages, one platform
 * guarantee, nothing hand-timed to drift out of sync later.
 *
 * ---------------------------------------------------------------------------
 * Portalled, and positioned for content of any length
 * ---------------------------------------------------------------------------
 * `#admin-content-veil-target` is `position: relative` and holds whatever the
 * previous page rendered — which can be a two-screen-tall board. `absolute
 * inset-0` on the tint covers all of it, so nothing outside the target peeks
 * through at the edges; `sticky` on the mark keeps it near the top of
 * whatever is actually on screen rather than centred in a box that is taller
 * than the viewport. A reader who presses a tab from the top of the page —
 * the ordinary case, since the tabs live there — never has to scroll to see
 * that anything happened.
 */
export function AdminContentVeil() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  if (typeof document === "undefined") return null;

  const target = document.getElementById(ADMIN_CONTENT_ID);
  if (!target) return null;

  return createPortal(
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-panel bg-canvas/75 backdrop-blur-sm [animation:fade-in_120ms_ease-out]"
    >
      <div className="sticky top-10 flex flex-col items-center gap-3 pt-6">
        <span className="relative flex items-center justify-center">
          <span
            aria-hidden
            className="animate-halo absolute -inset-6 rounded-full bg-brand/12 blur-2xl"
          />
          <BrandMark className="animate-breathe relative size-9" />
        </span>
        <span className="block h-[2px] w-20 overflow-hidden rounded-full bg-line/70">
          <span className="animate-indeterminate block h-full w-1/3 rounded-full bg-brand" />
        </span>
      </div>
    </div>,
    target,
  );
}

/**
 * The page is being replaced — said across the whole viewport.
 *
 * ---------------------------------------------------------------------------
 * Why this and not the hairline
 * ---------------------------------------------------------------------------
 * `LinkPendingBar` is two pixels at the edge of the control that was pressed.
 * It is honest and it is easy to miss, which defeats the point: the reader who
 * needs it is the one who is not sure the press landed, and they are not
 * looking at the bottom edge of a nav link. A veil is unmissable and it says
 * the right thing — *this whole page is going away* — which is exactly what a
 * route change is.
 *
 * It is the same picture `app/[locale]/loading.tsx` draws when a layout
 * changes, on purpose. Those are two different mechanisms (a Suspense fallback
 * and a link's pending state) covering two different moments of one
 * navigation, and a reader should not be able to tell where one hands over to
 * the other.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ It does not block
 * ---------------------------------------------------------------------------
 * `pointer-events-none`, deliberately. A veil that swallows clicks would make
 * a navigation that never resolves into a page nobody can leave — and this is
 * *feedback*, not a modal. The cost is that somebody can press a second link
 * through it, which the router handles by superseding the first.
 *
 * ⚠️ `z-85` is not a free choice. The scale at the top of `globals.css` runs
 * scrim 60, header 70, dialog content 80, tour scrim 90. Above a dialog's
 * content, because a link inside a dialog still replaces the page under it;
 * below the tour's, because the tour draws its own veil that *names the
 * destination*, and that is the better message whenever both apply.
 *
 * It only appears while the navigation is genuinely blocked. A prefetched
 * route resolves before a frame is painted and this never renders — which is
 * what keeps it from becoming a full-screen flash on every press.
 */
export function LinkPendingVeil() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return <NavigationVeil />;
}

/**
 * The veil itself, with no opinion about what is pending.
 *
 * Split out of `LinkPendingVeil` so a navigation that is *not* a link — the
 * language switch, which goes through `router.replace` inside a transition —
 * can draw the same picture while its transition is pending. One veil, two
 * triggers; a reader cannot tell them apart and should not be able to.
 */
export function NavigationVeil() {

  /*
   * ⚠️ Portalled to `<body>`, and this is a correctness fix rather than tidiness.
   *
   * `fixed inset-0` is supposed to escape to the viewport, and it does — unless
   * an ancestor establishes a containing block. **`backdrop-filter` does
   * exactly that**, and the site header carries `backdrop-blur-2xl`. So a veil
   * rendered from a link *inside the header* was clipped to the header's own
   * 56px-tall box: a strip of dimming across the bar and the whole page below
   * it untouched, which reads as a rendering fault rather than as "wait".
   *
   * Nothing about the positioning code was wrong, which is what makes this
   * worth a paragraph — the same trap `transform` and `filter` set, and the
   * same reason `components/ui/select.tsx` portals its listbox out of the
   * dialogs that scroll their own bodies.
   *
   * `document` is safe to touch here: `pending` is false on the server, so this
   * line is unreachable during SSR. The guard is belt for a renderer that has
   * no DOM at all.
   */
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      // `aria-hidden` because the destination page announces itself on arrival.
      // A live region here would talk over the navigation it is describing.
      aria-hidden
      className="pointer-events-none fixed inset-0 z-85 grid place-items-center bg-canvas/80 backdrop-blur-md [animation:fade-in_180ms_ease-out]"
    >
      <div className="flex flex-col items-center gap-7 px-6">
        {/*
          The full lockup, not the bare diamond.

          A mark alone is a shape; the mark with the name under it is the shop
          saying "this is us, hold on". It is also what the reader has been
          looking at in the header for the whole visit, so the veil reads as
          *this site working* rather than as a generic spinner that could
          belong to anything.

          `showTagline={false}`: the tagline is descriptive, and a veil is not
          the moment to describe anything.
        */}
        <span className="relative flex items-center justify-center">
          {/* A soft halo, so the lockup sits in light rather than on a flat
              wash. Blurred and composited — one layer, no repaint. */}
          <span
            aria-hidden
            className="animate-halo absolute -inset-x-10 -inset-y-8 rounded-full bg-brand/10 blur-3xl"
          />
          <span className="animate-breathe relative">
            <BrandLogo showTagline={false} />
          </span>
        </span>

        {/*
          The bar, and a word.

          ⚠️ The word is *not* translated here and does not need to be: this
          component renders inside links all over the site, including in
          namespaces the storefront's client provider withholds, so reaching
          for `useTranslations` would throw `MISSING_MESSAGE` on some pages and
          not others — the hardest version of that bug to find. Three dots say
          the same thing in both languages and cannot break.
        */}
        <span className="flex flex-col items-center gap-2.5">
          <span className="block h-[3px] w-32 overflow-hidden rounded-full bg-line/70 sm:w-40">
            <span className="animate-indeterminate block h-full w-1/3 rounded-full bg-brand" />
          </span>
          <span
            aria-hidden
            className="text-[0.7rem] font-black tracking-[0.35em] text-muted"
          >
            •••
          </span>
        </span>
      </div>
    </div>,
    document.body,
  );
}

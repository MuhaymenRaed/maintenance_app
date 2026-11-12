import type { AnchorHTMLAttributes } from "react";

/**
 * `next/link`, for a window where a "navigation" is a local read.
 *
 * ⚠️ `useLinkStatus` always answers `false`, and that is the honest answer
 * rather than a stub. Every indicator the dashboard draws from it — the chip
 * shimmer, the swap, the full-page veil — exists because the App Router leaves
 * the previous page on screen for the length of a *server* round trip. Here the
 * board is already on this computer: the router sets the route and the next
 * frame has the rows. There is nothing to wait for, so an indicator that
 * appeared would be the app inventing a delay to apologise for.
 *
 * The site's own `lib/print/station.ts` is where a desk press that genuinely
 * takes time reports itself, and it has its own panel.
 */
export function useLinkStatus(): { pending: boolean } {
  return { pending: false };
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  prefetch?: boolean;
  replace?: boolean;
  scroll?: boolean;
};

/**
 * The anchor itself. The router reads a press on any in-app link from one
 * document listener (`lib/router.tsx`), so this needs no handler of its own —
 * which is also what makes the copied `<a href>` in the queue toolbar behave
 * exactly like a `<Link>`.
 */
export default function Link({ prefetch: _p, replace: _r, scroll: _s, ...rest }: LinkProps) {
  return <a {...rest} />;
}

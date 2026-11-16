import { createElement, type AnchorHTMLAttributes } from "react";
import { localised, navigate, refresh, useRoute } from "../../lib/router";

/**
 * next-intl's locale-aware navigation, answered by the window's own router.
 *
 * The dashboard's components import `Link` and `useRouter` from here and must
 * keep importing them from here — `FilterChips`, `StatPress` and the ticket
 * dialog all do. Everything they use is below; nothing else is, so an import
 * of a name this does not have is a type error at the moment a sync brings one
 * in rather than a blank screen later.
 *
 * `Link` is a plain anchor. It needs no press handler: `startRouter` reads
 * every in-app press from one listener on the document, which is also what
 * makes the copied `<a href>` in the queue toolbar behave identically. The one
 * thing it does add is the locale — `localised()` — so the address bar and the
 * language the window is drawing in cannot drift apart.
 */
export type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };

export function Link({ href, ...rest }: LinkProps) {
  return createElement("a", { href: localised(href), ...rest });
}

export function useRouter() {
  return {
    // The second argument is next-intl's (`{ scroll }`), taken and ignored:
    // the board is redrawn in place here, so there is no scroll to keep.
    push: (href: string, _options?: { scroll?: boolean; locale?: string }) => navigate(href),
    replace: (href: string, _options?: { scroll?: boolean; locale?: string }) =>
      navigate(href, { replace: true }),
    back: () => window.history.back(),
    forward: () => window.history.forward(),
    /** Re-reads the page. Every write already redraws it; this is the belt. */
    refresh,
    /** Nothing to fetch ahead of time — the board is on this computer. */
    prefetch: () => {},
  };
}

/** The path without the locale, as next-intl's own hook answers. */
export function usePathname(): string {
  return useRoute().path;
}

export function getPathname({ href }: { href: string; locale?: string }): string {
  return localised(href);
}

/**
 * ⚠️ Deliberately throws rather than navigating.
 *
 * On the site this is a *server* redirect — it belongs to a page body deciding
 * a reader may not be here. Nothing the desk copies calls it, and a version
 * that quietly navigated would turn a refusal nobody meant to reach into a
 * silent change of screen.
 */
export function redirect(_target: { href: string; locale?: string }): never {
  throw new Error("redirect() is the site's own; the desk app has no server to redirect from");
}

import { useSyncExternalStore } from "react";
import { readSettings } from "./settings";

/**
 * The window's router: two screens, the dashboard's own URLs.
 *
 * ---------------------------------------------------------------------------
 * Why a router at all, in an app with two pages
 * ---------------------------------------------------------------------------
 * Because the board's filters are URLs and must stay URLs. `FilterChips`,
 * `QueueToolbar` and the per-person table are copied from the dashboard
 * unchanged, and every control in them is a `<Link>` to `?when=…&q=…&tech=…`
 * or a plain GET form posting to `/{locale}/admin/repairs`. Re-writing those
 * as callbacks would have meant forking four components and keeping the forks
 * in step with the site for ever — the thing `scripts/sync-site.mjs` exists to
 * avoid.
 *
 * So the app keeps real history entries and reads them. The parameters arrive
 * at `window.desk.page(params)`, the main process resolves them exactly as the
 * server's page body did (`resolveQueueWindow`, `cleanSearch`, the same
 * defaults), and Back walks the filters the way it walks them on the site.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ One listener on the document, not a handler per link
 * ---------------------------------------------------------------------------
 * The copied components do not import this file and must not have to. A press
 * on any in-app anchor and a submit of any in-app GET form are caught in the
 * capture phase here, so the vendored `<a href>` in the queue toolbar behaves
 * exactly like the `<Link>` beside it.
 *
 * External addresses (`https:`, `tel:`, `mailto:`) are handed to the system —
 * a desk that opened WhatsApp *inside* the ticket window would have no way
 * back. `target="_blank"` is left alone on purpose: the main process already
 * answers those through `setWindowOpenHandler`.
 *
 * ---------------------------------------------------------------------------
 * The locale in the path is cosmetic
 * ---------------------------------------------------------------------------
 * `/ar/admin/repairs` is what the dashboard's links build, so that is what the
 * URL looks like — but the language the window draws in is the *setting*, not
 * the segment, and the board is computed by the main process from the same
 * setting. `localised()` writes the current locale into every href so the two
 * never disagree, and `alignLocale()` rewrites the bar when the setting
 * changes.
 */

export type RouteKind = "desk" | "settings";

export type Route = {
  kind: RouteKind;
  /** The path without the locale — `/admin/repairs`, `/settings`. */
  path: string;
  query: Record<string, string>;
  /** Changes on every navigation and every `refresh()`, so a page can re-read. */
  revision: number;
};

const LOCALES = new Set(["ar", "en"]);

function parse(url: URL, revision: number): Route {
  const segments = decodeURIComponent(url.pathname).split("/").filter(Boolean);
  if (segments.length && LOCALES.has(segments[0])) segments.shift();
  const path = `/${segments.join("/")}`;
  const query: Record<string, string> = {};
  for (const [key, value] of url.searchParams) if (value !== "") query[key] = value;
  return { kind: path.startsWith("/settings") ? "settings" : "desk", path, query, revision };
}

let revision = 0;
let current: Route = parse(new URL(window.location.href), revision);
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function land(url: URL) {
  current = parse(url, ++revision);
  emit();
}

export const routerStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  snapshot: () => current,
};

export function useRoute(): Route {
  return useSyncExternalStore(routerStore.subscribe, routerStore.snapshot, routerStore.snapshot);
}

/** The reader's own language in front of a dashboard path. */
export function localised(href: string): string {
  if (!href.startsWith("/")) return href;
  const locale = readSettings().locale;
  const [, first] = href.split("/");
  if (LOCALES.has(first)) return href;
  return `/${locale}${href === "/" ? "" : href}`;
}

export function navigate(href: string, { replace = false }: { replace?: boolean } = {}) {
  const url = new URL(localised(href), window.location.href);
  if (replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
  land(url);
}

/**
 * Where the settings are for this reader, and back again. A technician has
 * the app's own page (`/settings`). A manager's are the desk's الإعدادات tab,
 * where the app's own settings are drawn under the bench's (2026-11-24).
 */
export function toggleSettings(technician: boolean) {
  if (technician || current.kind === "settings") {
    navigate(current.kind === "settings" ? "/admin/repairs" : "/settings");
    return;
  }
  navigate(current.query.tab === "settings" ? "/admin/repairs" : "/admin/repairs?tab=settings");
}

/**
 * One ticket, open on the board — from a Windows notification, the bell or the
 * sync panel. The board opens `?open=<id>` on arrival, as it does on the site
 * when an overview card or a staff alert links there.
 *
 * The bench's own path when the window is already on it, so a programming desk
 * stays on `/admin/programming`; `/admin/repairs` otherwise, which
 * `alignBasePath` corrects the moment the board answers.
 */
export function openTicket(ticketId: string) {
  const path = current.kind === "desk" && current.path.startsWith("/admin/") ? current.path : "/admin/repairs";
  navigate(`${path}?open=${encodeURIComponent(ticketId)}`);
}

/**
 * Re-read the page without changing the address — `router.refresh()`.
 *
 * Every write already bumps the local store and the window redraws from the
 * event, so this is belt rather than braces: it is what the copied ticket
 * dialog calls after it saves, and it must not be the only thing that works.
 */
export function refresh() {
  current = { ...current, revision: ++revision };
  emit();
}

/** Puts the current language in the address bar — called when the setting changes. */
export function alignLocale(locale: string) {
  const url = new URL(window.location.href);
  const segments = decodeURIComponent(url.pathname).split("/").filter(Boolean);
  if (segments.length && LOCALES.has(segments[0])) {
    if (segments[0] === locale) return;
    segments[0] = locale;
  } else {
    segments.unshift(locale);
  }
  url.pathname = `/${segments.join("/")}`;
  window.history.replaceState(null, "", url);
  current = { ...parse(url, ++revision) };
  emit();
}

/**
 * Keeps the desk's own base path in the address — `/admin/repairs` or
 * `/admin/programming`.
 *
 * The bench is a setting, and the board's links are built from the base path
 * the main process answers with. Without this a desk switched to programming
 * would sit on `/admin/repairs` with every chip pointing at
 * `/admin/programming`, so the first press would look like it changed the
 * section rather than the filter.
 */
export function alignBasePath(basePath: string) {
  if (current.kind !== "desk" || current.path === basePath) return;
  const url = new URL(window.location.href);
  url.pathname = localised(basePath);
  window.history.replaceState(null, "", url);
  current = { ...parse(url, ++revision) };
  emit();
}

const EXTERNAL = /^(https?|mailto|tel|whatsapp):/i;

/** Installed once, by `main.tsx`, for the life of the window. */
export function startRouter(): () => void {
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!anchor) return;
    // `target="_blank"` and downloads are the main process's — it opens them
    // in the system's own browser and refuses to navigate this window.
    if (anchor.target && anchor.target !== "_self") return;
    if (anchor.hasAttribute("download")) return;

    const raw = anchor.getAttribute("href") ?? "";
    if (!raw || raw.startsWith("#")) return;
    if (EXTERNAL.test(raw)) {
      event.preventDefault();
      void window.desk.app.openExternal(raw);
      return;
    }
    const url = new URL(raw, window.location.href);
    if (url.origin !== window.location.origin) return;
    event.preventDefault();
    navigate(url.pathname + url.search);
  };

  /**
   * ⚠️ A GET form is a navigation here, not a submit.
   *
   * The queue toolbar's three forms — the date range, "the last N days" and
   * the search — are plain `method="get"` with an `action` of
   * `/{locale}/admin/repairs`. Left to the browser this window would try to
   * load that address as a document, which `will-navigate` in the main process
   * would then refuse, and the press would do nothing at all.
   */
  const onSubmit = (event: SubmitEvent) => {
    if (event.defaultPrevented) return;
    const form = event.target as HTMLFormElement | null;
    if (!form || form.method.toLowerCase() !== "get") return;
    const action = form.getAttribute("action");
    if (!action) return;
    const url = new URL(action, window.location.href);
    if (url.origin !== window.location.origin) return;
    event.preventDefault();
    const data = new FormData(form);
    const params = new URLSearchParams();
    for (const [key, value] of data) {
      const text = typeof value === "string" ? value.trim() : "";
      if (text) params.set(key, text);
    }
    const query = params.toString();
    navigate(url.pathname + (query ? `?${query}` : ""));
  };

  const onPop = () => land(new URL(window.location.href));

  /*
   * ⚠️ The site's view writes its tab and list into the address with
   * `history.replaceState` (`repair-desk-view.tsx`), and nothing else here
   * hears that: the route kept the tab the reader had left, and the title
   * bar's settings button, asking it, went the wrong way. So the route follows
   * the address — without a new revision, which would re-read the bench for a
   * change that is only the window's own.
   */
  const replace = window.history.replaceState.bind(window.history);
  window.history.replaceState = (data: unknown, unused: string, url?: string | URL | null) => {
    replace(data, unused, url);
    const next = parse(new URL(window.location.href), revision);
    if (next.path === current.path && JSON.stringify(next.query) === JSON.stringify(current.query)) return;
    current = next;
    emit();
  };

  document.addEventListener("click", onClick, true);
  document.addEventListener("submit", onSubmit, true);
  window.addEventListener("popstate", onPop);
  return () => {
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("submit", onSubmit, true);
    window.removeEventListener("popstate", onPop);
    window.history.replaceState = replace;
  };
}

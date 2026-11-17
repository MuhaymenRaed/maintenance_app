"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Copy, Minus, Square, X } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { windowStore, type WindowEntry } from "@/lib/windows/window-store";
import {
  bindDetached,
  canDetach,
  detachedStore,
  openDetached,
  raiseDetached,
  releaseDetached,
  titleDetached,
} from "@/lib/windows/detached";
import { OwnerDocumentProvider } from "@/lib/windows/owner-document";
import { cn } from "@/lib/utils";

/**
 * Windows, not modals, for the dashboard's editors.
 *
 * ---------------------------------------------------------------------------
 * Why the dashboard stopped using a modal for its forms
 * ---------------------------------------------------------------------------
 * A modal is one question at a time: it dims the board, freezes the page and
 * takes the keyboard until it is answered. That is right for "are you sure"
 * and wrong for the desk's real day, which is two customers at the counter and
 * a technician asking about a third ticket — the shop asked for it in those
 * words: open several "add ticket" windows at once, fill them side by side,
 * and do not lose one by brushing the backdrop.
 *
 * So inside the dashboard every editor is a window: it floats over the board
 * without dimming it, can be dragged by its title bar, resized from a lower
 * corner, folded into the dock and brought back, maximised, and closed only
 * after saying so. Several can be open; the one pressed last is in front.
 *
 * ---------------------------------------------------------------------------
 * How it is wired
 * ---------------------------------------------------------------------------
 * - `WindowHost` wraps the dashboard (the admin layout, and the desktop app's
 *   shell). Inside it `EntityDialog` renders an `AppWindow`; outside it — the
 *   storefront's product pencil — it is still the modal it always was.
 * - Each `AppWindow` is rendered **by the board that owns it**, so its form
 *   state, its save and its translations stay where they are. It portals into
 *   one layer on `<body>`, which is what lets a window sit above the header
 *   and never be offset by an animating page body.
 * - What windows share — which is in front, which are folded, where the next
 *   lands — is `lib/windows/window-store.ts`.
 *
 * ---------------------------------------------------------------------------
 * On a phone
 * ---------------------------------------------------------------------------
 * A window is a full-screen sheet above the dock: dragging a box around a
 * 390px screen is not a feature. The dock becomes the switcher — every open
 * window is a chip, the one on screen is filled, and folding one shows the
 * next. Nothing is lost by switching.
 *
 * ⚠️ Positions are physical `left`/`top`, never logical, in both scripts: a
 * window is dragged with a pointer that moves in screen coordinates.
 *
 * ---------------------------------------------------------------------------
 * Detached: a window of its own on the desktop
 * ---------------------------------------------------------------------------
 * A window passed `detach` — the repair desk's ticket and new-ticket windows —
 * opens as a real browser window on a desk, so it stays on screen when the
 * dashboard's own window is minimised (the shop's instruction of 2026-11-17,
 * for the site and the desktop app alike). It is the same component in the
 * same React tree, portalled into the other window: see
 * `lib/windows/detached.ts` for why that, and not a page of its own. The
 * operating system moves, sizes, minimises and stacks it; the dock still lists
 * it, and pressing its chip — or the ticket's row again — brings it forward.
 * A browser that blocks the pop-up gets the in-page window, saying why.
 */

const HostContext = createContext(false);

/** Is this inside the dashboard's window host? `EntityDialog` asks. */
export function useWindowed(): boolean {
  return useContext(HostContext);
}

export type WindowApi = {
  id: string;
  /**
   * Close the window the way its own × does — asking first when it is a form.
   * `then` replaces the window's `onClose` for this one close: an editor's
   * Cancel discards its uploads before closing, and that must still happen.
   */
  requestClose: (then?: () => void) => void;
};

const WindowContext = createContext<WindowApi | null>(null);

/** The window this component is inside, or null in a plain modal. */
export function useAppWindow(): WindowApi | null {
  return useContext(WindowContext);
}

/**
 * Draws `children` as belonging to no window — for a modal opened from inside
 * one (see `EntityDialog`), whose Cancel must close the modal and never the
 * window under it.
 */
export function OutsideWindow({ children }: { children: ReactNode }) {
  return <WindowContext.Provider value={null}>{children}</WindowContext.Provider>;
}

/**
 * A footer's own "Close" — inside a window it is the window's close, which
 * asks first; in a modal it is `onClose` itself.
 */
export function WindowCloseButton({
  onClose,
  className,
  children,
}: {
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const win = useContext(WindowContext);
  return (
    <button type="button" onClick={() => (win ? win.requestClose() : onClose())} className={className}>
      {children}
    </button>
  );
}

const LAYER_ID = "app-window-layer";

/**
 * One layer on `<body>`, created on first use.
 *
 * ⚠️ A direct child of `<body>`, never inside the page. `position: fixed` is
 * relative to the nearest ancestor with a transform, and the dashboard's page
 * body animates in with one (`PageEnter`): a window rendered inside it would
 * jump by the animation's offset on every section change.
 */
function layer(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  let node = document.getElementById(LAYER_ID);
  if (!node) {
    node = document.createElement("div");
    node.id = LAYER_ID;
    // Above the sticky header (70) and below a dialog's content (80), so an
    // "are you sure" raised from a window covers it, and portalled lists
    // (100) open above it.
    Object.assign(node.style, {
      position: "fixed",
      inset: "0",
      zIndex: "75",
      pointerEvents: "none",
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(node);
  }
  return node;
}

const subscribeNothing = () => () => {};
/** True in the browser after hydration — a window has nowhere to go on the server. */
function useIsClient() {
  return useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
}

/** Below this the window is a full-screen sheet. Matches Tailwind's `sm`. */
const COMPACT = "(max-width: 639.98px)";

function compact() {
  return typeof window !== "undefined" && window.matchMedia(COMPACT).matches;
}

/**
 * Where the top of the usable screen is: under whatever the page marks
 * `data-window-top` — the dashboard's header, the desktop app's title bar.
 * Read when a window opens, not stored: a header that wrapped onto two lines
 * since is still a header a window must not slide under.
 */
function topInset(): number {
  if (typeof document === "undefined") return 8;
  let bottom = 0;
  for (const node of document.querySelectorAll("[data-window-top]")) {
    bottom = Math.max(bottom, node.getBoundingClientRect().bottom);
  }
  return Math.round(bottom) + 8;
}

/** The dock's height, kept clear by a maximised window and on a phone. */
const DOCK_SPACE = 60;
const MIN_W = 340;
const MIN_H = 260;

type Rect = { x: number; y: number; w: number; h: number };

function clampRect(rect: Rect): Rect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const top = topInset();
  const w = Math.max(MIN_W, Math.min(rect.w, vw - 16));
  const h = Math.max(MIN_H, Math.min(rect.h, vh - top - 16));
  // Enough of the title bar always stays on screen to grab it again.
  const x = Math.min(Math.max(rect.x, 120 - w), vw - 120);
  const y = Math.min(Math.max(rect.y, top), vh - 48);
  return { x, y, w, h };
}

function firstRect(width: number, height: number | undefined, rtl: boolean): Rect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const top = topInset();
  const w = Math.min(width, vw - 24);
  const h = Math.min(height ?? Math.round(vh * 0.82), vh - top - DOCK_SPACE - 8);
  // Cascade, so a second "add ticket" does not land exactly on the first.
  const step = (windowStore.count() % 6) * 28;
  const x = Math.round((vw - w) / 2 + (rtl ? -step : step));
  const y = top + 4 + step;
  return clampRect({ x, y, w, h });
}

export type AppWindowProps = {
  /**
   * A stable id when the owner wants to find this window again — the board
   * focuses `repair:<id>` rather than opening the same ticket twice. Generated
   * when absent.
   */
  windowId?: string;
  title: string;
  subtitle?: string;
  /** A hairline of colour at the top — a status tone, a brand accent. */
  accent?: string;
  width?: number;
  height?: number;
  closeLabel: string;
  /** Closes the window for good. Called after the reader confirmed. */
  onClose: () => void;
  /**
   * Ask before closing. On by default: the shop asked for every editor to
   * confirm, because a window brushed shut takes whatever was typed into it.
   */
  confirmClose?: boolean;
  /**
   * Open as a window of its own on the desktop rather than inside the page —
   * on a desk only; a phone or a tablet keeps the in-page window. See the note
   * at the top of this file.
   */
  detach?: boolean;
  footer?: ReactNode;
  children: ReactNode;
};

export function AppWindow(props: AppWindowProps) {
  const isClient = useIsClient();
  const generated = useId();
  const id = props.windowId ?? `win${generated.replace(/[^a-zA-Z0-9]/g, "")}`;
  if (!isClient) return null;
  if (props.detach) return <DetachableWindow {...props} id={id} />;
  const node = layer();
  if (!node) return null;
  return createPortal(<WindowFrame {...props} id={id} />, node);
}

/**
 * Decides once, when the window opens, whether it is detached. A window that
 * switched between the two as the screen was resized would tear down the form
 * inside it and build it again.
 */
function DetachableWindow(props: AppWindowProps & { id: string }) {
  const [detached] = useState(canDetach);
  if (detached) return <DetachedWindow {...props} />;
  const node = layer();
  return node ? createPortal(<WindowFrame {...props} />, node) : null;
}

/**
 * The window opened as a browser window of its own, with the form portalled
 * into it.
 *
 * ⚠️ **Opened in a layout effect, and that is load-bearing.** A browser opens
 * a pop-up only while the press that asked for it still counts as the user's
 * act, so the window has to be opened in the commit of the render that press
 * caused — not in a later effect and never after an await.
 */
function DetachedWindow(props: AppWindowProps & { id: string }) {
  const { id, title, subtitle, width = 640, height, onClose, confirmClose = true } = props;
  const t = useTranslations("Admin");
  const state = useSyncExternalStore(
    detachedStore.subscribe,
    () => detachedStore.get(id),
    () => null,
  );

  useLayoutEffect(() => {
    openDetached(id, {
      title,
      width,
      height: height ?? Math.round((screen.availHeight || 900) * 0.86),
    });
    return () => releaseDetached(id);
    // Opened once per window; its title is kept current below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Closed from its own title bar: the owner's close, read when it happens.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    bindDetached(id, { onGone: () => closeRef.current(), confirmLeave: confirmClose });
  }, [id, confirmClose, state]);

  // What the taskbar and the window's own frame call it.
  const open = state?.status === "open";
  useEffect(() => {
    if (open) titleDetached(id, subtitle ? `${title} — ${subtitle}` : title);
  }, [open, id, title, subtitle]);

  if (!state) return null;
  if (state.status === "blocked") {
    const node = layer();
    return node ? createPortal(<WindowFrame {...props} notice={t("winPopupBlocked")} />, node) : null;
  }
  return createPortal(
    <OwnerDocumentProvider document={state.win.document}>
      <DetachedFrame {...props} />
    </OwnerDocumentProvider>,
    state.root,
  );
}

/**
 * What fills a detached window: the title, the form, the footer. No title-bar
 * buttons of its own beyond close — the operating system's frame already
 * moves, sizes and minimises it — and close is kept because it asks in the
 * dashboard's own words, where the frame's × gets the browser's "leave?".
 */
function DetachedFrame({
  id,
  title,
  subtitle,
  accent,
  closeLabel,
  onClose,
  confirmClose = true,
  footer,
  children,
}: AppWindowProps & { id: string }) {
  const t = useTranslations("Admin");
  const titleId = `${id}-title`;
  const frame = useRef<HTMLDivElement>(null);
  const [asking, setAsking] = useState<(() => void) | null>(null);

  const closeRef = useRef<(then?: () => void) => void>(() => {});
  useEffect(() => {
    closeRef.current = (then?: () => void) => {
      const act = then ?? onClose;
      if (!confirmClose) {
        act();
        return;
      }
      raiseDetached(id);
      setAsking(() => act);
    };
  });
  const requestClose = useCallback((then?: () => void) => closeRef.current(then), []);

  useEffect(() => {
    windowStore.register(id, {
      title,
      subtitle,
      accent,
      requestClose: () => closeRef.current(),
      detached: true,
      raise: () => raiseDetached(id),
    });
    frame.current?.focus({ preventScroll: true });
    return () => windowStore.unregister(id);
    // Registered once per window; the title is kept current below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    windowStore.patch(id, { title, subtitle, accent });
  }, [id, title, subtitle, accent]);

  return (
    <WindowContext.Provider value={{ id, requestClose }}>
      <div
        ref={frame}
        tabIndex={-1}
        aria-labelledby={titleId}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || event.defaultPrevented || asking) return;
          event.preventDefault();
          event.stopPropagation();
          requestClose();
        }}
        className="flex h-dvh flex-col bg-surface text-ink outline-none"
      >
        {accent && <span className="h-[3px] shrink-0" style={{ background: accent }} aria-hidden />}

        <header className="flex shrink-0 items-center gap-2 border-b border-line/70 px-6 py-3">
          <div className="min-w-0 flex-1">
            <h1 id={titleId} className="truncate text-[1.02rem] font-black leading-tight tracking-[-0.02em] text-ink">
              {title}
            </h1>
            {subtitle && <p className="mt-0.5 truncate text-[0.74rem] font-medium text-muted">{subtitle}</p>}
          </div>
          <WindowButton label={closeLabel} onClick={() => requestClose()} danger>
            <X className="size-4" aria-hidden />
          </WindowButton>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">{children}</div>

        {footer && (
          <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line/70 bg-subtle/40 px-6 py-3.5">
            {footer}
          </footer>
        )}
      </div>

      <ConfirmDialog
        open={asking !== null}
        title={t("winCloseTitle")}
        body={`${title} — ${t("winCloseBody")}`}
        confirmLabel={t("winCloseConfirm")}
        cancelLabel={t("winKeepOpen")}
        onConfirm={() => {
          const act = asking;
          setAsking(null);
          act?.();
        }}
        onCancel={() => setAsking(null)}
      />
    </WindowContext.Provider>
  );
}

function WindowFrame({
  id,
  title,
  subtitle,
  accent,
  width = 640,
  height,
  closeLabel,
  onClose,
  confirmClose = true,
  footer,
  children,
  notice,
}: AppWindowProps & {
  id: string;
  /** A line under the title — why a window meant to be detached is not. */
  notice?: string;
}) {
  const t = useTranslations("Admin");
  const titleId = `${id}-title`;
  const frame = useRef<HTMLDivElement>(null);
  // Read once, where the window first lands: an Arabic page cascades leftward.
  const [rect, setRect] = useState<Rect>(() =>
    firstRect(width, height, document.documentElement.dir === "rtl"),
  );
  const [maximized, setMaximized] = useState(false);
  /** The act waiting on "are you sure" — the window's own close, or Cancel's. */
  const [asking, setAsking] = useState<(() => void) | null>(null);

  const entry = useSyncExternalStore(
    windowStore.subscribe,
    () => windowStore.get(id),
    () => undefined,
  );
  const front = useSyncExternalStore(
    windowStore.subscribe,
    windowStore.front,
    () => null,
  );

  /*
   * The latest close, behind a stable function the store can hold. The dock
   * calls it long after this render; reading a ref inside a callback is what
   * refs are for.
   */
  const closeRef = useRef<(then?: () => void) => void>(() => {});
  useEffect(() => {
    closeRef.current = (then?: () => void) => {
      const act = then ?? onClose;
      if (!confirmClose) {
        act();
        return;
      }
      // In front first, so the reader can see what they are about to close.
      windowStore.focus(id);
      setAsking(() => act);
    };
  });
  const requestClose = useCallback((then?: () => void) => closeRef.current(then), []);

  useEffect(() => {
    windowStore.register(id, {
      title,
      subtitle,
      accent,
      requestClose: () => closeRef.current(),
    });
    // Focus lands inside, so Tab starts in this window and Escape reaches it.
    frame.current?.focus({ preventScroll: true });
    return () => windowStore.unregister(id);
    // Registered once per window; the title is kept current below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    windowStore.patch(id, { title, subtitle, accent });
  }, [id, title, subtitle, accent]);

  // A window the reader brings forward from the dock gets the keyboard.
  const isFront = front === id;
  useEffect(() => {
    if (isFront && frame.current && !frame.current.contains(document.activeElement)) {
      frame.current.focus({ preventScroll: true });
    }
  }, [isFront]);

  /* ── dragging and resizing, written to the DOM while the pointer moves ── */

  const gesture = useRef<{
    kind: "move" | "resize-end" | "resize-start";
    px: number;
    py: number;
    start: Rect;
    next: Rect;
  } | null>(null);

  function begin(kind: "move" | "resize-end" | "resize-start", event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0 || maximized || compact()) return;
    if (kind === "move" && (event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { kind, px: event.clientX, py: event.clientY, start: rect, next: rect };
  }

  function track(event: ReactPointerEvent<HTMLElement>) {
    const g = gesture.current;
    const node = frame.current;
    if (!g || !node) return;
    const dx = event.clientX - g.px;
    const dy = event.clientY - g.py;
    let next: Rect;
    if (g.kind === "move") {
      next = { ...g.start, x: g.start.x + dx, y: g.start.y + dy };
    } else if (g.kind === "resize-end") {
      // The physical bottom-right corner.
      next = { ...g.start, w: g.start.w + dx, h: g.start.h + dy };
    } else {
      // The physical bottom-left corner: the left edge moves with the pointer.
      const w = Math.max(MIN_W, g.start.w - dx);
      next = { ...g.start, x: g.start.x + (g.start.w - w), w, h: g.start.h + dy };
    }
    next = clampRect(next);
    g.next = next;
    // Straight to the DOM: re-rendering a two-hundred-field form 120 times a
    // second is how a drag stutters on the counter's laptop.
    node.style.left = `${next.x}px`;
    node.style.top = `${next.y}px`;
    node.style.width = `${next.w}px`;
    node.style.height = `${next.h}px`;
  }

  function end() {
    const g = gesture.current;
    gesture.current = null;
    if (g) setRect(g.next);
  }

  const minimized = entry?.minimized ?? false;
  const z = entry?.z ?? 1;

  const style: React.CSSProperties = maximized
    ? { left: 8, right: 8, top: topInset(), bottom: DOCK_SPACE, zIndex: z }
    : { left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex: z };

  return (
    <WindowContext.Provider value={{ id, requestClose }}>
      <div
        ref={frame}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        tabIndex={-1}
        hidden={minimized}
        data-front={isFront || undefined}
        onPointerDownCapture={() => windowStore.focus(id)}
        onFocusCapture={() => {
          if (!isFront) windowStore.focus(id);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || event.defaultPrevented || asking) return;
          event.preventDefault();
          event.stopPropagation();
          requestClose();
        }}
        style={style}
        className={cn(
          "pointer-events-auto fixed flex flex-col overflow-hidden rounded-panel border bg-surface outline-none",
          "[animation:window-in_170ms_ease-out]",
          isFront
            ? "border-line-strong shadow-[0_24px_60px_-12px_rgb(0_0_0/0.35),0_0_0_1px_color-mix(in_srgb,var(--brand)_18%,transparent)]"
            : "border-line shadow-lift",
          // A phone gets a sheet: the inline geometry is overruled, and the
          // dock keeps its strip at the foot.
          "max-sm:!inset-x-0 max-sm:!top-0 max-sm:!bottom-[3.5rem] max-sm:!h-auto max-sm:!w-auto max-sm:rounded-none max-sm:border-x-0 max-sm:border-t-0",
        )}
      >
        {accent && (
          <span className="h-[3px] shrink-0" style={{ background: accent }} aria-hidden />
        )}

        <header
          onPointerDown={(event) => begin("move", event)}
          onPointerMove={track}
          onPointerUp={end}
          onPointerCancel={end}
          onDoubleClick={(event) => {
            if ((event.target as HTMLElement).closest("button") || compact()) return;
            setMaximized((value) => !value);
          }}
          className={cn(
            "flex shrink-0 touch-none select-none items-center gap-2 border-b border-line/70 px-4 py-2.5 max-sm:px-3",
            isFront ? "bg-surface" : "bg-subtle/60",
            !maximized && "sm:cursor-grab sm:active:cursor-grabbing",
          )}
        >
          <div className="min-w-0 flex-1">
            <h2
              id={titleId}
              className={cn(
                "truncate text-[0.98rem] font-black leading-tight tracking-[-0.02em]",
                isFront ? "text-ink" : "text-muted",
              )}
            >
              {title}
            </h2>
            {subtitle && (
              <p className="mt-0.5 truncate text-[0.72rem] font-medium text-muted">{subtitle}</p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            <WindowButton label={t("winMinimize")} onClick={() => windowStore.minimize(id)}>
              <Minus className="size-4" aria-hidden />
            </WindowButton>
            <WindowButton
              label={maximized ? t("winRestore") : t("winMaximize")}
              onClick={() => setMaximized((value) => !value)}
              className="max-sm:hidden"
            >
              {maximized ? (
                <Copy className="size-3.5 -scale-x-100" aria-hidden />
              ) : (
                <Square className="size-3.5" aria-hidden />
              )}
            </WindowButton>
            <WindowButton label={closeLabel} onClick={() => requestClose()} danger>
              <X className="size-4" aria-hidden />
            </WindowButton>
          </div>
        </header>

        {notice && (
          <p role="status" className="shrink-0 border-b border-warning/30 bg-warning/10 px-4 py-2 text-[0.74rem] font-bold leading-relaxed text-warning">
            {notice}
          </p>
        )}

        {/* Sections separate themselves with a hairline (see `Section`), so
            the scroller only owns the outer padding. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5 max-sm:px-4">
          {children}
        </div>

        {footer && (
          <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line/70 bg-subtle/40 px-6 py-3.5 max-sm:gap-1.5 max-sm:px-3 max-sm:py-3">
            {footer}
          </footer>
        )}

        {!maximized && (
          <>
            {/* The two lower corners. Physical, like the drag: the corner the
                pointer is on is the corner that moves. */}
            <span
              aria-hidden
              onPointerDown={(event) => begin("resize-end", event)}
              onPointerMove={track}
              onPointerUp={end}
              onPointerCancel={end}
              className="absolute bottom-0 right-0 size-4 cursor-nwse-resize touch-none max-sm:hidden"
            >
              <span className="absolute bottom-1 right-1 size-2 border-b-2 border-r-2 border-line-strong" />
            </span>
            <span
              aria-hidden
              onPointerDown={(event) => begin("resize-start", event)}
              onPointerMove={track}
              onPointerUp={end}
              onPointerCancel={end}
              className="absolute bottom-0 left-0 size-4 cursor-nesw-resize touch-none max-sm:hidden"
            >
              <span className="absolute bottom-1 left-1 size-2 border-b-2 border-l-2 border-line-strong" />
            </span>
          </>
        )}
      </div>

      <ConfirmDialog
        open={asking !== null}
        title={t("winCloseTitle")}
        body={`${title} — ${t("winCloseBody")}`}
        confirmLabel={t("winCloseConfirm")}
        cancelLabel={t("winKeepOpen")}
        onConfirm={() => {
          const act = asking;
          setAsking(null);
          act?.();
        }}
        onCancel={() => setAsking(null)}
      />
    </WindowContext.Provider>
  );
}

function WindowButton({
  label,
  onClick,
  danger,
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "flex size-8 items-center justify-center rounded-control text-muted transition-colors",
        danger ? "hover:bg-brand hover:text-white" : "hover:bg-subtle hover:text-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ── The host, and the dock it draws ─────────────────────────────────────── */

/**
 * Turns every `EntityDialog` beneath it into a window, and draws the dock.
 * Mounted once by the dashboard's layout and by the desktop app's shell.
 */
export function WindowHost({ children }: { children: ReactNode }) {
  return (
    <HostContext.Provider value={true}>
      {children}
      <WindowDock />
    </HostContext.Provider>
  );
}

function WindowDock() {
  const t = useTranslations("Admin");
  const isClient = useIsClient();
  const windows = useSyncExternalStore(
    windowStore.subscribe,
    windowStore.snapshot,
    windowStore.server,
  );
  const front = useSyncExternalStore(windowStore.subscribe, windowStore.front, () => null);
  if (!isClient || windows.length === 0) return null;

  return createPortal(
    <nav
      aria-label={t("winDock")}
      className={cn(
        "fixed bottom-3 left-1/2 z-[76] flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-1.5 overflow-x-auto rounded-full border border-line bg-surface/95 px-2 py-1.5 shadow-lift backdrop-blur-xl [animation:window-in_170ms_ease-out]",
        "max-sm:inset-x-0 max-sm:bottom-0 max-sm:max-w-none max-sm:translate-x-0 max-sm:rounded-none max-sm:border-x-0 max-sm:border-b-0 max-sm:pb-[calc(0.375rem+env(safe-area-inset-bottom))]",
      )}
    >
      <span className="shrink-0 px-1.5 text-[0.68rem] font-extrabold text-muted max-sm:hidden">
        {t("winDock")}
        <span className="ms-1 rounded-full bg-subtle px-1.5 text-ink" data-numeric>
          {windows.length}
        </span>
      </span>
      {windows.map((entry) => (
        <DockChip key={entry.id} entry={entry} front={front === entry.id} closeLabel={t("close")} />
      ))}
    </nav>,
    document.body,
  );
}

function DockChip({
  entry,
  front,
  closeLabel,
}: {
  entry: WindowEntry;
  front: boolean;
  closeLabel: string;
}) {
  return (
    <span
      className={cn(
        "group flex shrink-0 items-center rounded-full border transition-colors",
        front
          ? "border-brand/50 bg-brand/8"
          : entry.minimized
            ? "border-dashed border-line bg-transparent"
            : "border-line bg-surface",
      )}
    >
      <button
        type="button"
        onClick={() => windowStore.toggle(entry.id)}
        aria-pressed={front}
        title={entry.subtitle ? `${entry.title} — ${entry.subtitle}` : entry.title}
        className="flex items-center gap-1.5 py-1 ps-2.5 pe-1 text-[0.74rem] font-extrabold"
      >
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ background: entry.accent ?? "var(--brand)" }}
          aria-hidden
        />
        <span
          className={cn(
            "max-w-[10.5rem] truncate",
            front ? "text-brand" : entry.minimized ? "text-muted" : "text-ink",
          )}
        >
          {entry.title}
        </span>
      </button>
      <button
        type="button"
        onClick={() => entry.requestClose()}
        aria-label={`${closeLabel} — ${entry.title}`}
        className="me-1 flex size-5 items-center justify-center rounded-full text-muted transition-colors hover:bg-brand hover:text-white"
      >
        <X className="size-3" aria-hidden />
      </button>
    </span>
  );
}

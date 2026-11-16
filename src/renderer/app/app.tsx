import { useEffect } from "react";
import { useTranslations } from "next-intl";
import toast, { Toaster } from "react-hot-toast";
import { AlertTriangle, Bell, CircleCheck, Wifi, WifiOff, X } from "lucide-react";
import { PrintStationHost } from "@/components/admin/print-station";
import { WindowHost } from "@/components/admin/app-window";
import { cn } from "@/lib/utils";
import type { AppNotice } from "../../shared/contract";
import { chime } from "../lib/chime";
import { DeskIntl } from "../lib/intl";
import { markRead } from "../lib/notices";
import { navigate, openTicket, useRoute } from "../lib/router";
import { readSettings, saveSettings } from "../lib/settings";
import { syncNow } from "../lib/sync";
import { DeskPage } from "./desk-page";
import { SettingsPage } from "./settings-page";
import { SyncPanelHost } from "./sync-panel";
import { TitleBar } from "./title-bar";

/**
 * The window: the dashboard's admin layout with one section in it.
 *
 * The same three things the site's `admin/layout.tsx` mounts around a page —
 * the toaster, the print station (which follows a run from one ticket to the
 * next, so it lives above the page) — plus the two the desk adds: the sync
 * panel, and the notices arriving while somebody is looking.
 */
export function App() {
  return (
    <DeskIntl>
      <Shell />
    </DeskIntl>
  );
}

function Shell() {
  const route = useRoute();
  useNoticeToasts();
  useOpenTicketFromMain();
  useShortcuts();

  return (
    // Every editor is a window here as on the dashboard — several tickets open
    // at once, folded into the dock, closed only after asking. See the site's
    // `components/admin/app-window.tsx`.
    <WindowHost>
    <div className="flex min-h-dvh flex-col">
      <TitleBar />
      <main className="mx-auto w-full max-w-[1280px] flex-1 px-6 py-6 max-sm:px-4">
        {route.kind === "settings" ? <SettingsPage /> : <DeskPage />}
      </main>

      {/* The dashboard's own toaster, as `admin/layout.tsx` mounts it — the
          offset is in px because the bar above it is (see `.desk-titlebar`). */}
      <Toaster
        position="top-center"
        containerStyle={{ top: 68 }}
        toastOptions={{ className: "!rounded-panel !text-[0.82rem] !font-bold" }}
      />
      <PrintStationHost />
      <SyncPanelHost />
    </div>
    </WindowHost>
  );
}

/**
 * News that arrives while the reader is looking at the desk.
 *
 * The main process keeps every notice (the bell) and raises a Windows
 * notification only when the window is NOT in front — a system notification
 * over the app you are looking at is the computer telling you twice. So this is
 * the other half: when the window *is* in front, a toast and a chime.
 *
 * ⚠️ A toast is not "read". Somebody glancing away from the till does not see
 * it, so it stays unread in the bell until it is pressed — the dashboard bell's
 * own rule that only what the reader opened counts as seen.
 */
function useNoticeToasts() {
  const t = useTranslations("Desk");
  const openLabel = t("openTicketAction");
  const closeLabel = t("close");

  useEffect(
    () =>
      window.desk.onNotice((notice) => {
        if (document.visibilityState !== "visible" || !document.hasFocus()) return;
        const settings = readSettings();
        const quiet = notice.kind === "online" || notice.kind === "backup";
        if (settings.notifySound && !quiet) {
          chime(notice.kind === "sync_failed" || notice.kind === "offline" ? "problem" : "news");
        }
        toast.custom(
          (item) => (
            <NoticeToast
              notice={notice}
              visible={item.visible}
              openLabel={openLabel}
              closeLabel={closeLabel}
              onOpen={() => {
                toast.dismiss(item.id);
                void markRead([notice.id]);
                if (notice.ticketId) openTicket(notice.ticketId);
              }}
              onClose={() => toast.dismiss(item.id)}
            />
          ),
          { id: `notice-${notice.id}`, duration: notice.kind === "sync_failed" ? 10_000 : 6_000 },
        );
      }),
    [openLabel, closeLabel],
  );
}

const NOTICE_LOOK: Record<AppNotice["kind"], { Icon: typeof Bell; tone: string }> = {
  new_ticket: { Icon: Bell, tone: "bg-info/10 text-info" },
  changed: { Icon: Bell, tone: "bg-info/10 text-info" },
  sync_failed: { Icon: AlertTriangle, tone: "bg-brand/10 text-brand" },
  offline: { Icon: WifiOff, tone: "bg-warning/12 text-warning" },
  online: { Icon: Wifi, tone: "bg-success/12 text-success" },
  backup: { Icon: CircleCheck, tone: "bg-success/12 text-success" },
};

function NoticeToast({
  notice,
  visible,
  openLabel,
  closeLabel,
  onOpen,
  onClose,
}: {
  notice: AppNotice;
  visible: boolean;
  openLabel: string;
  closeLabel: string;
  onOpen: () => void;
  onClose: () => void;
}) {
  const look = NOTICE_LOOK[notice.kind] ?? NOTICE_LOOK.changed;
  return (
    <div
      role="status"
      className={cn(
        "pointer-events-auto flex w-[min(25rem,calc(100vw-2rem))] items-start gap-3 rounded-panel border border-line bg-surface p-3.5 shadow-lift transition-[opacity,transform] duration-200",
        visible ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0",
      )}
    >
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-control", look.tone)} aria-hidden>
        <look.Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.82rem] font-extrabold text-ink">{notice.title}</span>
        {notice.body && (
          <span className="mt-0.5 block text-[0.74rem] font-medium leading-relaxed text-muted">{notice.body}</span>
        )}
        {notice.ticketId && (
          <button
            type="button"
            onClick={onOpen}
            className="mt-2 inline-flex items-center rounded-control bg-brand/8 px-2.5 py-1 text-[0.72rem] font-extrabold text-brand transition-colors hover:bg-brand/14"
          >
            {openLabel}
          </button>
        )}
      </span>
      <button
        type="button"
        onClick={onClose}
        aria-label={closeLabel}
        title={closeLabel}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-control text-muted transition-colors hover:bg-subtle hover:text-ink"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

/** A Windows notification pressed while the desk was behind something else. */
function useOpenTicketFromMain() {
  useEffect(() => window.desk.onOpenTicket((ticketId) => openTicket(ticketId)), []);
}

const SCALES = [0.85, 0.9, 1, 1.1, 1.2, 1.3];

/**
 * The few keys a counter reaches for without the mouse.
 *
 * F5 is "sync now" rather than "reload": there is nothing to reload, the
 * window draws from the local store, and the reflex a person brings from a
 * browser is "show me the latest". Ctrl + / − / 0 is the text size, which is
 * what zoom means to somebody who has only ever met it in a browser. Ctrl+F is
 * the board's own search box, not the browser's find bar, which a desk window
 * does not have.
 */
function useShortcuts() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const ctrl = event.ctrlKey || event.metaKey;

      if (event.key === "F5" && !ctrl) {
        event.preventDefault();
        void syncNow();
        return;
      }
      if (event.altKey && !ctrl && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        // Back and forward walk the filters, as they do on the site. Not when
        // the caret is in a field, where Alt+arrow means something else.
        if (isTyping(event.target)) return;
        event.preventDefault();
        if (event.key === "ArrowLeft") window.history.back();
        else window.history.forward();
        return;
      }
      if (!ctrl) return;

      if (event.key === ",") {
        event.preventDefault();
        const here = window.location.pathname.includes("/settings");
        navigate(here ? "/admin/repairs" : "/settings");
        return;
      }
      if (event.key.toLowerCase() === "f" && !event.shiftKey) {
        const search = document.querySelector<HTMLInputElement>('input[name="q"]');
        if (search) {
          event.preventDefault();
          search.focus();
          search.select();
        }
        return;
      }
      if (event.key === "=" || event.key === "+" || event.key === "-" || event.key === "0") {
        event.preventDefault();
        const current = readSettings().fontScale;
        const index = SCALES.findIndex((scale) => Math.abs(scale - current) < 0.001);
        const at = index === -1 ? SCALES.indexOf(1) : index;
        const next =
          event.key === "0" ? 1 : event.key === "-" ? SCALES[Math.max(0, at - 1)] : SCALES[Math.min(SCALES.length - 1, at + 1)];
        if (next !== current) void saveSettings({ fontScale: next });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

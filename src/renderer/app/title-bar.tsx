import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  CloudOff,
  CloudUpload,
  Languages,
  Loader2,
  Moon,
  RefreshCw,
  Settings,
  Sun,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react";
import { BrandLogo } from "@/components/store/brand-logo";
import { glassControl } from "@/components/ui/glass-control";
import { formatSince } from "@/lib/data/datetime";
import { cn } from "@/lib/utils";
import { isDark } from "../lib/appearance";
import { clearAll, markRead, useNotices } from "../lib/notices";
import { navigate, openTicket, toggleSettings, useRoute } from "../lib/router";
import { saveSettings, useSettings } from "../lib/settings";
import { useSync } from "../lib/sync";
import { openSyncPanel } from "./sync-panel";

/**
 * The window's own title bar — the dashboard's admin header, made a window.
 *
 * The same bar the back office draws: the shop's lockup at the start, the
 * controls at the end, `--surface` with a hairline under it, `data-site-header`
 * so the dashboard's own rule makes it opaque while a dialog's scrim is up.
 * What changed is what is on it. There is no storefront to go back to and no
 * section tabs — the desk is one page — so the controls are the ones a desk
 * needs in reach all day: whether it is talking to the server, the bell,
 * the theme and the language, and the settings.
 *
 * ⚠️ The whole bar is a drag handle (`-webkit-app-region: drag`, in
 * `app.css`) and every control on it opts back out. Windows paints its own
 * minimise / maximise / close over the top-right corner; `.desk-titlebar-content`
 * is fitted to the strip Windows reports as free, so nothing here is ever
 * drawn underneath them — in Arabic, where the start of the bar is the right.
 */
export function TitleBar() {
  const t = useTranslations("Desk");
  const route = useRoute();
  const settings = useSettings();
  const dark = isDark(settings);
  // A manager's settings are the desk's الإعدادات tab; a technician's, the app's page.
  const technician = useSync().account?.role === "technician";
  const inSettings = route.kind === "settings" || (!technician && route.query.tab === "settings");

  return (
    <header
      data-site-header
      // Windows stop under the bar — see `topInset` in the site's app-window.
      data-window-top
      className="desk-titlebar sticky top-0 z-70 border-b border-line bg-surface"
    >
      <div className="desk-titlebar-content flex items-center gap-2 px-4">
        <button
          type="button"
          onClick={() => navigate("/admin/repairs")}
          title={t("backToDesk")}
          className="shrink-0 rounded-control outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <BrandLogo compact />
        </button>
        <span className="mx-1 h-5 w-px bg-line" aria-hidden />
        <span className="truncate text-[0.85rem] font-extrabold text-muted">{t("appLabel")}</span>

        <div className="flex flex-1 items-center justify-end gap-1.5">
          <SyncPill />
          <NoticeBell />
          <button
            type="button"
            onClick={() => void saveSettings({ theme: dark ? "light" : "dark" })}
            aria-label={dark ? t("themeLight") : t("themeDark")}
            title={dark ? t("themeLight") : t("themeDark")}
            className={glassControl}
          >
            {dark ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
          </button>
          <button
            type="button"
            onClick={() => void saveSettings({ locale: settings.locale === "ar" ? "en" : "ar" })}
            aria-label={t("switchLanguage")}
            title={t("switchLanguage")}
            className={cn(glassControl, "relative")}
          >
            <Languages className="size-4" aria-hidden />
            <span className="absolute -end-1 -top-1 rounded-full bg-ink px-1 text-[0.55rem] font-black leading-[1.15rem] text-surface">
              {settings.locale === "ar" ? "EN" : "AR"}
            </span>
          </button>
          <button
            type="button"
            onClick={() => toggleSettings(technician)}
            aria-label={t("settings")}
            aria-pressed={inSettings}
            title={t("settings")}
            className={cn(glassControl, inSettings && "border-brand/45 bg-brand/8 text-brand")}
          >
            <Settings className="size-4" aria-hidden />
          </button>
        </div>
      </div>
    </header>
  );
}

/**
 * Whether the desk is talking to the server — in one pill, read at a glance.
 *
 * Four states a counter needs to tell apart without opening anything: up to
 * date; sending (with how many); offline with work saved here (with how many);
 * and a refusal that needs a person. Pressing it opens the sync panel, which
 * is where the "how many" becomes a list.
 */
function SyncPill() {
  const t = useTranslations("Desk");
  const sync = useSync();
  const offline = !sync.online || sync.state === "offline";

  const look =
    sync.failed > 0
      ? { tone: "border-brand/45 bg-brand/8 text-brand", Icon: AlertTriangle, label: t("pillFailed", { count: sync.failed }) }
      : sync.state === "auth"
        ? { tone: "border-warning/45 bg-warning/10 text-warning", Icon: AlertTriangle, label: t("pillAuth") }
        : offline
          ? {
              tone: "border-warning/45 bg-warning/10 text-warning",
              Icon: sync.pending ? CloudOff : WifiOff,
              label: sync.pending ? t("pillOfflinePending", { count: sync.pending }) : t("pillOffline"),
            }
          : sync.state === "syncing" || sync.pending > 0
            ? {
                tone: "border-info/40 bg-info/8 text-info",
                Icon: sync.pending ? CloudUpload : Loader2,
                label: sync.pending ? t("pillSending", { count: sync.pending }) : t("pillSyncing"),
              }
            : { tone: "border-success/40 bg-success/8 text-success", Icon: Wifi, label: t("pillSynced") };

  return (
    <button
      type="button"
      onClick={openSyncPanel}
      title={t("syncTitle")}
      className={cn(
        "press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[0.74rem] font-extrabold transition-colors",
        look.tone,
      )}
    >
      <look.Icon className={cn("size-4", look.Icon === Loader2 && "animate-spin")} aria-hidden />
      <span className="max-w-[14rem] truncate">{look.label}</span>
    </button>
  );
}

/**
 * The desk's own bell — new tickets, a colleague's change, a refusal, the line.
 *
 * ⚠️ Marking read takes the ids the reader *saw*, never "everything": a notice
 * that arrives while the panel is open has not been read. The rule the
 * dashboard's bell follows, for the same reason.
 */
function NoticeBell() {
  const t = useTranslations("Desk");
  const locale = useLocale();
  const notices = useNotices();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const holder = useRef<HTMLDivElement>(null);
  const unread = notices.filter((notice) => !notice.read).length;

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!holder.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle() {
    if (!open) setNow(Date.now());
    setOpen(!open);
  }

  const shown = notices.slice(0, 40);

  return (
    <div ref={holder} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={t("notices")}
        aria-expanded={open}
        title={t("notices")}
        className={cn(glassControl, "relative")}
      >
        <Bell className="size-4" aria-hidden />
        {unread > 0 && (
          <span
            className="absolute -end-1 -top-1 min-w-[1.1rem] rounded-full bg-brand px-1 text-center text-[0.6rem] font-black leading-[1.1rem] text-white"
            data-numeric
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        // ⚠️ `data-no-drag`: the panel hangs below the bar and would otherwise
        // inherit the bar's drag region, so pressing its empty space would move
        // the window instead of doing nothing.
        <div
          data-no-drag
          className="absolute end-0 top-11 z-90 w-[22rem] overflow-hidden rounded-panel border border-line bg-surface shadow-lift [animation:fade-in_120ms_ease-out]"
        >
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
            <h2 className="text-[0.85rem] font-black text-ink">{t("notices")}</h2>
            <span className="flex items-center gap-1">
              {unread > 0 && (
                <button
                  type="button"
                  onClick={() => void markRead(shown.filter((notice) => !notice.read).map((notice) => notice.id))}
                  title={t("markRead")}
                  aria-label={t("markRead")}
                  className="inline-flex size-8 items-center justify-center rounded-control text-muted transition-colors hover:bg-subtle hover:text-ink"
                >
                  <CheckCheck className="size-4" aria-hidden />
                </button>
              )}
              {notices.length > 0 && (
                <button
                  type="button"
                  onClick={() => void clearAll()}
                  title={t("clearNotices")}
                  aria-label={t("clearNotices")}
                  className="inline-flex size-8 items-center justify-center rounded-control text-muted transition-colors hover:bg-brand/8 hover:text-brand"
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              )}
            </span>
          </div>
          {shown.length === 0 ? (
            <p className="px-4 py-8 text-center text-[0.8rem] font-medium text-muted">{t("noNotices")}</p>
          ) : (
            <ul className="max-h-[26rem] divide-y divide-line/70 overflow-y-auto overscroll-contain">
              {shown.map((notice) => (
                <li key={notice.id}>
                  <button
                    type="button"
                    disabled={!notice.ticketId}
                    onClick={() => {
                      void markRead([notice.id]);
                      setOpen(false);
                      if (notice.ticketId) openTicket(notice.ticketId);
                    }}
                    className={cn(
                      "flex w-full gap-3 px-4 py-3 text-start transition-colors enabled:hover:bg-subtle",
                      !notice.read && "bg-brand/4",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-1.5 size-2 shrink-0 rounded-full",
                        notice.read ? "bg-transparent" : notice.kind === "sync_failed" ? "bg-brand" : "bg-info",
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.8rem] font-extrabold text-ink">{notice.title}</span>
                      {notice.body && (
                        <span className="mt-0.5 block text-[0.74rem] font-medium leading-relaxed text-muted">
                          {notice.body}
                        </span>
                      )}
                      <span className="mt-1 block text-[0.66rem] font-bold text-muted">
                        {formatSince(locale, notice.at, now)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              openSyncPanel();
            }}
            className="flex w-full items-center justify-center gap-2 border-t border-line px-4 py-2.5 text-[0.76rem] font-extrabold text-brand transition-colors hover:bg-brand/6"
          >
            <RefreshCw className="size-3.5" aria-hidden />
            {t("syncTitle")}
          </button>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Archive,
  Bell,
  Cpu,
  Database,
  FolderOpen,
  HardDriveDownload,
  HardDriveUpload,
  Info,
  KeyRound,
  Languages,
  Loader2,
  Monitor,
  Moon,
  Palette,
  Printer,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  Sun,
  Wrench,
  X,
} from "lucide-react";
import { Callout, ChoiceCards, Field, input, Section, SelectField, Toggle } from "@/components/admin/form-kit";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { LockedPanel } from "@/components/admin/desk-gate";
import { openPrinterSetup } from "@/lib/print/station";
import { formatDayTime } from "@/lib/data/datetime";
import type { RepairService } from "@/lib/data/repair-desk";
import { cn } from "@/lib/utils";
import toast from "react-hot-toast";
import type { AccountInfo, AgentInfo, AppSettings, BackupInfo } from "../../shared/contract";
import { navigate, useRoute } from "../lib/router";
import { saveSettings, useSettings } from "../lib/settings";
import { syncNow, useSync } from "../lib/sync";
import { openSyncPanel } from "./sync-panel";

/**
 * The desk's settings, in the dashboard's own form kit.
 *
 * ---------------------------------------------------------------------------
 * One page, eight sections, the section in the address
 * ---------------------------------------------------------------------------
 * `?tab=` for the same reason the board's filters are in the address: Back
 * returns to the section somebody came from, and the first-run screen can send
 * a reader straight to the one they need (`?tab=account`).
 *
 * Every switch saves on the press. A settings screen with a Save button is a
 * screen whose half-changed state can be abandoned by closing the window, and
 * nothing here is expensive to write. The two exceptions are the ones that
 * must be *checked* before they are kept — the account (it signs in first)
 * and the dashboard's address — and both say so on their own button.
 */
type Tab = "general" | "appearance" | "notifications" | "printing" | "sync" | "backups" | "account" | "about";

const TABS: { key: Tab; Icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "general", Icon: Settings2 },
  { key: "appearance", Icon: Palette },
  { key: "notifications", Icon: Bell },
  { key: "printing", Icon: Printer },
  { key: "sync", Icon: RefreshCw },
  { key: "backups", Icon: Archive },
  { key: "account", Icon: KeyRound },
  { key: "about", Icon: Info },
];

/**
 * What a technician signed in to the app may change here — "very less
 * privileges, only what he can see within his app" (the shop, 2026-11-17):
 * the language, how it looks, which account it uses, and what it is. No
 * bench, printers, sync, backups or the desk's password.
 */
const TECH_TABS = new Set<Tab>(["general", "appearance", "account", "about"]);

export function SettingsPage() {
  const t = useTranslations("Desk");
  const route = useRoute();
  const sync = useSync();
  const technician = sync.account?.role === "technician";

  const body = (
    <div className="space-y-5">
      <header className="border-s-[3px] border-brand ps-3.5">
        <h1 className="text-[clamp(1.4rem,2.2vw,1.8rem)] font-black leading-tight tracking-[-0.04em] text-ink">
          {t("settings")}
        </h1>
        <p className="text-[0.82rem] font-medium text-muted">{t("settingsSub")}</p>
      </header>
      <SettingsPanel
        technician={technician}
        tab={route.query.tab}
        hrefOf={(key) => `/settings?tab=${key}`}
        onTab={(key) => navigate(`/settings?tab=${key}`, { replace: true })}
      />
    </div>
  );

  // The shop's account opens its settings with the desk's password, every
  // time; a technician's narrow settings open without it.
  // Cancel goes back to the bench — the same place the title bar's own
  // settings button returns to (`app.tsx`).
  return technician ? (
    body
  ) : (
    <LockedPanel reason="settings" cancelHref="/admin/repairs">
      {body}
    </LockedPanel>
  );
}

/**
 * The app's own settings inside the desk's الإعدادات tab (the shop,
 * 2026-11-24): a manager finds the bench's settings and this computer's in one
 * place. Already behind the desk's password — the tab asked for it — so it
 * asks nothing more, and its sections switch in place rather than through the
 * address, which belongs to the desk.
 */
export function AppSettings() {
  const t = useTranslations("Desk");
  const [tab, setTab] = useState<Tab>("general");
  return (
    <section className="space-y-4 border-t border-line pt-5">
      <header className="border-s-[3px] border-brand ps-3.5">
        <h2 className="text-[1.05rem] font-black leading-tight tracking-[-0.02em] text-ink">{t("appSettingsTitle")}</h2>
        <p className="text-[0.8rem] font-medium text-muted">{t("settingsSub")}</p>
      </header>
      <SettingsPanel technician={false} tab={tab} onTab={setTab} />
    </section>
  );
}

/** The sections and their list — the page's, and the desk's settings tab's. */
function SettingsPanel({
  technician,
  tab: asked,
  onTab,
  hrefOf,
}: {
  technician: boolean;
  tab: string | undefined;
  onTab: (tab: Tab) => void;
  /** On the page each section has an address; inside the desk it is a press. */
  hrefOf?: (tab: Tab) => string;
}) {
  const t = useTranslations("Desk");
  const tabs = technician ? TABS.filter((entry) => TECH_TABS.has(entry.key)) : TABS;
  const tab: Tab = tabs.some((entry) => entry.key === asked) ? (asked as Tab) : "general";

  return (
    <div className="grid gap-5 md:grid-cols-[14rem_1fr]">
      <nav aria-label={t("settings")} className="md:sticky md:top-20 md:self-start">
        <ul className="flex gap-1.5 overflow-x-auto md:flex-col">
          {tabs.map(({ key, Icon }) => {
            const look = cn(
              "flex w-full items-center gap-2.5 rounded-control border px-3.5 py-2.5 text-start text-[0.8rem] font-extrabold transition-colors",
              tab === key
                ? "border-brand/45 bg-brand/8 text-brand"
                : "border-transparent text-muted hover:border-line hover:text-ink",
            );
            const label = (
              <>
                <Icon className="size-4 shrink-0" />
                {t(`tab_${key}`)}
              </>
            );
            return (
              <li key={key} className="shrink-0">
                {hrefOf ? (
                  <a
                    href={hrefOf(key)}
                    onClick={(event) => {
                      event.preventDefault();
                      onTab(key);
                    }}
                    aria-current={tab === key ? "page" : undefined}
                    className={look}
                  >
                    {label}
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => onTab(key)}
                    aria-pressed={tab === key}
                    className={look}
                  >
                    {label}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      <section className="desk-rise min-w-0 rounded-panel border border-line bg-surface p-5 shadow-card" key={tab}>
        {technician && (
          <p className="mb-4 rounded-card border border-info/35 bg-info/6 px-3.5 py-2.5 text-[0.78rem] font-bold leading-relaxed text-info">
            {t("techSettingsNote")}
          </p>
        )}
        {tab === "general" && <General technician={technician} />}
        {tab === "appearance" && <Appearance />}
        {tab === "notifications" && <Notifications />}
        {tab === "printing" && <Printing />}
        {tab === "sync" && <SyncSettings />}
        {tab === "backups" && <Backups />}
        {tab === "account" && (
          <>
            <Account />
            {!technician && <DeskPassword />}
          </>
        )}
        {tab === "about" && <About />}
      </section>
    </div>
  );
}

/** Saves one setting and says nothing — the control itself shows the new state. */
function useSave() {
  return (patch: Partial<AppSettings>) => void saveSettings(patch);
}

/* ── General ──────────────────────────────────────────────────────────────── */

function General({ technician }: { technician: boolean }) {
  const t = useTranslations("Desk");
  const settings = useSettings();
  const save = useSave();
  const [benches, setBenches] = useState<RepairService[] | null>(null);

  useEffect(() => {
    let alive = true;
    void window.desk.benches().then((list) => {
      if (alive) setBenches(list);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div>
      <Section title={t("language")} hint={t("languageHint")}>
        <ChoiceCards
          value={settings.locale}
          onChange={(locale) => save({ locale })}
          options={[
            { value: "ar", label: "العربية", hint: "اتجاه من اليمين لليسار", Icon: Languages },
            { value: "en", label: "English", hint: "Left to right", Icon: Languages },
          ]}
        />
      </Section>

      {!technician && (
      <>
      <Section title={t("bench")} hint={t("benchHint")}>
        {benches === null ? (
          <Loader2 className="size-4 animate-spin text-muted" aria-hidden />
        ) : (
          <ChoiceCards
            value={settings.service}
            onChange={(service) => save({ service })}
            options={[
              { value: "hardware" as const, label: t("benchHardware"), hint: t("benchHardwareHint"), Icon: Wrench },
              { value: "software" as const, label: t("benchSoftware"), hint: t("benchSoftwareHint"), Icon: Cpu },
            ].filter((option) => benches.includes(option.value) || option.value === settings.service)}
          />
        )}
        {benches !== null && benches.length < 2 && <Callout>{t("benchOnlyOne")}</Callout>}
      </Section>

      <Section title={t("windowSection")}>
        <div className="flex flex-wrap gap-2">
          <Toggle label={t("startWithWindows")} on={settings.startWithWindows} onChange={(on) => save({ startWithWindows: on })} />
          <Toggle
            label={t("startMinimized")}
            on={settings.startMinimized}
            disabled={!settings.startWithWindows}
            onChange={(on) => save({ startMinimized: on })}
          />
          <Toggle label={t("closeToTray")} on={settings.closeToTray} onChange={(on) => save({ closeToTray: on })} />
        </div>
        <p className="text-[0.72rem] leading-relaxed text-muted">{t("closeToTrayHint")}</p>
      </Section>
      </>
      )}
    </div>
  );
}

/* ── Appearance ───────────────────────────────────────────────────────────── */

const SCALES = [0.85, 0.9, 1, 1.1, 1.2, 1.3];

function Appearance() {
  const t = useTranslations("Desk");
  const settings = useSettings();
  const save = useSave();
  return (
    <div>
      <Section title={t("theme")}>
        <ChoiceCards
          cols={3}
          value={settings.theme}
          onChange={(theme) => save({ theme })}
          options={[
            { value: "light", label: t("themeLight"), Icon: Sun },
            { value: "dark", label: t("themeDark"), Icon: Moon },
            { value: "system", label: t("themeSystem"), hint: t("themeSystemHint"), Icon: Monitor },
          ]}
        />
      </Section>

      <Section title={t("textSize")} hint={t("textSizeHint")}>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("textSize")}>
          {SCALES.map((scale) => (
            <button
              key={scale}
              type="button"
              role="radio"
              aria-checked={settings.fontScale === scale}
              onClick={() => save({ fontScale: scale })}
              className={cn(
                "rounded-control border px-3.5 py-2 font-extrabold transition-colors",
                settings.fontScale === scale
                  ? "border-brand bg-brand/8 text-brand"
                  : "border-line text-muted hover:border-line-strong hover:text-ink",
              )}
              style={{ fontSize: `${0.8 * scale}rem` }}
            >
              <span data-numeric>{Math.round(scale * 100)}%</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title={t("motion")}>
        <Toggle label={t("reduceMotion")} on={settings.reduceMotion} onChange={(on) => save({ reduceMotion: on })} />
        <p className="text-[0.72rem] leading-relaxed text-muted">{t("reduceMotionHint")}</p>
      </Section>
    </div>
  );
}

/* ── Notifications ────────────────────────────────────────────────────────── */

function Notifications() {
  const t = useTranslations("Desk");
  const settings = useSettings();
  const save = useSave();
  return (
    <div>
      <Section title={t("notifyWhat")} hint={t("notifyWhatHint")}>
        <div className="flex flex-wrap gap-2">
          <Toggle label={t("notifyNewTickets")} on={settings.notifyNewTickets} onChange={(on) => save({ notifyNewTickets: on })} />
          <Toggle label={t("notifyChanges")} on={settings.notifyChanges} onChange={(on) => save({ notifyChanges: on })} />
          <Toggle
            label={t("notifySyncProblems")}
            tone="warning"
            on={settings.notifySyncProblems}
            onChange={(on) => save({ notifySyncProblems: on })}
          />
          <Toggle label={t("notifyConnection")} on={settings.notifyConnection} onChange={(on) => save({ notifyConnection: on })} />
        </div>
      </Section>
      <Section title={t("notifySound")}>
        <Toggle label={t("notifySoundToggle")} on={settings.notifySound} onChange={(on) => save({ notifySound: on })} />
        <p className="text-[0.72rem] leading-relaxed text-muted">{t("notifySoundHint")}</p>
      </Section>
    </div>
  );
}

/* ── Printing ─────────────────────────────────────────────────────────────── */

function Printing() {
  const t = useTranslations("Desk");
  const tAdmin = useTranslations("Admin");
  const settings = useSettings();
  const save = useSave();
  const [info, setInfo] = useState<AgentInfo | null>(null);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    let alive = true;
    const read = () =>
      void window.desk.agentInfo().then((answer) => {
        if (alive) setInfo(answer);
      });
    read();
    const timer = setInterval(read, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  async function restart() {
    setRestarting(true);
    setInfo(await window.desk.restartAgent());
    setRestarting(false);
  }

  return (
    <div>
      <Section title={t("printersTitle")} hint={t("printersHint")}>
        <button
          type="button"
          onClick={(event) => openPrinterSetup(event.currentTarget.ownerDocument)}
          className="press inline-flex items-center gap-2 rounded-control bg-brand px-4 py-2.5 text-[0.8rem] font-extrabold text-white transition-colors hover:bg-brand-hover"
        >
          <Printer className="size-4" aria-hidden />
          {tAdmin("psSetupButton")}
        </button>
      </Section>

      <Section
        title={t("agentTitle")}
        hint={t("agentHint")}
        aside={
          info && (
            <span
              className={cn(
                "rounded-chip px-2.5 py-1 text-[0.7rem] font-extrabold",
                info.running ? "bg-success/12 text-success" : "bg-warning/12 text-warning",
              )}
            >
              {info.running ? t("agentRunning") : t("agentStopped")}
            </span>
          )
        }
      >
        {info ? (
          <dl className="grid grid-cols-2 gap-2.5 max-sm:grid-cols-1">
            <Fact label={t("agentMachine")} value={info.machine ?? "—"} />
            <Fact label={t("agentVersion")} value={info.version !== null ? String(info.version) : "—"} />
            <Fact label={t("agentWho")} value={info.managed ? t("agentManaged") : info.running ? t("agentFound") : "—"} />
            <Fact label={t("agentBundled")} value={info.bundled ? t("yes") : t("no")} />
          </dl>
        ) : (
          <Loader2 className="size-4 animate-spin text-muted" aria-hidden />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void restart()}
            disabled={restarting}
            className="press inline-flex items-center gap-2 rounded-control border border-line px-3.5 py-2 text-[0.78rem] font-extrabold text-ink transition-colors hover:border-brand hover:text-brand disabled:opacity-60"
          >
            {restarting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RotateCcw className="size-4" aria-hidden />}
            {t("agentRestart")}
          </button>
          <Toggle label={t("agentAutoStart")} on={settings.agentAutoStart} onChange={(on) => save({ agentAutoStart: on })} />
        </div>
        <p className="text-[0.72rem] leading-relaxed text-muted">{t("agentRestartHint")}</p>
      </Section>
    </div>
  );
}

/* ── Sync ─────────────────────────────────────────────────────────────────── */

const INTERVALS = [10, 15, 30, 60, 120, 300];

function SyncSettings() {
  const t = useTranslations("Desk");
  const settings = useSettings();
  const sync = useSync();
  const save = useSave();
  const [site, setSite] = useState(settings.siteUrl);
  const siteValid = /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(site.trim().replace(/\/+$/, ""));

  return (
    <div>
      <Section title={t("syncInterval")} hint={t("syncIntervalHint")}>
        <SelectField
          value={String(settings.syncIntervalSec)}
          onChange={(value) => save({ syncIntervalSec: Number(value) })}
          options={INTERVALS.map((seconds) => ({
            value: String(seconds),
            label: seconds < 60 ? t("everySeconds", { count: seconds }) : t("everyMinutes", { count: seconds / 60 }),
          }))}
          className="max-w-[16rem]"
        />
      </Section>

      <Section title={t("syncNowTitle")}>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void syncNow()}
            disabled={sync.state === "syncing"}
            className="press inline-flex items-center gap-2 rounded-control bg-brand px-4 py-2.5 text-[0.8rem] font-extrabold text-white transition-colors hover:bg-brand-hover disabled:opacity-60"
          >
            {sync.state === "syncing" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
            {t("syncNow")}
          </button>
          <button
            type="button"
            onClick={openSyncPanel}
            className="press inline-flex items-center gap-2 rounded-control border border-line px-4 py-2.5 text-[0.8rem] font-extrabold text-ink transition-colors hover:border-brand hover:text-brand"
          >
            <Database className="size-4" aria-hidden />
            {t("syncTitle")}
          </button>
        </div>
      </Section>

      <Section title={t("siteUrl")} hint={t("siteUrlHint")}>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="url"
            dir="ltr"
            value={site}
            onChange={(event) => setSite(event.target.value)}
            className={cn(input, "max-w-[22rem]")}
          />
          <button
            type="button"
            disabled={!siteValid || site.trim().replace(/\/+$/, "") === settings.siteUrl}
            onClick={() => {
              void saveSettings({ siteUrl: site.trim().replace(/\/+$/, "") }).then((saved) => {
                setSite(saved.siteUrl);
                toast.success(t("saved"));
              });
            }}
            className="press inline-flex h-10 items-center gap-2 rounded-control bg-ink px-4 text-[0.78rem] font-extrabold text-surface transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <Save className="size-4" aria-hidden />
            {t("save")}
          </button>
        </div>
        {!siteValid && <p className="text-[0.72rem] font-bold text-brand">{t("siteUrlInvalid")}</p>}
      </Section>
    </div>
  );
}

/* ── Backups ──────────────────────────────────────────────────────────────── */

const EVERY_HOURS = [1, 3, 6, 12, 24];
const KEEP = [10, 30, 60, 120];

function Backups() {
  const t = useTranslations("Desk");
  const locale = useLocale();
  const settings = useSettings();
  const save = useSave();
  const [list, setList] = useState<BackupInfo[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    void window.desk.backups().then((backups) => {
      if (alive) setList(backups);
    });
    return () => {
      alive = false;
    };
  }, [version]);

  async function run(key: string, task: () => Promise<{ ok: boolean; error?: string } | unknown>) {
    setBusy(key);
    try {
      const result = (await task()) as { ok?: boolean; error?: string } | null;
      if (result && result.ok === false) {
        // "cancelled" is the reader closing the file picker — not a failure.
        if (result.error !== "cancelled") {
          const key = `backupError_${result.error}`;
          toast.error(t("backupFailed", { error: t.has(key) ? t(key) : (result.error ?? "") }));
        }
      } else {
        toast.success(t("done"));
      }
    } finally {
      setBusy(null);
      setVersion((n) => n + 1);
    }
  }

  const size = (bytes: number) =>
    bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

  return (
    <div>
      <Section title={t("backupsTitle")} hint={t("backupsHint")}>
        <div className="flex flex-wrap gap-2">
          <ActionButton busy={busy === "now"} onClick={() => void run("now", () => window.desk.backupNow())} Icon={Save} primary>
            {t("backupNow")}
          </ActionButton>
          <ActionButton busy={busy === "export"} onClick={() => void run("export", () => window.desk.exportBackup())} Icon={HardDriveUpload}>
            {t("backupExport")}
          </ActionButton>
          <ActionButton busy={busy === "import"} onClick={() => void run("import", () => window.desk.importBackup())} Icon={HardDriveDownload}>
            {t("backupImport")}
          </ActionButton>
          <ActionButton busy={false} onClick={() => void window.desk.revealBackups()} Icon={FolderOpen}>
            {t("backupReveal")}
          </ActionButton>
        </div>
      </Section>

      <Section title={t("backupSchedule")}>
        <div className="grid grid-cols-2 gap-3.5 max-sm:grid-cols-1">
          <Field label={t("backupEvery")}>
            <SelectField
              value={String(settings.backupEveryHours)}
              onChange={(value) => save({ backupEveryHours: Number(value) })}
              options={EVERY_HOURS.map((hours) => ({ value: String(hours), label: t("everyHours", { count: hours }) }))}
            />
          </Field>
          <Field label={t("backupKeep")}>
            <SelectField
              value={String(settings.backupKeep)}
              onChange={(value) => save({ backupKeep: Number(value) })}
              options={KEEP.map((count) => ({ value: String(count), label: t("keepCopies", { count }) }))}
            />
          </Field>
        </div>
        <Toggle label={t("backupOnQuit")} on={settings.backupOnQuit} onChange={(on) => save({ backupOnQuit: on })} />
      </Section>

      <Section title={t("backupMirror")} hint={t("backupMirrorHint")}>
        <div className="flex flex-wrap items-center gap-2">
          {/* A path is set in a fixed-width face so its separators line up; the
              Arabic "not set" is not, because a monospace face pulls joined
              letters apart. */}
          {settings.backupMirror ? (
            <span
              dir="ltr"
              className="min-w-0 max-w-full truncate rounded-control border border-line bg-canvas px-3 py-2 font-mono text-[0.74rem] text-ink"
            >
              {settings.backupMirror}
            </span>
          ) : (
            <span className="rounded-control border border-dashed border-line px-3 py-2 text-[0.76rem] font-bold text-muted">
              {t("backupMirrorNone")}
            </span>
          )}
          <ActionButton
            busy={busy === "mirror"}
            onClick={() =>
              void (async () => {
                setBusy("mirror");
                const folder = await window.desk.chooseMirrorFolder();
                if (folder) await saveSettings({ backupMirror: folder });
                setBusy(null);
              })()
            }
            Icon={FolderOpen}
          >
            {t("backupMirrorChoose")}
          </ActionButton>
          {settings.backupMirror && (
            <button
              type="button"
              onClick={() => save({ backupMirror: null })}
              aria-label={t("backupMirrorClear")}
              title={t("backupMirrorClear")}
              className="inline-flex size-9 items-center justify-center rounded-control text-muted transition-colors hover:bg-brand/8 hover:text-brand"
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
        </div>
      </Section>

      <Section title={t("backupList")} aside={list && <span className="text-[0.72rem] font-bold text-muted" data-numeric>{list.length}</span>}>
        {list === null ? (
          <Loader2 className="size-4 animate-spin text-muted" aria-hidden />
        ) : list.length === 0 ? (
          <p className="text-[0.8rem] font-medium text-muted">{t("backupNone")}</p>
        ) : (
          <ul className="divide-y divide-line/70 overflow-hidden rounded-card border border-line">
            {list.map((backup) => (
              <li key={backup.name} className="flex flex-wrap items-center gap-3 bg-surface px-3.5 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.8rem] font-extrabold text-ink">{formatDayTime(locale, backup.at)}</span>
                  <span className="block text-[0.7rem] font-medium text-muted">
                    {t.has(`backupReason_${backup.reason}`) ? t(`backupReason_${backup.reason}`) : backup.reason} ·{" "}
                    <span data-numeric>{size(backup.size)}</span>
                  </span>
                </span>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void run(`restore:${backup.name}`, () => window.desk.restoreBackup(backup.name))}
                  className="inline-flex items-center gap-1.5 rounded-control border border-line px-2.5 py-1.5 text-[0.72rem] font-extrabold text-ink transition-colors hover:border-brand hover:text-brand disabled:opacity-50"
                >
                  {busy === `restore:${backup.name}` ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <RotateCcw className="size-3.5" aria-hidden />
                  )}
                  {t("backupRestore")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function ActionButton({
  busy,
  onClick,
  Icon,
  primary,
  children,
}: {
  busy: boolean;
  onClick: () => void;
  Icon: React.ComponentType<{ className?: string }>;
  primary?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        "press inline-flex items-center gap-2 rounded-control px-3.5 py-2 text-[0.78rem] font-extrabold transition-colors disabled:opacity-60",
        primary
          ? "bg-brand text-white hover:bg-brand-hover"
          : "border border-line text-ink hover:border-brand hover:text-brand",
      )}
    >
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Icon className="size-4" aria-hidden />}
      {children}
    </button>
  );
}

/* ── Account ──────────────────────────────────────────────────────────────── */

function Account() {
  const t = useTranslations("Desk");
  const tRoles = useTranslations("Roles");
  const [info, setInfo] = useState<AccountInfo | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void window.desk.account().then((account) => {
      if (!alive) return;
      setInfo(account);
      setEmail(account.email);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function submit() {
    setConfirming(false);
    setSaving(true);
    setError(null);
    const result = await window.desk.setAccount({ email, password });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPassword("");
    toast.success(t("accountSaved"));
    setInfo(await window.desk.account());
  }

  const changed = info !== null && (email.trim() !== info.email || password.length > 0);

  return (
    <div>
      <Section title={t("accountTitle")} hint={t("accountHint")}>
        {info?.name && (
          <p className="rounded-card border border-line bg-canvas px-3.5 py-2.5 text-[0.8rem] font-bold text-ink">
            {info.name}
            {info.role && (
              <span className="ms-2 text-[0.72rem] font-bold text-muted">
                {tRoles.has(info.role) ? tRoles(info.role) : info.role}
              </span>
            )}
          </p>
        )}
        <Callout title={t("accountWhyTitle")}>{t("accountWhy")}</Callout>
        <div className="grid grid-cols-2 gap-3.5 max-sm:grid-cols-1">
          <Field label={t("accountEmail")}>
            <input
              type="email"
              dir="ltr"
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={input}
            />
          </Field>
          <Field label={t("accountPassword")} hint={info?.hasPassword ? t("accountPasswordKept") : undefined}>
            <input
              type="password"
              dir="ltr"
              autoComplete="new-password"
              value={password}
              placeholder={info?.hasPassword ? "••••••••" : ""}
              onChange={(event) => setPassword(event.target.value)}
              className={input}
            />
          </Field>
        </div>
        {error && (
          <p className="rounded-card border border-brand/30 bg-brand/6 px-3.5 py-2.5 text-[0.78rem] font-bold text-brand">
            {t.has(`accountError_${error}`) ? t(`accountError_${error}`) : error}
          </p>
        )}
        <button
          type="button"
          disabled={!changed || !password || saving}
          onClick={() => setConfirming(true)}
          className="press inline-flex items-center gap-2 rounded-control bg-brand px-4 py-2.5 text-[0.8rem] font-extrabold text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
        >
          {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <KeyRound className="size-4" aria-hidden />}
          {t("accountTest")}
        </button>
      </Section>

      <ConfirmDialog
        open={confirming}
        tone="normal"
        title={t("accountConfirmTitle")}
        body={t("accountConfirmBody")}
        confirmLabel={t("accountTest")}
        cancelLabel={t("cancel")}
        onConfirm={() => void submit()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}

/* ── The desk's password ───────────────────────────────────────────────────── */

/**
 * Changing the desk's password (`src/main/desk-lock.ts`). The current one is
 * asked again even though these settings already sit behind it: a settings
 * page left open is not a reason to let whoever walks up change the lock.
 */
function DeskPassword() {
  const t = useTranslations("Desk");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (next !== again) {
      setError("mismatch");
      return;
    }
    setSaving(true);
    setError(null);
    const result = await window.desk.setDeskPassword({ current, next });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setCurrent("");
    setNext("");
    setAgain("");
    toast.success(t("lockSaved"));
  }

  const field = (value: string, set: (value: string) => void) => (
    <input
      type="password"
      inputMode="numeric"
      dir="ltr"
      autoComplete="off"
      value={value}
      onChange={(event) => {
        set(event.target.value);
        setError(null);
      }}
      className={input}
    />
  );

  return (
    <Section title={t("lockTitle")} hint={t("lockHint")}>
      <div className="grid grid-cols-3 gap-3.5 max-sm:grid-cols-1">
        <Field label={t("lockCurrent")}>{field(current, setCurrent)}</Field>
        <Field label={t("lockNew")}>{field(next, setNext)}</Field>
        <Field label={t("lockAgain")}>{field(again, setAgain)}</Field>
      </div>
      {error && (
        <p className="rounded-card border border-brand/30 bg-brand/6 px-3.5 py-2.5 text-[0.78rem] font-bold text-brand">
          {t(`lockError_${error}`)}
        </p>
      )}
      <button
        type="button"
        disabled={!current || !next || !again || saving}
        onClick={() => void submit()}
        className="press inline-flex items-center gap-2 rounded-control bg-brand px-4 py-2.5 text-[0.8rem] font-extrabold text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
      >
        {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <KeyRound className="size-4" aria-hidden />}
        {t("lockSave")}
      </button>
    </Section>
  );
}

/* ── About ────────────────────────────────────────────────────────────────── */

function About() {
  const t = useTranslations("Desk");
  const [info, setInfo] = useState<{ version: string; electron: string; dataPath: string; platform: string } | null>(null);

  useEffect(() => {
    let alive = true;
    void window.desk.app.info().then((answer) => {
      if (alive) setInfo(answer);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div>
      <Section title={t("aboutTitle")}>
        <dl className="grid grid-cols-2 gap-2.5 max-sm:grid-cols-1">
          <Fact label={t("aboutVersion")} value={info?.version ?? "—"} />
          <Fact label="Electron" value={info?.electron ?? "—"} />
        </dl>
        <Fact label={t("aboutData")} value={<span dir="ltr" className="font-mono text-[0.74rem]">{info?.dataPath ?? "—"}</span>} />
      </Section>
      <Section title={t("aboutTools")}>
        <div className="flex flex-wrap gap-2">
          <ActionButton busy={false} onClick={() => void window.desk.app.openLogs()} Icon={FolderOpen}>
            {t("aboutLogs")}
          </ActionButton>
          <ActionButton busy={false} onClick={() => void window.desk.app.relaunch()} Icon={RotateCcw}>
            {t("aboutRelaunch")}
          </ActionButton>
        </div>
      </Section>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-canvas px-3.5 py-2.5">
      <dt className="text-[0.68rem] font-bold text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-[0.84rem] font-extrabold text-ink">{value}</dd>
    </div>
  );
}

import { useTranslations } from "next-intl";
import { KeyRound, Loader2, RefreshCw, Settings, WifiOff } from "lucide-react";
import { BrandMark } from "@/components/store/brand-logo";
import { cn } from "@/lib/utils";
import { navigate } from "../lib/router";
import { syncNow, useSync } from "../lib/sync";

/**
 * What the window shows before it has a bench to show.
 *
 * ---------------------------------------------------------------------------
 * Four different situations, and they must not look alike
 * ---------------------------------------------------------------------------
 * - **Opening** — the local read is a few milliseconds; this is what a slow
 *   disk shows for one frame.
 * - **Never downloaded** (`no_data`) — this computer has not yet held the bench.
 *   It needs the line *once*; after that it works without one. Said in those
 *   words, because "no tickets" on a fresh install reads as the shop having no
 *   work, and "offline" alone reads as the app being broken.
 * - **No account** (`no_account`) — the maintenance account's password is not
 *   on this computer. A screen that only said "could not sign in" would send
 *   somebody to check the internet.
 * - **A failure** — the read itself threw. Rare, and it has a retry.
 *
 * Each is distinguished by what the reader can *do* about it, which is why
 * each has its own control.
 */
export function FirstRun({
  reason,
  detail,
}: {
  reason: "loading" | "error" | "no_data" | "no_account";
  detail?: string;
}) {
  const t = useTranslations("Desk");
  const sync = useSync();

  if (reason === "loading") {
    return (
      <Centre>
        <BrandMark className="animate-breathe size-12" />
        <Bar />
      </Centre>
    );
  }

  if (reason === "no_account" || sync.state === "auth") {
    return (
      <Centre>
        <Badge tone="warning">
          <KeyRound className="size-6" aria-hidden />
        </Badge>
        <h1 className="text-[1.15rem] font-black text-ink">{t("firstAccountTitle")}</h1>
        <p className="max-w-[28rem] text-center text-[0.84rem] font-medium leading-relaxed text-muted">
          {t("firstAccountBody")}
        </p>
        {sync.lastError && <Detail>{sync.lastError}</Detail>}
        <button
          type="button"
          onClick={() => navigate("/settings?tab=account")}
          className="press inline-flex items-center gap-2 rounded-control bg-brand px-5 py-2.5 text-[0.82rem] font-extrabold text-white transition-colors hover:bg-brand-hover"
        >
          <Settings className="size-4" aria-hidden />
          {t("firstAccountAction")}
        </button>
      </Centre>
    );
  }

  if (reason === "error") {
    return (
      <Centre>
        <Badge tone="brand">
          <RefreshCw className="size-6" aria-hidden />
        </Badge>
        <h1 className="text-[1.15rem] font-black text-ink">{t("firstErrorTitle")}</h1>
        {detail && <Detail>{detail}</Detail>}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="press inline-flex items-center gap-2 rounded-control bg-brand px-5 py-2.5 text-[0.82rem] font-extrabold text-white transition-colors hover:bg-brand-hover"
        >
          <RefreshCw className="size-4" aria-hidden />
          {t("retry")}
        </button>
      </Centre>
    );
  }

  // Never downloaded.
  const offline = !sync.online || sync.state === "offline";
  return (
    <Centre>
      {offline ? (
        <Badge tone="warning">
          <WifiOff className="size-6" aria-hidden />
        </Badge>
      ) : (
        <BrandMark className="animate-breathe size-12" />
      )}
      <h1 className="text-[1.15rem] font-black text-ink">
        {offline ? t("firstOfflineTitle") : t("firstDownloadTitle")}
      </h1>
      <p className="max-w-[30rem] text-center text-[0.84rem] font-medium leading-relaxed text-muted">
        {offline ? t("firstOfflineBody") : t("firstDownloadBody")}
      </p>
      {!offline && <Bar />}
      {sync.lastError && offline && <Detail>{sync.lastError}</Detail>}
      <button
        type="button"
        onClick={() => void syncNow()}
        disabled={sync.state === "syncing"}
        className="press inline-flex items-center gap-2 rounded-control border border-line px-4 py-2 text-[0.8rem] font-extrabold text-ink transition-colors hover:border-brand hover:text-brand disabled:opacity-60"
      >
        {sync.state === "syncing" ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <RefreshCw className="size-4" aria-hidden />
        )}
        {t("syncNow")}
      </button>
    </Centre>
  );
}

function Centre({ children }: { children: React.ReactNode }) {
  return (
    <div className="desk-rise flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 py-16">{children}</div>
  );
}

function Badge({ tone, children }: { tone: "warning" | "brand"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "flex size-14 items-center justify-center rounded-panel",
        tone === "warning" ? "bg-warning/12 text-warning" : "bg-brand/12 text-brand",
      )}
    >
      {children}
    </span>
  );
}

function Bar() {
  return (
    <span className="block h-[3px] w-40 overflow-hidden rounded-full bg-line/70">
      <span className="animate-indeterminate block h-full w-1/3 rounded-full bg-brand" />
    </span>
  );
}

function Detail({ children }: { children: React.ReactNode }) {
  return (
    <p
      dir="ltr"
      className="max-w-[30rem] rounded-card bg-subtle px-3 py-2 text-center font-mono text-[0.7rem] text-muted"
    >
      {children}
    </p>
  );
}

import type { ReactNode } from "react";
import { IntlProvider } from "use-intl";
import siteAr from "@/messages/ar.json";
import siteEn from "@/messages/en.json";
import { DESK_MESSAGES } from "./words";
import overridesAr from "../messages/site-overrides.ar.json";
import overridesEn from "../messages/site-overrides.en.json";
import { useSettings } from "./settings";

/**
 * The words, in the reader's language.
 *
 * ---------------------------------------------------------------------------
 * The whole catalogue, not the dashboard's withheld subset
 * ---------------------------------------------------------------------------
 * The site's root layout withholds 25 namespaces from shoppers and the admin
 * layout hands them back; a component reaching for one that is not there throws
 * `MISSING_MESSAGE` on every render, and nothing in `tsc`, `eslint` or the
 * build says a word about it. A desktop window has no shoppers to save bytes
 * for, so it simply carries everything — 600KB of JSON in a 100MB install — and
 * that whole class of failure cannot happen here.
 *
 * The app's own copy rides under `Desk` (`src/renderer/messages/`).
 *
 * ---------------------------------------------------------------------------
 * Baghdad's clock, whatever the PC's
 * ---------------------------------------------------------------------------
 * `timeZone` is pinned for the reason it is pinned in the site's
 * `i18n/request.ts`: a counter PC left on UTC would file the first three hours
 * of every day under the day before, and the board's day rules and "today"
 * would disagree with the dashboard about the same ticket. Iraq keeps no DST,
 * so the zone is one fixed offset.
 */
const SITE = { ar: siteAr, en: siteEn } as const;

/**
 * A handful of the dashboard's own lines, said the desk's way.
 *
 * The printer setup and the print station speak to somebody in a browser —
 * "saved in this browser only", "run start.cmd from tools/print-agent", "the
 * browser blocked the connection". None of that is true here: the settings
 * are this computer's, the app starts the agent itself, and nothing sits
 * between the two. `messages/site-overrides.*.json` replaces exactly those
 * keys and nothing else; `npm test` fails if one of them stops existing on the
 * site, so a renamed key cannot quietly fall back to the browser's wording.
 */
function withOverrides(site: typeof siteAr, overrides: Record<string, Record<string, string>>) {
  const out: Record<string, unknown> = { ...site };
  for (const [namespace, keys] of Object.entries(overrides)) {
    out[namespace] = { ...(site as Record<string, object>)[namespace], ...keys };
  }
  return out as typeof siteAr;
}

const BUNDLES = {
  ar: { ...withOverrides(SITE.ar, overridesAr), Desk: DESK_MESSAGES.ar },
  en: { ...withOverrides(SITE.en as typeof siteAr, overridesEn), Desk: DESK_MESSAGES.en },
};

export function DeskIntl({ children }: { children: ReactNode }) {
  const { locale } = useSettings();
  return (
    <IntlProvider
      locale={locale}
      messages={BUNDLES[locale]}
      timeZone="Asia/Baghdad"
      onError={(error) => {
        // A missing key is a copy bug, not a crash: the fallback below draws
        // the key's own name and the log says which one.
        console.warn(`[intl] ${error.code}: ${error.message}`);
      }}
      getMessageFallback={({ namespace, key }) => (namespace ? `${namespace}.${key}` : key)}
    >
      {children}
    </IntlProvider>
  );
}

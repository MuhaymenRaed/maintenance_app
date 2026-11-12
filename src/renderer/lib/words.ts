import ar from "../messages/desk.ar.json";
import en from "../messages/desk.en.json";
import { readSettings } from "./settings";

/**
 * The app's own words — everything the desk says that the dashboard does not.
 *
 * The dashboard's copy rides in whole from `src/site/messages/` and the copied
 * components read it with `useTranslations("Admin")` exactly as they always
 * have. What is new here is only the desk itself: the title bar, the sync
 * panel, the settings, the first run. They live under one namespace, `Desk`,
 * which `lib/intl.tsx` merges into the provider's bundle.
 *
 * ⚠️ `DeskKey` is a union over the English file, so a key the Arabic file lacks
 * is caught by `npm test` (`test/messages.test.ts`) and a key nothing defines
 * is a type error at the call site — the app's own `check:messages`, scaled to
 * one namespace.
 */
export const DESK_MESSAGES = { ar, en } as const;

export type DeskKey = keyof typeof en;

/**
 * One line of the desk's copy, outside React — a toast from an override, a
 * confirm's words. `{name}` placeholders only; anything that needs ICU plurals
 * belongs in a component reading `useTranslations("Desk")`.
 */
export function say(key: DeskKey, values?: Record<string, string | number>): string {
  const locale = readSettings().locale;
  const text = (DESK_MESSAGES[locale] as Record<string, string>)[key] ?? en[key] ?? key;
  if (!values) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    values[name] === undefined ? whole : String(values[name]),
  );
}

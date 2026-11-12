/**
 * `next-intl`, which is `use-intl` with a Next.js server half bolted on.
 *
 * The desk draws the dashboard's components and they read their words with
 * `useTranslations` and `useLocale` — client hooks that next-intl re-exports
 * from `use-intl` unchanged. So this is the whole of what the app needs, and
 * nothing here can reach for `next/headers`.
 *
 * `NextIntlClientProvider` is the name the site's layouts use; it is
 * `IntlProvider` underneath, which is what next-intl's own wrapper renders.
 */
export {
  IntlProvider,
  IntlProvider as NextIntlClientProvider,
  useFormatter,
  useLocale,
  useMessages,
  useNow,
  useTimeZone,
  useTranslations,
} from "use-intl";

export type { AbstractIntlMessages, Formats, Locale, TranslationValues } from "use-intl";

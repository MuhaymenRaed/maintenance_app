"use client";

import { Fragment, useState, useTransition, type ComponentType, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ArrowUpLeft, ListChecks, Loader2, Printer, Settings2, Target, UserCog, UserRound, Users } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Select } from "@/components/ui/select";
import { FaultList } from "@/components/admin/fault-picker";
import { PrinterSetupButton } from "@/components/admin/printer-setup";
import { setDeskDefaultHolder } from "@/lib/actions/repair-desk";
import { cn } from "@/lib/utils";
import { TabHeading } from "@/components/admin/maintenance/figure-cards";
import type { DeskShared } from "@/components/admin/maintenance/desk-shared";

/** One entry in the settings' side list, and what it opens. */
export type SettingsSection = {
  key: string;
  label: string;
  Icon: ComponentType<{ className?: string }>;
  /** The line under the section's title. */
  hint?: string;
  content: ReactNode;
};

/** The desktop app's own sections, listed under the bench's. */
export type SettingsGroup = { title: string; sections: readonly SettingsSection[] };

/**
 * الإعدادات — what the maintenance section is set up with (the shop,
 * 2026-11-24): who a new ticket goes to, the bench's list of faults, which
 * printer takes which paper, and where its people and their goals are kept.
 *
 * A side list with one section open at a time (the shop, 2026-11-25), the
 * shape of the desktop app's own settings. It was four cards side by side
 * with the whole fault list open under them, a page of inputs to scroll past
 * to reach anything else.
 *
 * In the desktop app this computer's settings join the same list under their
 * own heading (`appSettings`), instead of a second settings screen under the
 * first. A section the app has as well, the printers, is the app's: it holds
 * the same printer setup and the print agent besides.
 */
export function SettingsTab({ shared, appSettings }: { shared: DeskShared; appSettings?: SettingsGroup }) {
  const t = useTranslations("Admin");
  const { data } = shared;
  const { authority, people, service } = data;

  const bench: SettingsSection[] = [
    {
      key: "holder",
      label: t("settingsDefaultTitle"),
      hint: t("settingsDefaultHint"),
      Icon: UserCog,
      content: (
        <DefaultHolder
          service={service}
          current={data.defaultHolderId ?? null}
          canSet={authority.everything}
          options={people
            .filter((person) => authority.visible.includes(person.userId))
            .map((person) => ({ value: person.userId, label: `${person.name} — ${t(`rank_${person.rank}`)}` }))}
        />
      ),
    },
    {
      key: "faults",
      label: t("settingsFaultsTitle"),
      hint: t("settingsFaultsHint"),
      Icon: ListChecks,
      content: authority.manages ? (
        <FaultList service={service} issues={data.issues} allowAdd />
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {data.issues.map((issue) => (
            <li key={issue.code} className="rounded-chip bg-subtle px-2.5 py-1 text-[0.76rem] font-bold text-ink">
              {issue.name}
            </li>
          ))}
        </ul>
      ),
    },
    {
      key: "printing",
      label: t("settingsPrintersTitle"),
      hint: t("settingsPrintersHint"),
      Icon: Printer,
      content: (
        <div className="flex flex-wrap items-center gap-2">
          <PrinterSetupButton />
        </div>
      ),
    },
    {
      key: "people",
      label: t("settingsPeopleTitle"),
      hint: t("settingsPeopleHint"),
      Icon: Users,
      content: (
        <div className="flex flex-wrap gap-2">
          <SettingsLink href="/admin/staff" Icon={UserRound} label={t("settingsPeopleLink")} />
          <SettingsLink href="/admin/team" Icon={Target} label={t("settingsGoalsLink")} />
        </div>
      ),
    },
  ];

  const theirs = new Set(appSettings?.sections.map((section) => section.key));
  const groups: { title: string | null; sections: readonly SettingsSection[] }[] = [
    { title: appSettings ? shared.deskName : null, sections: bench.filter((section) => !theirs.has(section.key)) },
    ...(appSettings ? [{ title: appSettings.title, sections: appSettings.sections }] : []),
  ];
  const all = groups.flatMap((group) => group.sections);
  const [asked, setAsked] = useState(all[0].key);
  const open = all.find((section) => section.key === asked) ?? all[0];

  return (
    <div className="space-y-3.5">
      <TabHeading Icon={Settings2} title={t("deskTab_settings")} hint={t("settingsHint")} />

      <div className="grid gap-4 md:grid-cols-[15rem_minmax(0,1fr)]">
        <nav aria-label={t("deskTab_settings")} className="min-w-0 md:sticky md:top-20 md:self-start">
          <ul className="flex gap-1.5 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0">
            {groups.map((group, index) => (
              <Fragment key={group.title ?? `group-${index}`}>
                {group.title && (
                  <li
                    aria-hidden
                    className={cn("px-3.5 text-[0.68rem] font-black text-muted max-md:hidden", index > 0 ? "pt-3" : "pb-0.5")}
                  >
                    {group.title}
                  </li>
                )}
                {group.sections.map(({ key, label, Icon }) => (
                  <li key={key} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => setAsked(key)}
                      aria-pressed={open.key === key}
                      className={cn(
                        "flex items-center gap-2.5 whitespace-nowrap rounded-control border px-3.5 py-2.5 text-start text-[0.8rem] font-extrabold transition-colors md:w-full",
                        open.key === key
                          ? "border-brand/45 bg-brand/8 text-brand"
                          : "border-transparent text-muted hover:border-line hover:text-ink",
                      )}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden />
                      {label}
                    </button>
                  </li>
                ))}
              </Fragment>
            ))}
          </ul>
        </nav>

        <section
          key={open.key}
          aria-label={open.label}
          className="page-enter min-w-0 rounded-panel border border-line bg-surface p-4 shadow-card sm:p-5"
        >
          <header className="mb-4 flex items-start gap-3 border-b border-line pb-3.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-brand/10 text-brand">
              <open.Icon className="size-4.5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h3 className="text-[0.95rem] font-black text-ink">{open.label}</h3>
              {open.hint && <p className="text-[0.74rem] font-medium leading-relaxed text-muted">{open.hint}</p>}
            </div>
          </header>
          {open.content}
        </section>
      </div>
    </div>
  );
}

function SettingsLink({ href, Icon, label }: { href: string; Icon: typeof Settings2; label: string }) {
  return (
    <Link
      href={href}
      className="press inline-flex items-center gap-2 rounded-control border border-line bg-canvas px-3.5 py-2 text-[0.8rem] font-extrabold text-ink transition-colors hover:border-brand hover:text-brand"
    >
      <Icon className="size-4" aria-hidden />
      {label}
      <ArrowUpLeft className="size-3.5 ltr:-scale-x-100" aria-hidden />
    </Link>
  );
}

/** Who a new ticket goes to unless the counter picks somebody else. An owner's setting. */
function DefaultHolder({
  service,
  current,
  canSet,
  options,
}: {
  service: DeskShared["data"]["service"];
  current: string | null;
  canSet: boolean;
  options: { value: string; label: string }[];
}) {
  const t = useTranslations("Admin");
  const [value, setValue] = useState(current ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const all = [{ value: "", label: t("unassigned") }, ...options];
  const name = all.find((option) => option.value === value)?.label ?? t("unassigned");

  if (!canSet) {
    return (
      <p className="rounded-card bg-subtle px-3 py-2 text-[0.82rem] font-bold text-ink">
        {name}
        <span className="mt-0.5 block text-[0.7rem] font-semibold text-muted">{t("settingsDefaultOwners")}</span>
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={value}
          onChange={(next) => {
            const before = value;
            setValue(next);
            setError(null);
            setSaved(false);
            startTransition(async () => {
              const result = await setDeskDefaultHolder(service, next || null);
              if (!result.ok) {
                setValue(before);
                setError(result.error);
                return;
              }
              setSaved(true);
            });
          }}
          options={all}
          loading={pending}
          aria-label={t("settingsDefaultTitle")}
          className="w-full max-w-72"
          triggerClassName="h-10 rounded-control border border-line bg-canvas px-3 text-[0.8rem] font-bold text-ink transition-colors hover:border-brand/45 focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/20"
        />
        {pending && <Loader2 className="size-4 animate-spin text-muted" aria-hidden />}
        {saved && !pending && <span className="text-[0.74rem] font-extrabold text-success">{t("settingsSaved")}</span>}
      </div>
      {error && (
        <p role="alert" className="text-[0.74rem] font-bold text-brand">
          {t.has(error) ? t(error as "updateFailed") : t("updateFailed")}
        </p>
      )}
    </div>
  );
}

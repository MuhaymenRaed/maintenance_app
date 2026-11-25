"use client";

import { useState, useTransition, type ReactNode } from "react";
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

/**
 * الإعدادات — what the maintenance section is set up with (the shop,
 * 2026-11-24): who a new ticket goes to, the bench's list of faults, which
 * printer takes which paper, and where its people and their goals are kept.
 * The desktop app adds its own below (`appSettings`): the sync, the account,
 * the desk's password, the look, the backups.
 */
export function SettingsTab({ shared, appSettings }: { shared: DeskShared; appSettings?: ReactNode }) {
  const t = useTranslations("Admin");
  const { data } = shared;
  const { authority, people, service } = data;

  return (
    <div className="space-y-3.5">
      <TabHeading Icon={Settings2} title={t("deskTab_settings")} hint={t("settingsHint")} />

      <div className="grid gap-3.5 md:grid-cols-2 lg:grid-cols-3">
        <SettingsCard Icon={UserCog} title={t("settingsDefaultTitle")} hint={t("settingsDefaultHint")}>
          <DefaultHolder
            service={service}
            current={data.defaultHolderId ?? null}
            canSet={authority.everything}
            options={people
              .filter((person) => authority.visible.includes(person.userId))
              .map((person) => ({ value: person.userId, label: `${person.name} — ${t(`rank_${person.rank}`)}` }))}
          />
        </SettingsCard>

        <SettingsCard Icon={Printer} title={t("settingsPrintersTitle")} hint={t("settingsPrintersHint")}>
          <div className="flex flex-wrap items-center gap-2">
            <PrinterSetupButton />
          </div>
        </SettingsCard>

        <SettingsCard Icon={Users} title={t("settingsPeopleTitle")} hint={t("settingsPeopleHint")}>
          <div className="flex flex-wrap gap-2">
            <SettingsLink href="/admin/staff" Icon={UserRound} label={t("settingsPeopleLink")} />
            <SettingsLink href="/admin/team" Icon={Target} label={t("settingsGoalsLink")} />
          </div>
        </SettingsCard>

        <SettingsCard Icon={ListChecks} title={t("settingsFaultsTitle")} hint={t("settingsFaultsHint")} wide>
          {authority.manages ? (
            <FaultList service={service} issues={data.issues} allowAdd />
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {data.issues.map((issue) => (
                <li key={issue.code} className="rounded-chip bg-subtle px-2.5 py-1 text-[0.76rem] font-bold text-ink">
                  {issue.name}
                </li>
              ))}
            </ul>
          )}
        </SettingsCard>
      </div>

      {appSettings}
    </div>
  );
}

function SettingsCard({
  Icon,
  title,
  hint,
  wide = false,
  children,
}: {
  Icon: typeof Settings2;
  title: string;
  hint: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={cn("space-y-3 rounded-panel border border-line bg-surface p-4 shadow-card", wide && "md:col-span-2 lg:col-span-3")}>
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-brand/10 text-brand">
          <Icon className="size-4.5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 className="text-[0.92rem] font-black text-ink">{title}</h3>
          <p className="text-[0.74rem] font-medium leading-relaxed text-muted">{hint}</p>
        </div>
      </div>
      {children}
    </section>
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

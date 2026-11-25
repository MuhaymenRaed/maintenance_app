"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Field, Grid, SelectField } from "@/components/admin/form-kit";
import { SearchableSelect } from "@/components/ui/searchable-select";
import type { StockModel } from "@/lib/data/device-catalogue";
import { formatDayNumeric } from "@/lib/data/datetime";
import { deskModelOptions, type RecentDevice } from "@/lib/data/recent-devices";
import { useWorldModels } from "@/lib/hooks/use-world-models";

/**
 * The make and the model, the counter's way: "every make" is a real choice,
 * the model is searched rather than retyped, and an unlisted phone is typed
 * and kept (`allowCustom`). One control for the add-ticket window and the
 * ticket editor, so a device is named the same way wherever it is entered —
 * see `lib/data/device-name.ts` for why that matters on paper.
 *
 * ⚠️ Changing the make clears the model, in the handler: the field would
 * otherwise keep the previous make's phone, which reads as a filled-in answer.
 */
export function DeviceFields({
  brandCode,
  model,
  onChange,
  brands,
  stock,
  recent = [],
  disabled,
}: {
  brandCode: string;
  model: string;
  /** Both at once — a pick from "every make" fills the make in too. */
  onChange: (next: { brandCode: string; model: string }) => void;
  brands: { code: string; name: string }[];
  stock: Record<string, StockModel[]>;
  recent?: RecentDevice[];
  disabled?: boolean;
}) {
  const t = useTranslations("Admin");
  const tPicker = useTranslations("Picker");
  const locale = useLocale();
  const { models: world, loading } = useWorldModels(brandCode || null, locale);
  const options = useMemo(
    () =>
      deskModelOptions({
        brandCode: brandCode || null,
        brands,
        stock,
        world,
        recent,
        dayLabel: (at) => t("deskRecentOn", { day: formatDayNumeric(locale, at) }),
      }),
    [brandCode, brands, stock, world, recent, t, locale],
  );
  const brandOf = useMemo(() => new Map(options.map((option) => [option.value, option.brandCode])), [options]);

  return (
    <Grid>
      <Field label={t("counterBrand")}>
        <SelectField
          value={brandCode}
          onChange={(next) => onChange({ brandCode: next, model: "" })}
          options={[{ value: "", label: t("counterBrandAll") }, ...brands.map((brand) => ({ value: brand.code, label: brand.name }))]}
          disabled={disabled}
        />
      </Field>
      <Field label={t("counterModel")}>
        <SearchableSelect
          options={options}
          loading={loading}
          value={model || null}
          onChange={(next) => {
            const make = next ? brandOf.get(next) : null;
            onChange({ brandCode: !brandCode && make ? make : brandCode, model: next ?? "" });
          }}
          placeholder={brandCode ? t("deskModelPick") : t("deskModelAll")}
          searchPlaceholder={tPicker("search")}
          emptyLabel={tPicker("empty")}
          clearLabel={tPicker("clear")}
          allowCustom
          formatCustom={(typed) => tPicker("use", { name: typed })}
          disabled={disabled}
        />
      </Field>
    </Grid>
  );
}

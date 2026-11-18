"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/**
 * "Save this change?" — asked before any edit inside a ticket is saved (the
 * shop, 2026-11-18: "the editing of anything inside the card … must show a
 * pop-up to confirm the edit"). A fault added or taken off, a price, the
 * purchase price, what was collected, the warranty, the result, cash or
 * deferred. Status moves have their own confirmation (`status-confirm.tsx`)
 * and handing a ticket over is not asked.
 *
 * The question names the field and both values, so what is confirmed is the
 * change itself rather than "are you sure". «تراجع» puts the field back the way
 * it was, so an edit that was not confirmed never sits on screen looking saved.
 *
 * A second request while one is open replaces it: a price box asks on the
 * pause after typing and again on blur, and both are the same change.
 *
 * ⚠️ The dialog is drawn in the document the editor is in — a ticket window of
 * its own included — because `ConfirmDialog` portals into its owner document.
 */
export type EditAsk = {
  /** The ticket, by its code. */
  subject: string;
  field: string;
  from: string;
  to: string;
  /** Saves the change. */
  run: () => void;
  /** Puts the field back as it was. */
  revert?: () => void;
};

export function useEditConfirm() {
  const t = useTranslations("Admin");
  const [ask, setAsk] = useState<EditAsk | null>(null);
  return {
    request(next: EditAsk) {
      setAsk(next);
    },
    dialog: (
      <ConfirmDialog
        open={ask !== null}
        tone="normal"
        title={t("editConfirmTitle")}
        body={ask ? t("editConfirmField", { field: ask.field, code: ask.subject }) : undefined}
        confirmLabel={t("editConfirmSave")}
        cancelLabel={t("editConfirmUndo")}
        onConfirm={() => {
          const current = ask;
          setAsk(null);
          current?.run();
        }}
        onCancel={() => {
          const current = ask;
          setAsk(null);
          current?.revert?.();
        }}
      >
        {/* Before and after as two cells, each value isolated: written as one
            Arabic sentence, a code, an arrow and two figures reorder into
            something nobody can read. */}
        {ask && (
          <dl className="grid grid-cols-2 gap-2">
            <div className="rounded-card border border-line bg-subtle px-3 py-2">
              <dt className="text-[0.7rem] font-bold text-muted">{t("editBefore")}</dt>
              <dd className="mt-0.5 break-words text-[0.9rem] font-black text-ink">
                <bdi>{ask.from}</bdi>
              </dd>
            </div>
            <div className="rounded-card border border-brand/30 bg-brand/6 px-3 py-2">
              <dt className="text-[0.7rem] font-bold text-brand">{t("editAfter")}</dt>
              <dd className="mt-0.5 break-words text-[0.9rem] font-black text-ink">
                <bdi>{ask.to}</bdi>
              </dd>
            </div>
          </dl>
        )}
      </ConfirmDialog>
    ),
  };
}

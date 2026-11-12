"use client";

import { useEffect, useRef, useState } from "react";
import { Select } from "@/components/ui/select";

/**
 * The site's own listbox inside a plain GET form.
 *
 * Native `<select>` is gone from this site (`components/ui/select.tsx` says
 * why), and that control is driven by state rather than by a form field — so
 * this carries the choice in a hidden input under `name`, which is all a GET
 * form needs. `submitOnChange` sends *its own* form the moment a choice is
 * made, the way a filter is expected to behave. Found through a ref, never by
 * name: the date-range form beside it carries the same field as a hidden
 * input, and a lookup by name would submit the wrong form.
 *
 * ⚠️ Submitting is a whole-page navigation, and the page it asks for is a
 * dashboard board with its counts — the slowest press in the back office. The
 * old page stays live and answers until the new one arrives, so a second pick
 * in that gap sent a second request and left the reader unsure which filter
 * they were looking at. `busy` closes that gap, and because the document is
 * replaced when the answer lands, nothing has to clear it.
 *
 * ⚠️ …except the back button. The browser's back/forward cache restores this
 * exact page with its state intact, so a locked picker would come back locked
 * with no navigation left to end it. `pageshow` with `persisted` is the one
 * signal that says so.
 */
export function FormSelect({
  name,
  defaultValue,
  options,
  ariaLabel,
  submitOnChange = true,
}: {
  name: string;
  defaultValue: string;
  options: { value: string; label: string }[];
  ariaLabel: string;
  submitOnChange?: boolean;
}) {
  const [value, setValue] = useState(defaultValue);
  const [busy, setBusy] = useState(false);
  const hidden = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) setBusy(false);
    };
    window.addEventListener("pageshow", restored);
    return () => window.removeEventListener("pageshow", restored);
  }, []);

  return (
    <span className="block">
      <input ref={hidden} type="hidden" name={name} value={value} />
      <Select
        value={value}
        aria-label={ariaLabel}
        options={options}
        loading={busy}
        onChange={(next) => {
          // Choosing what is already chosen changes nothing, so it must not
          // lock the control behind a navigation that never leaves.
          if (next === value) return;
          setValue(next);
          if (!submitOnChange || !hidden.current) return;
          // Written straight to the field so the submit carries it — the
          // re-render that would write it happens after this handler returns.
          hidden.current.value = next;
          setBusy(true);
          hidden.current.form?.requestSubmit();
        }}
      />
    </span>
  );
}

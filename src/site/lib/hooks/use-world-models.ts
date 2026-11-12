"use client";

import { useEffect, useState } from "react";
import { loadWorldModels, type WorldModel } from "@/lib/actions/device-models";

const NONE: WorldModel[] = [];

/**
 * How long a make's list may hold the picker before the wizard stops waiting.
 *
 * The lock exists to stop a second pick landing on a list that has not
 * arrived, and it must never become the thing that stops somebody finishing a
 * booking: the field works without this list, because it still holds the
 * shop's own models and the curated ones and still accepts a typed name. A
 * late answer is still used — this ends the wait, not the request.
 */
const PATIENCE_MS = 6000;

/**
 * Every device a make has ever shipped, fetched when the make is chosen.
 *
 * `compare_catalogue` is 5,912 rows; handing the whole thing to the browser
 * would be ~150KB of makes nobody opened. One make is a few hundred names, and
 * it arrives while the customer is still reading the field — see
 * `loadWorldModels`. The repair and buy-back wizards shared a copy of this
 * until the wait needed a limit, and a limit in two places is two limits.
 *
 * ⚠️ A failure is silence. The picker still holds the shop's own models and
 * the curated list, so the worst case is the list these wizards had before the
 * world catalogue existed.
 *
 * ⚠️ The fetched list carries the make it was fetched for, and the effect
 * never clears it. Clearing on "no make chosen" meant `setWorld([])` in the
 * body of an effect, which `react-hooks/set-state-in-effect` refuses — and
 * rightly: it is a cascading render to express something that is not state at
 * all. Switching make also showed the *previous* make's models for a frame,
 * because the new list had not arrived and nothing said the old one was stale.
 * Keyed on the make, both go away, and `loading` is derived from the same
 * comparison rather than being a second flag that could disagree with it.
 */
export function useWorldModels(brand: string | null, locale: string) {
  const [world, setWorld] = useState<{ brand: string; models: WorldModel[] }>({
    brand: "",
    models: NONE,
  });

  useEffect(() => {
    if (!brand) return;
    let alive = true;
    // Settles the wait without overwriting an answer that already arrived.
    const settle = () => {
      if (alive) {
        setWorld((current) =>
          current.brand === brand ? current : { brand, models: NONE },
        );
      }
    };
    const patience = setTimeout(settle, PATIENCE_MS);
    void loadWorldModels(brand, locale)
      .then((rows) => {
        if (alive) setWorld({ brand, models: rows });
      })
      .catch(settle)
      .finally(() => clearTimeout(patience));
    return () => {
      alive = false;
      clearTimeout(patience);
    };
  }, [brand, locale]);

  const settled = world.brand === brand;
  return {
    models: settled ? world.models : NONE,
    loading: Boolean(brand) && !settled,
  };
}

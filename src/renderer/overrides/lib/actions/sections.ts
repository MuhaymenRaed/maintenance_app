import type { RepairPatch, SectionResult } from "../../../../shared/contract";

/**
 * `lib/actions/sections.ts`, for a desk that writes to this computer first.
 *
 * The two the repair board calls. Each is the same call it always was — the
 * same arguments, the same `{ ok, error }` — answered by the main process:
 * it asks the same questions its server twin asks (who holds the ticket, what
 * this account may do to it), writes the change to the local database and the
 * outbox, and returns at once. The board redraws from the local copy, so the
 * press lands whether or not there is a line to Al-Esnad.
 *
 * ⚠️ The error strings are the site's own keys (`not_your_ticket`,
 * `save_failed`, `warrantyUnavailable`), because the copied components look
 * them up in `messages/{ar,en}.json`. A new key invented here would render as
 * itself in front of the counter.
 */
export type { SectionResult };

export function updateRepair(id: string, patch: RepairPatch): Promise<SectionResult> {
  return window.desk.updateRepair(id, patch);
}

export function addRepairPhotos(id: string, urls: string[]): Promise<SectionResult> {
  return window.desk.addRepairPhotos(id, urls);
}

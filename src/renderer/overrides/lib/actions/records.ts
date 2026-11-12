import type { RecordKind, RecordResult } from "../../../../shared/contract";

/**
 * `lib/actions/records.ts` — the owner's "remove this record".
 *
 * ⚠️ It is a soft delete on the server and a soft delete here: the row leaves
 * every board and every total, and the ticket is still in the database. What
 * the desk adds is that the *removal* is a queued change like any other, so a
 * record deleted with the line down comes off this board at once and off the
 * dashboard's when the line returns.
 *
 * ⚠️ A ticket that has never been sent is discarded outright instead — there
 * is nothing on the server to delete, and an outbox holding "create it" and
 * "delete it" would open a ticket at Al-Esnad in order to close it a second
 * later. `deleteRecord` in `src/main/desk/actions.ts` is where that is decided.
 */
export type { RecordKind, RecordResult };

export function deleteRecord(input: {
  kind: RecordKind;
  id: string;
  label?: string;
  reason?: string;
}): Promise<RecordResult> {
  return window.desk.deleteRecord(input);
}

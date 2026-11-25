import { repairMoney, type PaymentTerms } from "./repair-desk.ts";

/**
 * What a repair ticket puts on paper — the label, the two receipts and the
 * warranty certificate all read this one shape.
 *
 * It used to be built in three places: the board from its row, the counter's
 * dialog from its form, and now the print station from a fresh read of the
 * ticket at the moment of printing. Three copies of "which faults, in what
 * order, and how much is still owed" are three copies that drift, and the
 * receipt is the one paper the customer takes home. One mapping, here, pure,
 * importable from a Client Component and a Server Action alike.
 *
 * ⚠️ The relative `./repair-desk.ts` import, extension included, is what lets
 * `node --test` load this file without a bundler — the pattern
 * `lib/data/queue-window.ts` already follows.
 */
export type RepairPrintFacts = {
  code: string;
  customerName: string;
  device: string;
  fault: string;
  /** What the customer pays — the repair and its warranty together. */
  amount: number;
  /**
   * The warranty's share of `amount`, or 0.
   *
   * ⚠️ Its own figure on the paper, never folded into the total and left
   * unexplained: the shop's rule since 2026-11-03 is that the warranty is a
   * separate account which joins exactly one other — what the customer pays.
   */
  warranty: number;
  collected: number;
  remaining: number;
  terms: PaymentTerms;
  /** When the ticket was opened: "تاريخ استلام الجهاز". */
  receivedAt: string;
  hasWarranty: boolean;
  warrantyDays: number | null;
  /** `YYYY-MM-DD`. */
  warrantyStart: string | null;
};

export type TicketForPrint = {
  code: string;
  customerName: string;
  deviceModel: string;
  /** The listed faults, already in the reader's language. */
  issues: readonly string[];
  /** Faults the counter typed because the price list has no name for them. */
  customFaults: readonly string[];
  /** `actual_cost` — the total, warranty included. */
  price: number | null;
  warrantyPrice: number | null;
  costPrice: number | null;
  collected: number | null;
  paymentTerms: PaymentTerms;
  createdAt: string;
  warrantyDays: number | null;
  warrantyStart: string | null;
  /**
   * The ticket has reached «مكتمل». A نقد ticket has paid nothing before it
   * (2026-11-24), so a receipt printed at the counter says what is owed.
   */
  completed: boolean;
};

export function toRepairPrintFacts(ticket: TicketForPrint): RepairPrintFacts {
  const money = repairMoney({
    price: ticket.price,
    warranty: ticket.warrantyPrice,
    cost: ticket.costPrice,
    collected: ticket.collected,
    terms: ticket.paymentTerms,
    completed: ticket.completed,
  });
  return {
    code: ticket.code,
    customerName: ticket.customerName,
    device: ticket.deviceModel,
    fault: [...ticket.issues, ...ticket.customFaults].join("، "),
    amount: money.price,
    warranty: money.warranty,
    collected: money.collected,
    remaining: money.remaining,
    terms: ticket.paymentTerms,
    receivedAt: ticket.createdAt,
    hasWarranty: (ticket.warrantyPrice ?? 0) > 0 || ticket.warrantyDays != null,
    warrantyDays: ticket.warrantyDays,
    warrantyStart: ticket.warrantyStart,
  };
}

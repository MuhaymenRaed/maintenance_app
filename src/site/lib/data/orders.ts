import type { Database } from "@/lib/supabase/database.types";

/**
 * View models for a customer's own orders, and the rules about their progress.
 *
 * Deliberately free of `server-only`: the same shapes are rendered by the
 * signed-in account pages (server) and by the guest tracker (client), and one
 * card component serves both. Only *types* come from `database.types`, and
 * type imports are erased, so nothing here pulls Supabase into the browser.
 */

export type OrderStatus = Database["public"]["Enums"]["order_status"];
export type RepairStatus = Database["public"]["Enums"]["repair_status"];
export type TradeInStatus = Database["public"]["Enums"]["trade_in_status"];
export type PaymentMethod = Database["public"]["Enums"]["payment_method"];

export type OrderLine = {
  id: string;
  name: string;
  variantLabel: string | null;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  /** Null for a guest lookup, and for a product since removed. */
  imageUrl: string | null;
  /** Null when the line cannot be linked back to a live product page. */
  slug: string | null;
  /**
   * The colour the customer picked for this line, or null.
   *
   * A snapshot from `order_items.color` (20261107_colours_and_stock_images.sql),
   * already in the reader's language — renaming the colour on the product
   * tomorrow does not rewrite what was ordered. Optional because a basket
   * placed before colours existed, and a deployment that has not run the
   * file, have none.
   */
  colour?: LineColour | null;
  /**
   * The configuration, as figures — from the variant the line points at, or
   * from `track_order` once 20261122 has run. Optional: a reader that cannot
   * reach them leaves `lineChoicesOf` to read them out of `variantLabel`.
   */
  storageGb?: number | null;
  ramGb?: number | null;
  /** The phone a case was bought for — `order_items.fit_model`, 20261122. */
  fitModel?: string | null;
};

/** A colour as an order line remembers it. */
export type LineColour = { name: string; hex: string };

/**
 * One move along a lifecycle, from `status_events` (20261107_status_steps.sql).
 * `at` is an ISO instant.
 */
export type StatusEvent = {
  status: string;
  at: string;
  /**
   * Who moved it — filled only on the back office's own read
   * (`loadStatusHistory`), never on anything a customer sees. `staff` names
   * the account; `customer` is the customer's own act (placing, cancelling);
   * `system` is a move nobody signed in made (a guest's booking, a trigger).
   */
  by?: { kind: "staff" | "customer" | "system"; name: string | null };
};

export type OrderDetail = {
  id: string;
  code: string;
  status: OrderStatus;
  createdAt: string;
  lines: OrderLine[];
  subtotal: number;
  discountTotal: number;
  deliveryFee: number;
  total: number;
  paymentMethod: PaymentMethod | null;
  customerName: string | null;
  /** Courier reference, once there is one. */
  tracking: string | null;
  couponCode: string | null;
  tradeInCredit: number;
  /**
   * The transfer receipt the customer attached at checkout, where there is
   * one.
   *
   * ⚠️ Optional, and absent on the guest tracker rather than null-by-design:
   * that view model is built from `track_order`, which does not return the
   * column. A guest who paid by transfer sees their order and not the picture
   * — correct enough, since they are the person who took it — and the signed-in
   * page is where it is worth showing back.
   */
  transferReceiptUrl?: string | null;

  /* ── what a customer may still correct while the order is in review ──
     Present so `EditOrderDialog` can open onto the current values rather than
     an empty form. Optional because the guest tracker builds this view model
     from `track_order`, which does not return them — the edit control is
     simply absent there, which is the right degradation. */
  fulfillment?: "delivery" | "pickup";
  provinceCode?: string | null;
  addressLine?: string | null;
  branchId?: string | null;
  customerPhone?: string | null;
  customerPhone2?: string | null;
  notes?: string | null;
  /**
   * When each step happened, oldest first. Absent where nobody asked, and
   * empty before `status_events` exists — the timeline then shows the steps
   * without their times, which is what it always did.
   */
  history?: StatusEvent[];
};

/** Lifecycle per type, in the order the database advances it. */
/*
 * ⚠️ `preparing` arrived on 2026-11-07 (20261107_status_steps.sql), and the
 * shop asked for it in so many words: the old four said "accepted" and then
 * "shipped", and everything the shop does in between — picking, checking,
 * packing — had no name a customer could read. `shipped` and `delivered` are
 * worded per fulfilment (`orderStepKey`): a pickup order is never shipped, it
 * is ready at the counter and then collected.
 *
 * Boards that WRITE a status ask `liveFlow` first, because before the file
 * runs the database refuses the value; a page that only reads can show the
 * whole flow, since no row can be on a step that does not exist yet.
 */
export const ORDER_FLOW = [
  "review",
  "accepted",
  "preparing",
  "shipped",
  "delivered",
] as const satisfies readonly OrderStatus[];

/**
 * ⚠️ No `quote_sent` and no `approved` (the shop's call, 2026-10-26).
 *
 * The bench used to send a price and wait for the customer to accept it
 * before starting. In practice the counter quotes in person or on the phone,
 * so those two steps were stops every ticket had to be walked through for a
 * conversation that had already happened — and to a customer reading the
 * timeline they were two boxes that never lit. The flow is now what the bench
 * actually does, and the cost is a figure on the ticket (`actual_cost`), not a
 * stage of it — the shape the replacement flow has always had.
 *
 * The enum values still exist in the database (Postgres cannot drop an enum
 * value) and their labels stay in the messages, so an old ticket that somehow
 * carries one still renders. Measured before the change: 0 tickets on either.
 *
 * ⚠️ `approved` came back on 2026-10-31 and means something else now: the first
 * step, **before** `received` — the ticket is accepted, and the device has not
 * reached the bench yet. New tickets start on it (`book_repair`, and the column
 * default).
 *
 * ⚠️ `ready` is the step the shop calls "بانتظار الزبون" now. Every device is
 * brought to a counter and collected from one, so nothing here is ever
 * delivered and the words had to stop suggesting it — a change to what the shop
 * says, not to what the status is called in the code (the rule the Arabic words
 * for the two services already follow).
 */
export const REPAIR_FLOW = [
  "approved",
  "received",
  "diagnosing",
  // 2026-11-07. Optional — see `OPTIONAL_STEPS`.
  "waiting_parts",
  "in_repair",
  "quality_check",
  // 2026-11-17 — the technician's "I've finished my part": the manager takes
  // it from here, rings the customer and hands the device over. Optional —
  // see `OPTIONAL_STEPS` — because a ticket a manager works alone never
  // passes through it.
  "work_done",
  "ready",
  "completed",
] as const satisfies readonly RepairStatus[];

/**
 * `inspecting` (2026-11-07) is the device at the counter being checked for the
 * final figure. `approved` used to cover both "bring it in" and "we have it",
 * which a customer could not tell apart.
 */
export const TRADE_IN_FLOW = [
  "pending",
  "approved",
  "inspecting",
  "completed",
] as const satisfies readonly TradeInStatus[];

/**
 * Steps most work never passes through. A timeline draws one only when the
 * work is on it or went through it — a ticket that never waited for a part
 * must not show a tick beside "waiting for the part".
 */
export const OPTIONAL_STEPS: ReadonlySet<string> = new Set(["waiting_parts", "work_done"]);

/**
 * Whether the database has each of the three values 20261107_status_steps.sql
 * adds. Asked by `getStepSupport` on the server; every flag true once the file
 * has run.
 */
export type StepSupport = {
  preparing: boolean;
  waitingParts: boolean;
  inspecting: boolean;
  /** `work_done`, from 20261117_technician_desk.sql. */
  workDone: boolean;
};

export const ALL_STEPS: StepSupport = {
  preparing: true,
  waitingParts: true,
  inspecting: true,
  workDone: true,
};

/**
 * A flow without the steps this deployment cannot store yet.
 *
 * ⚠️ For a control that WRITES a status. Offering a button the database then
 * refuses is the "editor that opens, takes twelve fields and fails" this
 * codebase keeps arguing against.
 */
export function liveFlow<T extends string>(
  flow: readonly T[],
  support: StepSupport,
): T[] {
  return flow.filter(
    (step) =>
      !(
        (step === "preparing" && !support.preparing) ||
        (step === "waiting_parts" && !support.waitingParts) ||
        (step === "inspecting" && !support.inspecting) ||
        (step === "work_done" && !support.workDone)
      ),
  );
}

/**
 * The message key an order step is worded by. A pickup order is never "out
 * for delivery": it is ready at the counter and then collected.
 */
export function orderStepKey(
  status: string,
  fulfillment: "delivery" | "pickup" | null | undefined,
): string {
  if (
    fulfillment === "pickup" &&
    (status === "shipped" || status === "delivered")
  ) {
    return `${status}_pickup`;
  }
  return status;
}

export type TimelineStep = {
  status: string;
  /** When the work reached this step, where that is known. */
  at: string | null;
  state: "done" | "active" | "upcoming";
};

/**
 * A lifecycle as the customer reads it: which steps are behind, which one is
 * now, and when each happened.
 *
 * The first step's time falls back to `createdAt` — everything starts on its
 * first step the moment it is created, so that one is known even for work
 * older than `status_events`. A later step with no event stays without a
 * time rather than borrowing one: an invented time is worse than none.
 */
export function timelineSteps(
  flow: readonly string[],
  current: string,
  history: readonly StatusEvent[] | undefined,
  createdAt?: string | null,
): TimelineStep[] {
  const reached = new Map<string, string>();
  // Oldest first, so the LAST time a step was entered wins — a ticket sent
  // back to "in repair" is dated by the return, not by its first visit.
  for (const event of history ?? []) reached.set(event.status, event.at);
  const index = flow.indexOf(current);

  return flow
    .map((status, i) => ({ status, i }))
    .filter(
      ({ status }) =>
        !OPTIONAL_STEPS.has(status) ||
        status === current ||
        reached.has(status),
    )
    .map(({ status, i }) => ({
      status,
      at: reached.get(status) ?? (i === 0 ? (createdAt ?? null) : null),
      state:
        index < 0
          ? "upcoming"
          : i < index
            ? "done"
            : i === index
              ? "active"
              : "upcoming",
    }));
}

/** Statuses that end the story rather than sitting somewhere along it. */
export const TERMINATED: ReadonlySet<string> = new Set([
  "cancelled",
  "declined",
]);

/**
 * An order can still be called off while it is waiting to be looked at.
 *
 * Once staff accept it, stock is committed and it may already be on its way,
 * so cancelling becomes a conversation rather than a button. This mirrors what
 * `cancel_order_guest` enforces in the database — the button is hidden for the
 * same reason the RPC would refuse, not instead of it.
 */
export function canCancelOrder(status: OrderStatus): boolean {
  return status === "review";
}

/** How far along `flow` a status sits; -1 when it is not on the track at all. */
export function progressIndex(flow: readonly string[], status: string): number {
  return flow.indexOf(status);
}

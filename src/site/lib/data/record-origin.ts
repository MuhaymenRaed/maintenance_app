/**
 * Where a ticket or an order came from — entered at the counter, or sent in
 * by a customer through the site. See `lib/queries/record-origin.ts` for how a
 * repair or a replacement is told apart, and `orders.channel` for an order.
 *
 * Client-safe: the boards draw it.
 */
export type RecordOrigin = "counter" | "web";

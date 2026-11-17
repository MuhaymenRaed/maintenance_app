/**
 * The repair desk's rules, shared by the board, the counter dialog, the figures
 * above the queue and the server actions. Pure and import-free, so both sides
 * of the boundary compute them the same way.
 *
 * ---------------------------------------------------------------------------
 * The money
 * ---------------------------------------------------------------------------
 * - **مبلغ الصيانة** — what the customer pays. `actual_cost` on the ticket, the
 *   figure `/track` shows and `pay_repair` settles. **It includes the warranty**
 *   — see below.
 * - **الضمان** — `warranty_price`, the part of that figure which is the warranty.
 * - **سعر الشراء** — what the part cost the shop. Staff only.
 * - **الواصل** — what the customer has paid so far. Staff only.
 * - **نقد / آجل** — paid outright, or to be collected later. Staff only.
 *
 * The last three live in `repair_ticket_finance`, never on the ticket: a
 * customer may read their own ticket row, so a column there is a column they
 * can read.
 *
 * ⚠️ **`actual_cost` is the total, and the warranty is "of which".** The shop's
 * instruction was that the warranty is its own field and yet counts in the
 * price the customer sees and in every calculation. A dozen readers already
 * take `actual_cost` as what the customer owes — the tracker, `pay_repair`, the
 * points trigger, the revenue on the overview, the bench figures. Keeping the
 * total there makes every one of them right by construction; storing the bare
 * repair price there instead would mean teaching each reader to add the
 * warranty, and the one that was missed would quietly under-report. So the bare
 * repair price is *derived*: `repairBase`. A ticket with a warranty and no
 * repair price yet has no total — nobody is asked to pay a warranty on a repair
 * that has not been priced.
 *
 * ⚠️ **The warranty is its own account and is never part of the profit.** The
 * shop, 2026-11-03: "never merge it with the pure profit, its accounts are
 * different and must be isolated, the only thing that it gets added to is
 * السعر". So the warranty joins exactly one figure — مبلغ الصيانة, what the
 * customer pays — and is kept out of every other: `profit` is measured on
 * `base`, the repair alone, and `DeskTotals.warranty` carries the warranty
 * income on its own beside it.
 *
 * The reason it cannot be folded in is arithmetic rather than taste. سعر الشراء
 * is what the *part* cost, so `price − cost` over a total that carries a
 * warranty credits the whole warranty to the repair's margin — a ticket repaired
 * at no margin at all reads as profitable because a warranty was sold with it,
 * and the one figure a manager uses to judge the bench stops describing the
 * bench. The two are different trades: one is labour and a part, the other is a
 * promise the shop is paid to carry.
 *
 * ⚠️ **الباقي is the price minus what has been paid**, and the brief's own
 * sentence said "the purchase price minus what has been paid". That reading
 * subtracts what the customer handed over from what the *shop* paid for the
 * part, which is not a debt anybody owes — so the figure here is the amount
 * still to collect from the customer, which is what the field exists for.
 *
 * ⚠️ **A cash ticket with nothing typed under الواصل counts as fully paid.**
 * Cash means paid at the counter, and asking the desk to type the price twice
 * for every walk-in is how the field stops being filled. A deferred ticket
 * with nothing typed has paid nothing.
 *
 * ⚠️ **Profit is only ever counted on a ticket that is fully paid** — cash paid
 * outright, or deferred once الباقي reaches zero. Until then what has come in
 * sits in الواصل, apart from the profit, because money still owed on a job is
 * not yet money made on it.
 *
 * ---------------------------------------------------------------------------
 * Who may do what
 * ---------------------------------------------------------------------------
 * Everything hangs off the one question a ticket asks: who holds it
 * (`assigned_to`). There is no rota and no "take it" any more — a ticket is
 * handed to somebody, by a manager, and stays theirs until a manager moves it.
 *
 * - **A manager** — an owner, or anybody on the bench who is not a technician
 *   and does not report to another bench manager — controls every ticket on
 *   the bench.
 * - **An assistant manager** — somebody who reports to a bench manager, or a
 *   deputy appointed on `/admin/team` with `can_manage` — controls their own
 *   tickets, those of whoever is below them, and tickets nobody holds.
 * - **Nobody controls a ticket held by somebody above them**, an owner
 *   included: "the sub manager can not control the manager's".
 * - ⚠️ **An owner is above everybody, whether or not anybody reports to
 *   them.** The shop, 2026-11-02: "the managers of maintenance must not see
 *   or be able to choose the owners — highest managers in the system — and
 *   the same for other sections". The line above has said as much since the
 *   desk shipped and nothing enforced it: a bench manager who reported to
 *   nobody got `everything: true`, and an owner who was not in their
 *   reporting line was therefore not `above` them — so a repair manager
 *   could reassign, re-price and settle the owner's own tickets, and the
 *   owner's name sat in their assignment picker. Owners are now added to
 *   `above` for every viewer who is not one, which closes both halves at
 *   once: `ticketControl` already refuses anything held by somebody above,
 *   and `controls`/`assignable`/`visible` are all filtered by it.
 * - **A technician** controls nothing. They read every ticket, and handle the
 *   ones in their own name: the status, the price the customer is told, what
 *   became of the device, the photographs.
 *
 * ⚠️ This file decides what is *offered*. `desk_may_control` and the
 * `repair_tickets_guard_desk` trigger say the same thing in the database, and
 * the database is what decides. They are two halves of one rule: change one and
 * check the other.
 */

export type RepairService = "hardware" | "software";
export type PaymentTerms = "cash" | "deferred";

export const SERVICE_SECTION: Record<RepairService, "repairs" | "programming"> = {
  hardware: "repairs",
  software: "programming",
};

export const SERVICE_CAPABILITY: Record<RepairService, "repairs.write" | "programming.write"> = {
  hardware: "repairs.write",
  software: "programming.write",
};

/**
 * The day a warranty ends: `2026-10-31` plus 30 days is `2026-11-30`, the sum the
 * shop's old printout did. Calendar days, so no clock or time zone is involved.
 */
export function warrantyEnd(start: string, days: number): string {
  return new Date(Date.parse(`${start}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** How many days lie between two `YYYY-MM-DD` days. */
export function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

/** Still on somebody's bench — the same three the queue strips call closed. */
export function isOpenTicket(status: string): boolean {
  return status !== "completed" && status !== "cancelled" && status !== "declined";
}

/* ── The price and the warranty ───────────────────────────────────────────── */

const whole = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? 0 : Math.max(0, Math.round(value));

/** What goes in `actual_cost`: the repair plus its warranty, or null unpriced. */
export function repairTotal(base: number | null, warranty: number | null): number | null {
  return base == null ? null : whole(base) + whole(warranty);
}

/** The bare repair price, worked back out of the total. */
export function repairBase(total: number | null, warranty: number | null): number | null {
  return total == null ? null : Math.max(0, whole(total) - whole(warranty));
}

export type RepairMoney = {
  /** مبلغ الصيانة — what the customer pays, the warranty inside it. */
  price: number;
  /** The warranty's share of `price`. Its own account, never in `profit`. */
  warranty: number;
  /** سعر الصيانة — the repair alone, which is what the profit is measured on. */
  base: number;
  cost: number | null;
  /** The repair alone less the part — null while the cost is not known. */
  profit: number | null;
  collected: number;
  remaining: number;
  /** Priced, and nothing left to collect. Only this ever counts as profit. */
  settled: boolean;
};

/**
 * ⚠️ **It takes an object, and that is deliberate.** This used to be four
 * positional arguments and the warranty is a fifth number among them — a
 * caller that passed them in the wrong order would compile and quietly report
 * the wrong margin on every ticket, which is the one kind of mistake this
 * function must not be able to make. Named, every call site says what it means
 * and a missing warranty is a type error rather than a silent zero.
 */
export function repairMoney({
  price,
  warranty,
  cost,
  collected,
  terms,
}: {
  /** The ticket's total — `actual_cost`, the warranty already inside it. */
  price: number | null;
  /** `warranty_price`: how much of that total is the warranty. */
  warranty: number | null;
  cost: number | null;
  collected: number | null;
  terms: PaymentTerms;
}): RepairMoney {
  const p = Math.max(0, price ?? 0);
  // Clamped to the total, the way `repairBase` floors at zero: a warranty typed
  // above the price it is part of must not make the repair's own price negative
  // and hand the bench a profit nobody earned.
  const w = Math.min(p, whole(warranty));
  const base = p - w;
  // ⚠️ Cash is paid at the counter, whatever figure was typed before — the
  // shop's rule of 2026-11-17, and why «الواصل» is not offered on a cash
  // ticket at all. A part-payment is what «آجل» is for. Checked against the
  // live data before it changed: the one cash ticket that carried a partial
  // figure was cancelled, and a cancelled ticket carries no money anyway.
  const paid = terms === "cash" ? p : Math.min(p, Math.max(0, collected ?? 0));
  const remaining = Math.max(0, p - paid);
  return {
    price: p,
    warranty: w,
    base,
    cost,
    profit: cost == null ? null : base - cost,
    collected: paid,
    remaining,
    settled: price != null && remaining === 0,
  };
}

export type DeskTotals = {
  tickets: number;
  open: number;
  completed: number;
  cancelled: number;
  /** What customers are charged, warranties included. */
  revenue: number;
  /** How much of `revenue` is warranty. */
  warranty: number;
  warrantyTickets: number;
  cost: number;
  /** Over fully paid tickets only, and over the repair alone — see `warranty`. */
  profit: number;
  settled: number;
  /** واصل from cash tickets. */
  collectedCash: number;
  /** واصل from deferred tickets, finished or not. */
  collectedDeferred: number;
  /** The part of `collectedDeferred` on tickets still owing — not yet profit. */
  partialHeld: number;
  outstanding: number;
  deferred: number;
  /** Paid tickets with a price but no cost typed — the profit leaves them out. */
  missingCost: number;
};

export function emptyTotals(): DeskTotals {
  return {
    tickets: 0,
    open: 0,
    completed: 0,
    cancelled: 0,
    revenue: 0,
    warranty: 0,
    warrantyTickets: 0,
    cost: 0,
    profit: 0,
    settled: 0,
    collectedCash: 0,
    collectedDeferred: 0,
    partialHeld: 0,
    outstanding: 0,
    deferred: 0,
    missingCost: 0,
  };
}

/** One ticket into a running total. Cancelled tickets count, and carry no money. */
export function addToTotals(
  totals: DeskTotals,
  row: {
    status: string;
    price: number | null;
    warrantyPrice?: number | null;
    costPrice: number | null;
    collected: number | null;
    paymentTerms: PaymentTerms;
  },
): void {
  totals.tickets += 1;
  if (row.status === "cancelled" || row.status === "declined") {
    totals.cancelled += 1;
    return;
  }
  if (row.status === "completed") totals.completed += 1;
  else totals.open += 1;
  if (row.paymentTerms === "deferred") totals.deferred += 1;

  const money = repairMoney({
    price: row.price,
    warranty: row.warrantyPrice ?? null,
    cost: row.costPrice,
    collected: row.collected,
    terms: row.paymentTerms,
  });
  totals.revenue += money.price;
  totals.outstanding += money.remaining;
  // `money.warranty` rather than the raw column, so an unpriced ticket counts
  // no warranty income — there is no total for it to be part of yet — and a
  // warranty typed above the price counts only what the customer is charged.
  if (money.warranty > 0) {
    totals.warranty += money.warranty;
    totals.warrantyTickets += 1;
  }

  if (row.paymentTerms === "deferred") {
    totals.collectedDeferred += money.collected;
    if (money.remaining > 0) totals.partialHeld += money.collected;
  } else {
    totals.collectedCash += money.collected;
  }

  if (money.cost != null) totals.cost += money.cost;
  if (money.settled) {
    totals.settled += 1;
    // `base`, never `price`: the warranty is counted once, in `totals.warranty`.
    if (money.cost != null) totals.profit += money.base - money.cost;
    // A ticket that is only a warranty has no repair to have cost anything, so
    // it is not a missing cost — it is a job with no part in it.
    else if (money.base > 0) totals.missingCost += 1;
  }
}

/* ── Who may do what ──────────────────────────────────────────────────────── */

export type DeskPersonRef = { userId: string; role: string; managerId: string | null };
export type DeskDeputyRef = { managerId: string; deputyId: string; canManage: boolean };

export type DeskRank = "manager" | "assistant" | "technician";

/**
 * Does this person actually work tickets, as opposed to running the bench?
 *
 * The holder filter on `/admin/repairs` is labelled "technician" and listed
 * everybody the reader may be shown — every manager and assistant with them —
 * so narrowing it to the people who hold a screwdriver is the shop's own
 * request ("make the filter in the repairing section be by the techs guys
 * only").
 *
 * ⚠️ It is NOT `rank === "technician"`, and that is measured rather than
 * assumed. `deskRank` answers "technician" only for `role = 'technician'`, and
 * on 2026-11-03 **no account in this shop carries that role** — all twelve are
 * admin / super_admin / sales_admin / repair_admin. A filter keyed on the rank
 * alone would therefore be permanently empty, which is a worse control than
 * the one it replaced.
 *
 * A **bench record** is the shop's own marker for the same fact: CLAUDE.md
 * defines `technicians.write` as deciding "whether they take repair tickets,
 * and at which branch", and it is the repair manager's to set. Of the six
 * people `bench_staff` returns for the hardware bench, three hold one, and
 * they are the three who work the bench.
 *
 * So the rule is the union, and it keeps working in both directions: it is
 * right today off the bench records, and it narrows to exactly the
 * technicians as the workshop manager creates real technician accounts.
 */
export function worksTheBench(person: {
  rank: DeskRank;
  technicianId: string | null;
}): boolean {
  return person.rank === "technician" || person.technicianId !== null;
}

/**
 * What one reader may do with one ticket: `full` is everything a manager does,
 * `own` is a technician working a ticket in their name, `none` is reading it.
 */
export type DeskControl = "full" | "own" | "none";

const OWNER_ROLES: ReadonlySet<string> = new Set(["admin", "super_admin"]);
const isManagerRole = (role: string) => role !== "technician" && role !== "customer";

/**
 * Who sits above somebody: up their reporting line, and any manager they stand
 * in for. Bounded, because a tampered row must not hang a page — the same ten
 * levels `setManager` walks and `desk_is_above` recurses.
 */
export function peopleAbove(
  userId: string,
  people: readonly DeskPersonRef[],
  deputies: readonly DeskDeputyRef[],
): Set<string> {
  const byId = new Map(people.map((person) => [person.userId, person]));
  const above = new Set<string>();
  let cursor = byId.get(userId)?.managerId ?? null;
  for (let depth = 0; cursor && depth < 10 && !above.has(cursor); depth += 1) {
    above.add(cursor);
    cursor = byId.get(cursor)?.managerId ?? null;
  }
  for (const deputy of deputies) {
    if (deputy.deputyId === userId) above.add(deputy.managerId);
  }
  above.delete(userId);
  return above;
}

/** A person's place on the bench, for the labels and for `deskAuthority`. */
export function deskRank(
  userId: string,
  role: string,
  people: readonly DeskPersonRef[],
  deputies: readonly DeskDeputyRef[],
): DeskRank {
  if (role === "technician") return "technician";
  if (OWNER_ROLES.has(role)) return "manager";
  const byId = new Map(people.map((person) => [person.userId, person]));
  const managerId = byId.get(userId)?.managerId;
  const boss = managerId ? byId.get(managerId) : undefined;
  const underManager = Boolean(boss && isManagerRole(boss.role) && !OWNER_ROLES.has(boss.role));
  const deputy = deputies.some(
    (row) => row.deputyId === userId && row.canManage && byId.has(row.managerId),
  );
  return underManager || deputy ? "assistant" : "manager";
}

export type DeskAuthority = {
  /** `viewer` holds the section and no write: they read, and that is all. */
  rank: DeskRank | "viewer";
  /** Adds tickets, moves the money, hands tickets out, prints the card. */
  manages: boolean;
  /** Reads the money at all. Never a technician. */
  seesMoney: boolean;
  /** Controls the whole bench, not only whoever is below them. */
  everything: boolean;
  /** People whose tickets are out of reach, whoever this reader is. */
  above: string[];
  /** People whose tickets this reader controls, themselves included. */
  controls: string[];
  /** People this reader may hand a ticket to. */
  assignable: string[];
  /**
   * Whom this reader may be *shown* — the holder filter's list, and anywhere
   * else the bench is enumerated.
   *
   * Separate from `assignable` because the two answer different questions: an
   * assistant may not hand a ticket to a technician on another manager's team
   * and may perfectly well filter the board by them. What neither list holds,
   * for anybody but an owner, is an owner.
   */
  visible: string[];
};

export function deskAuthority({
  viewerId,
  role,
  owner,
  canWrite,
  people,
  deputies,
}: {
  viewerId: string;
  role: string;
  /** An owner role, or somebody holding `staff.write`. */
  owner: boolean;
  /** `repairs.write` or `programming.write`, for this bench. */
  canWrite: boolean;
  people: readonly DeskPersonRef[];
  deputies: readonly DeskDeputyRef[];
}): DeskAuthority {
  /*
   * Keyed on the ROLE, not on the `owner` flag above it. That flag is "an
   * owner role **or** somebody holding `staff.write`", which is the right
   * question for "may this person run the whole bench" and the wrong one
   * here: a sales admin granted the roster capability is not one of the
   * shop's highest managers, and hiding the owners from them would hide
   * nothing they are not entitled to see anyway.
   */
  const viewerIsOwner = OWNER_ROLES.has(role);
  /*
   * The owners, to somebody who is not one. Kept apart from the reporting
   * line because the two are excluded from *different* things.
   *
   * ⚠️ Folding them into one set broke "a ticket may be passed up", and the
   * test said so: an assistant's own manager is `above` them and is still
   * somebody they may hand a ticket to, so filtering the bench by `above`
   * took the manager out of the picker as well as the owner. `hidden` is
   * the harder rule — not offered anywhere, at all — and `above` stays the
   * softer one: their tickets are out of reach, they themselves are not.
   */
  const hidden = new Set<string>();
  for (const person of people) {
    if (person.userId === viewerId) continue;
    /*
     * ⚠️ **Only a general manager is shown the whole list** — the shop's rule of
     * 2026-11-17. The general managers (`super_admin`) are hidden from
     * everybody else, an `admin` included, though an admin is an owner for
     * every other purpose here: their tickets are out of the admin's reach and
     * off the admin's pickers. Everybody below the owners loses the admins as
     * well, the rule this set was written for.
     */
    if (person.role === "super_admin" ? role !== "super_admin" : !viewerIsOwner && OWNER_ROLES.has(person.role)) {
      hidden.add(person.userId);
    }
  }
  const reach = peopleAbove(viewerId, people, deputies);
  // An owner is above everybody, so their tickets are out of reach too.
  for (const id of hidden) reach.add(id);
  const above = [...reach];

  if (role === "technician" || !canWrite) {
    const technician = role === "technician";
    return {
      rank: technician ? "technician" : "viewer",
      manages: false,
      seesMoney: !technician,
      everything: false,
      above,
      controls: technician && canWrite ? [viewerId] : [],
      assignable: [],
      visible: people
        .filter((person) => person.userId === viewerId || !hidden.has(person.userId))
        .map((person) => person.userId),
    };
  }

  const rank = owner ? "manager" : deskRank(viewerId, role, people, deputies);
  // Everybody on this bench a non-owner is allowed to be shown. Superiors
  // are still in it — see `hidden` above — so passing a ticket up still works.
  const onBench = people
    .filter((person) => person.userId === viewerId || !hidden.has(person.userId))
    .map((person) => person.userId);

  if (rank === "manager") {
    const reachable = onBench.filter((id) => !above.includes(id));
    const controls = reachable.includes(viewerId) ? reachable : [viewerId, ...reachable];
    const offered = onBench.includes(viewerId) ? onBench : [viewerId, ...onBench];
    return {
      rank,
      manages: true,
      seesMoney: true,
      everything: true,
      above,
      controls,
      // Their own manager, if they have one, is somebody they may hand a
      // ticket to without controlling. An owner is in neither list.
      assignable: offered,
      visible: offered,
    };
  }

  const covers = deputies
    .filter((row) => row.deputyId === viewerId && row.canManage)
    .map((row) => row.managerId);
  const controls = people
    .filter((person) => {
      if (person.userId === viewerId) return true;
      if (above.includes(person.userId)) return false;
      const over = peopleAbove(person.userId, people, deputies);
      if (over.has(viewerId)) return true;
      // Standing in for a manager reaches that manager's technicians.
      return person.role === "technician" && covers.some((id) => over.has(id));
    })
    .map((person) => person.userId);

  return {
    rank,
    manages: true,
    seesMoney: true,
    everything: false,
    above,
    controls: controls.includes(viewerId) ? controls : [viewerId, ...controls],
    /*
     * Passing a ticket up is giving it away, not controlling anybody — so the
     * people above this assistant are offered even though their tickets are
     * not.
     *
     * ⚠️ `onBench` is the filtered list, so an owner cannot come back in
     * through this door. Handing a ticket to the shop's owner is not a thing
     * a bench assistant does, and offering it would be the one place the
     * picker still named them.
     */
    assignable: [...new Set([...controls, viewerId, ...above.filter((id) => onBench.includes(id))])],
    visible: [...new Set([viewerId, ...onBench])],
  };
}

export function ticketControl(
  authority: DeskAuthority,
  viewerId: string,
  holderId: string | null,
): DeskControl {
  if (authority.rank === "viewer") return "none";
  if (authority.rank === "technician") {
    return holderId === viewerId && authority.controls.includes(viewerId) ? "own" : "none";
  }
  if (holderId && authority.above.includes(holderId)) return "none";
  if (authority.everything || !holderId) return "full";
  return authority.controls.includes(holderId) ? "full" : "none";
}

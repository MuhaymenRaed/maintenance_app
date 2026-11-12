/**
 * Who can see which part of the back office.
 *
 * `user_role` in the database is `customer | admin | technician |
 * super_admin | sales_admin | repair_admin | trade_admin` — the seven roles
 * `StaffRole` lists below, one for one. (This header used to say the enum
 * held three values and the rest were declared here in anticipation; the
 * migration ran on 2026-08-12 and the two have agreed since.)
 */

/** Roles the UI understands, including ones the enum does not carry yet. */
export type StaffRole =
  | "admin"
  | "super_admin"
  | "sales_admin"
  | "repair_admin"
  | "trade_admin"
  | "technician"
  | "customer";

export type AdminSection =
  | "overview"
  | "orders"
  | "repairs"
  /** Programming jobs — system installs, unlocks, accounts. A bench of its own, held apart from repairs. */
  | "programming"
  | "inventory"
  | "filters"
  | "branches"
  | "featured"
  | "showcase"
  /**
   * The shop's own pages — the news and the about page. Beside `showcase`
   * rather than inside it: that page answers "what does the front page show
   * this month", this one answers "what does the shop say", and a post is
   * written by somebody who came to write, not to arrange a rail.
   */
  | "content"
  | "offers"
  /**
   * Points: the tier ladder, the store, the daily diamond, the shop's own
   * challenges and the pool personal rounds are drawn from. Held by whoever
   * holds `offers` — it was the foot of that page until 2026-10-22.
   */
  | "loyalty"
  | "notifications"
  | "customers"
  /**
   * Everything customers send the shop that is not an order, a repair or a
   * replacement: "found it cheaper", "find me this", site ratings, reviews,
   * comments, job applications — and the switches for every prompt that asks
   * them. Its own section so that a manager can be given it from the staff page
   * without being given the customer list or the marketing figures.
   */
  | "requests"
  | "tradeIns"
  | "marketing"
  | "staff"
  /**
   * What customers said about the people who served them.
   *
   * ⚠️ A section of its own rather than a tab inside `staff`, and the split is
   * the same one `staff.write` and `technicians.write` already make. `staff`
   * is *permissions* — who somebody is, what they may touch — and is an
   * owner's decision. This is *feedback about a person's work*, which is a
   * manager's, and a shop can reasonably want the second read by somebody it
   * would never hand the first.
   *
   * It also carries a real disclosure risk in the other direction: the rows
   * name a customer, their phone and their email beside an unflattering
   * sentence about a named colleague. Merged into `staff`, every role holding
   * that section would have been given it silently.
   */
  | "ratings"
  /**
   * The people who report to this person.
   *
   * ⚠️ Distinct from `staff`, and the difference is *scope* rather than
   * subject. `staff` is the whole roster and belongs to an owner; this is the
   * handful of accounts linked to **you**, and it is what makes a department
   * manager possible without making them an owner of the shop.
   *
   * A super admin sees `staff` and therefore everybody. A manager sees `team`
   * and therefore their own reports — and holds `team.manage` if the owner
   * wants them able to change those reports' access as well as look at it.
   */
  | "team"
  /**
   * المطابقة — which screen fits which handset, and which battery.
   *
   * Its own section rather than a panel inside `repairs`, and the split is
   * the one `ratings` already draws: `repairs` is a **queue**, worked ticket
   * by ticket by whoever is on shift, and this is a **reference table** the
   * counter opens mid-conversation to answer "we are out of the exact
   * screen, will this one do". Different question, different reader, a
   * different moment — folding it into the queue would put a lookup table
   * under a list of somebody else's jobs.
   *
   * It is also the point of it being separate: the shop asked for a tab
   * "accessible by the people the admin will specify in the team and
   * permissions page", and a section is the unit that page grants. A panel
   * inside `repairs` could only ever be held by everybody who holds the
   * queue, which includes every technician.
   */
  ;

/**
 * Section access per role.
 *
 * Ordered as the tabs appear, so the first entry is also where that role lands
 * when they open the dashboard — see `landingSection`. The tab order itself is
 * declared once in `app/[locale]/admin/layout.tsx`, grouped by the job each
 * section does: the queues somebody is waiting on, then the catalogue, then
 * the home page, then the shop. Every row here follows that grouping, and
 * `overview` stays first in every row that has it, because a role landing on
 * its own queue instead of the dashboard is a decision `technician` makes
 * deliberately and nobody else should make by accident.
 */
const ROLE_SECTIONS: Record<StaffRole, AdminSection[]> = {
  // Owner: everything, including managing other staff.
  super_admin: [
    "overview",
    "orders",
    "repairs",
    "programming",
    "tradeIns",
    "customers",
    "requests",
    "inventory",
    "filters",
    "featured",
    "showcase",
    "content",
    "offers",
    "loyalty",
    "notifications",
    "branches",
    "marketing",
    "staff",
    "ratings",
    "team",
  ],
  // The enum's existing admin behaves as the owner until roles are split.
  admin: [
    "overview",
    "orders",
    "repairs",
    "programming",
    "tradeIns",
    "customers",
    "requests",
    "inventory",
    "filters",
    "featured",
    "showcase",
    "content",
    "offers",
    "loyalty",
    "notifications",
    "branches",
    "marketing",
    "staff",
    "ratings",
    "team",
  ],
  // Sells and merchandises; no access to repair benches or buy-back pricing.
  sales_admin: [
    "overview",
    "orders",
    "customers",
    "requests",
    "inventory",
    "filters",
    "featured",
    "showcase",
    "content",
    "offers",
    "loyalty",
    // Announcing is an offers-desk act; `notifications.send` is the switch
    // for it. See `sendNotification`.
    "notifications",
    "marketing",
  ],
  /*
   * Runs the repair operation end to end — which now includes the bench.
   *
   * `technicians` is gone as a section: the roster it used to hold moved onto
   * `/admin/staff`, because a bench record that is not an account is a name in
   * a list and nothing else. So this role gets `staff` instead. It does *not*
   * get `staff.write` — see `ROLE_CAPABILITIES` — so the page opens read-only
   * on roles and permissions, and the only half it can edit is the bench,
   * which is what `technicians.write` now gates.
   */
  repair_admin: [
    "overview",
    "repairs",
    "inventory",
    "branches",
    "staff",
    "ratings",
  ],
  // Owns buy-backs.
  trade_admin: ["overview", "tradeIns", "customers", "branches"],
  /**
   * Works tickets, and sees nothing else.
   *
   * ⚠️ This used to be `["overview", "repairs", "inventory"]`, and both of the
   * sections that have gone were wrong for the same reason.
   *
   * **Overview** is the shop's money — revenue split three ways, the period
   * panel, top sellers, the customer population. A person at a bench has no
   * decision that figure informs, and putting a technician on a page that
   * reports what the business took is a disclosure nobody chose to make. The
   * staff panel on that page was already withheld from them for exactly this
   * reasoning ("a technician opening the overview sees the shop's numbers and
   * not a league table they are on"); the argument applies to the numbers too.
   *
   * **Inventory** is the price list. The capability map has always refused
   * them `products.write` — see the note at the top of `ROLE_CAPABILITIES`
   * about a technician ending up with a delete button on it — so the section
   * was a catalogue they could read and not touch, offered on the reasoning
   * that a fix needs parts. It does, and the *ticket* is where that belongs.
   *
   * What is left is the queue, which is the whole job. `/admin` sends them
   * straight to it — see `landingSection`.
   */
  technician: ["repairs"],
  customer: [],
};

/**
 * What a role may *change*, as opposed to what it may look at.
 *
 * Seeing a section and editing it are different questions, and conflating them
 * is how a technician ends up with a delete button on the price list. A
 * capability is named after the act, not the page, because the same act is
 * offered from several places — a product is edited from the dashboard board,
 * from the pencil on a catalogue card, and from the product page itself, and
 * all three have to agree.
 *
 * ---------------------------------------------------------------------------
 * This is presentation, not enforcement
 * ---------------------------------------------------------------------------
 * Every one of these is also a row-level security policy in Postgres, and the
 * policy is what actually decides. This map exists so the UI does not offer a
 * control that the database is going to refuse — an editor that opens, accepts
 * twelve fields and then fails on save is worse than no editor.
 *
 * See `supabase/migrations/20260814_staff_capabilities.sql`: until it is
 * applied, the database recognises only `admin`, so a section manager is shown
 * their sections and refused every write in them.
 */
export type Capability =
  | "products.write"
  | "products.delete"
  | "orders.write"
  | "repairs.write"
  /** Moving a programming job along — the programming bench's twin of `repairs.write`. */
  | "programming.write"
  | "tradeIns.write"
  | "offers.write"
  | "branches.write"
  /**
   * Putting somebody on the bench, and taking them off it.
   *
   * ── Why this survived the merge of `/admin/technicians` into `/admin/staff` ──
   *
   * The two halves of that page answer different questions and are held by
   * different people. `staff.write` decides *what somebody may do* — their
   * role, their sections, their capabilities — and is an owner's decision.
   * This one decides *whether they take repair tickets, and at which branch*,
   * which is the repair manager's, and it is why `repair_admin` can be given
   * the staff page without being able to hand out permissions on it.
   *
   * Splitting them is what lets one page serve both without either role being
   * offered a control it should not have.
   */
  | "technicians.write"
  | "staff.write"
  /**
   * Refusing somebody's custom.
   *
   * The first capability that is *not* held by every role with full section
   * access. Blocking is not editing a record — there is no customer record to
   * edit, only the history of what they did — it is a decision to stop taking
   * a person's money, and it should have one of two names on it for the same
   * reason permanently deleting a category does.
   *
   * Held by the two owner roles only. `sales_admin` runs the shop floor and
   * sees the customers board; that is the role this exists to withhold it
   * from.
   */
  | "customers.block"
  /**
   * Putting somebody on the ratings page, and taking them off it.
   *
   * Distinct from `staff.write` for the reason the section is: writing a
   * `staff_profiles` row publishes a colleague's photograph and job title to
   * the storefront, which is a decision about how the shop presents itself
   * rather than about what anybody is allowed to do.
   *
   * ⚠️ It does **not** gate reading the ratings — that is the section — and
   * nothing gates *editing* one, because nothing may. A rating is a customer's
   * own statement; `staff_ratings` carries no insert or update policy for the
   * back office at all, so an owner cannot quietly improve their own numbers.
   */
  | "crew.write"
  /**
   * Changing the sections and capabilities of somebody who reports to you.
   *
   * ⚠️ **Not** a narrower `staff.write`. That one is the whole roster and can
   * change a *role*; this one is scoped to your own reports by the database —
   * `staff_access_write_manager` tests `manages(user_id)` — and cannot touch a
   * role at all. The split is what lets a department manager run their
   * department without being able to promote themselves: a role is what the
   * database honours, and a grant can never exceed it.
   *
   * ⚠️ It is also the first capability whose backing is a **relationship**
   * rather than a role, which is why `roleBacks` treats it specially. Every
   * staff role can hold it honestly, because the policy behind it asks who
   * reports to you and never asks what you are.
   */
  | "team.manage"
  /**
   * Answering what customers sent, and switching the storefront's prompts on
   * and off. `can_write_requests()` is the database's half of it.
   */
  | "requests.write"
  /*
   * ── Finer powers inside an area (2026-10-31) ──
   *
   * The shop asked for each part of a job to be its own decision. These five
   * split acts that used to ride on a broader write: cancelling an order and
   * selling at the counter on `orders.write`, a customer note on simply being
   * able to open the board, an announcement on `offers.write`. Each is checked
   * by the server action that performs it, so a box left unticked is a refusal
   * and not only a missing button.
   *
   * `customers.delete` is the one the database also asks — `remove_customer()`
   * calls `staff_may('customers.delete', …)`.
   */
  /** Calling an order off, which gives back its stock, coupon and trade-in. */
  | "orders.cancel"
  /** Entering a sale at the counter. Needs `orders.write` too: it is an order. */
  | "orders.counter"
  /** Writing a note or a warning on a customer. */
  | "customers.notes"
  /** Removing a customer from the list, and deleting their account. */
  | "customers.delete"
  /**
   * Taking an order, a repair ticket or a buy-back off the boards.
   *
   * ⚠️ Its own capability rather than a corner of `orders.cancel`, because the
   * two are different acts on the same row. Cancelling is a *fact about the
   * order* — it did not go ahead, the customer still sees it, and every
   * revenue figure already skips it. Deleting says the row should not be in
   * the shop's records at all, which is a judgement about the record rather
   * than about the sale, and the person who may call a delivery off is not
   * automatically the person who may rewrite what the month looked like.
   *
   * ⚠️ One capability for all three queues, deliberately. A per-section
   * `orders.delete` / `repairs.delete` / `tradeIns.delete` would be three
   * boxes for one decision, and the decision is the same one each time:
   * whether this account may make a record disappear from every board and
   * every total. `delete_record()` asks for exactly this name.
   *
   * Owner roles only, and the database agrees — `staff_may('records.delete',
   * …)` is what actually refuses it.
   */
  | "records.delete"
  /** Sending an announcement to customers' bells and phones. */
  | "notifications.send";

/** Every capability, in the order the staff editor lists them. */
export const ALL_CAPABILITIES: Capability[] = [
  "products.write",
  "products.delete",
  "orders.write",
  "repairs.write",
  "programming.write",
  "tradeIns.write",
  "offers.write",
  "branches.write",
  "technicians.write",
  "staff.write",
  "customers.block",
  "crew.write",
  "team.manage",
  "requests.write",
  "orders.cancel",
  "orders.counter",
  "customers.notes",
  "customers.delete",
  "records.delete",
  "notifications.send",
  /*
   * ⚠️ `super_admin` and `admin` are defined *as* this array, so a capability
   * left out of it is one the owners do not hold — and the staff grants dialog
   * builds its checklist from it too, so an omitted capability cannot even be
   * granted. It has happened: one lived in the type, in the role map and in an
   * action's `authorize()` call while the owner of the shop was shown a
   * read-only banner for it.
   *
   * `Capability` is a union and this is a hand-kept list of that union, so
   * leaving a member out does not fail a build. Add one here in the same
   * change that adds it to the type.
   */
];

/**
 * Capabilities whose database policy is scoped by a **relationship**, not by a
 * role.
 *
 * ⚠️ `roleBacks` exists because RLS tests the role — `can_write_orders()` is
 * `has_role([...])` and has never heard of `staff_access` — so a grant that
 * exceeds the role is a control the database will refuse, and the staff editor
 * warns about it. That reasoning does not apply to these: their policy asks
 * *who reports to you* and never asks what you are, so any staff role can hold
 * one and have it honoured.
 *
 * Listing them here rather than adding them to every role's row keeps
 * `ROLE_CAPABILITIES` meaning what it says — the capabilities a role carries
 * **by default** — while stopping the editor from warning about a grant that is
 * in fact perfectly backed.
 */
const RELATIONSHIP_BACKED: Capability[] = ["team.manage"];

/** Every section, in tab order. The staff editor draws its checklist from it. */
export const ALL_SECTIONS: AdminSection[] = [
  "overview",
  "orders",
  "repairs",
  "programming",
  "tradeIns",
  "customers",
  "requests",
  "inventory",
  "filters",
  "featured",
  "showcase",
  "content",
  "offers",
  "loyalty",
  "notifications",
  "branches",
  "marketing",
  "staff",
  "ratings",
  "team",
];

const ROLE_CAPABILITIES: Record<StaffRole, Capability[]> = {
  super_admin: ALL_CAPABILITIES,
  admin: ALL_CAPABILITIES,
  // Runs the shop floor: the catalogue, what it costs, and the orders it
  // produces. Deleting a product is deliberately withheld — an accidental
  // delete is the one action here with no cheap undo.
  // Note this list is now genuinely narrower than the owners' — it omits
  // `customers.block`. This role sees the customers board and may not refuse
  // anyone's custom.
  sales_admin: [
    "products.write",
    "orders.write",
    "orders.cancel",
    "orders.counter",
    "offers.write",
    "notifications.send",
    "requests.write",
    "customers.notes",
  ],
  // The bench manager publishes their own technicians' cards — the people on
  // the ratings page are mostly theirs, and asking an owner to type a job
  // title is how a page stays empty.
  repair_admin: [
    "repairs.write",
    "technicians.write",
    "branches.write",
    "crew.write",
  ],
  trade_admin: ["tradeIns.write", "customers.notes"],
  // Works the bench. Moves a ticket along; changes nothing about what is sold.
  technician: ["repairs.write"],
  customer: [],
};

export function sectionsFor(role: string): AdminSection[] {
  return ROLE_SECTIONS[role as StaffRole] ?? [];
}

/** May this role perform this act? The database asks the same question. */
export function can(
  role: string | null | undefined,
  capability: Capability,
): boolean {
  if (!role) return false;
  return (ROLE_CAPABILITIES[role as StaffRole] ?? []).includes(capability);
}

export function canAccess(role: string, section: AdminSection): boolean {
  return sectionsFor(role).includes(section);
}

/* ─────────────────────── per-person overrides ─────────────────────── */

/**
 * One person's exceptions to their role, from `staff_access`.
 *
 * Seven fixed roles do not describe a real shop. The bench supervisor who also
 * settles buy-backs, the salesperson trusted with offers but not with prices —
 * each of those would otherwise be a new enum value, a new row in
 * `ROLE_SECTIONS`, and a deploy. The role stays as the default and this holds
 * the exceptions, so the owner can compose an access level from the parts
 * instead of asking for one to be invented.
 *
 * **`null` and `[]` are different and both are meaningful.** `null` is "no
 * opinion", so the role's own list applies; `[]` is "nothing", explicitly — a
 * deliberately locked account. Collapsing them would make revoking every
 * section impossible to express, because it would read as "use the defaults"
 * and hand the tabs straight back.
 */
export type AccessGrant = {
  sections: AdminSection[] | null;
  capabilities: Capability[] | null;
  /**
   * What this composed level is *called* — "Workshop lead", "Front desk".
   *
   * Display only. Nothing authorises against it and nothing ever should: the
   * role buys the database privilege and the two arrays decide what is
   * offered. A title that appeared to grant something would be the most
   * dangerous field on the staff page. Null falls back to the role's own
   * label. Needs `20260824_staff_access_title.sql`.
   */
  title: string | null;
};

/** No row in `staff_access`, or the table is not there yet. */
export const ROLE_DEFAULTS: AccessGrant = {
  sections: null,
  capabilities: null,
  title: null,
};

/**
 * ── A grant composes an access level; it no longer only narrows one ──
 *
 * This used to *intersect* the grant with the role, so a box the role did not
 * carry could be ticked and would then be silently dropped on read. In
 * practice that meant only `admin` and `super_admin` could be given everything,
 * and every other role was a fixed bundle with some boxes permanently greyed
 * out — so composing "a bench supervisor who also settles buy-backs" was
 * impossible unless you made them an owner.
 *
 * The grant is now the answer when it is set: `null` still means "follow the
 * role", `[]` still means "explicitly nothing", and a list means *this list*,
 * whether it is narrower than the role or wider.
 *
 * ⚠️ **Widening here does not widen the database.** Row-level security tests
 * the *role* — `can_write_orders()` is `has_role(['admin','super_admin',
 * 'sales_admin'])` and knows nothing about `staff_access` — so a technician
 * granted `orders.write` is shown the control and refused the write. That is
 * the exact failure this file's header warns about, which is why
 * `roleBacks()` below exists and why the staff editor draws a warning on any
 * box the base role's policies will not honour. Use it to pick the right base
 * role, not to work around one.
 */
export function effectiveSections(
  role: string,
  grant: AccessGrant = ROLE_DEFAULTS,
): AdminSection[] {
  if (!grant.sections) return sectionsFor(role);
  const allowed = new Set<string>(grant.sections);
  // Ordered by `ALL_SECTIONS` rather than by the grant, so the tabs keep a
  // stable order no matter what order the boxes were ticked in.
  return ALL_SECTIONS.filter((section) => allowed.has(section));
}

export function effectiveCapabilities(
  role: string | null | undefined,
  grant: AccessGrant = ROLE_DEFAULTS,
): Capability[] {
  if (!grant.capabilities) return ROLE_CAPABILITIES[role as StaffRole] ?? [];
  const allowed = new Set<string>(grant.capabilities);
  return ALL_CAPABILITIES.filter((capability) => allowed.has(capability));
}

/**
 * Does this role's *database* privilege actually back this capability?
 *
 * The UI may now offer anything, so this is what keeps it honest: it answers
 * whether RLS will let the write through, which is a question only the role
 * can answer. The staff editor uses it to mark a ticked box the database is
 * going to refuse, and to name the role that would carry it.
 */
export function roleBacks(
  role: string | null | undefined,
  capability: Capability,
): boolean {
  // Scoped by a relationship rather than by a role — see `RELATIONSHIP_BACKED`.
  // Every staff role backs these, because the policy behind them never asks
  // what the caller is.
  if (RELATIONSHIP_BACKED.includes(capability)) {
    return Boolean(role) && role !== "customer";
  }
  return (ROLE_CAPABILITIES[role as StaffRole] ?? []).includes(capability);
}

/** Which assignable roles carry a capability, for "this needs X" copy. */
export function rolesCarrying(capability: Capability): StaffRole[] {
  return (Object.keys(ROLE_CAPABILITIES) as StaffRole[]).filter(
    (role) => role !== "customer" && ROLE_CAPABILITIES[role].includes(capability),
  );
}

/** `can`, with this person's own grant folded in. */
export function canWith(
  role: string | null | undefined,
  grant: AccessGrant,
  capability: Capability,
): boolean {
  if (!role) return false;
  return effectiveCapabilities(role, grant).includes(capability);
}

export function canAccessWith(
  role: string,
  grant: AccessGrant,
  section: AdminSection,
): boolean {
  return effectiveSections(role, grant).includes(section);
}

/** Anyone with at least one section may open the dashboard. */
export function isStaffRole(role: string): boolean {
  return sectionsFor(role).length > 0;
}

/**
 * Where `/admin` should put this person.
 *
 * The overview is the dashboard's front door for anybody who may see it, and
 * for anybody who may not it is a redirect loop waiting to happen:
 * `requireSection` sends a refusal back to `/admin`, and `/admin` is the
 * overview. A technician — whose sections are now `["repairs"]` alone — would
 * bounce between the two forever.
 *
 * So `/admin` asks this first and forwards. `ALL_SECTIONS` order decides, which
 * is the same order the tabs are drawn in, so somebody always lands on the
 * leftmost thing they can see. `null` means no section at all, which
 * `requireStaff` has already refused the door to.
 */
export function landingSection(
  role: string,
  grant: AccessGrant = ROLE_DEFAULTS,
): AdminSection | null {
  return effectiveSections(role, grant)[0] ?? null;
}

/** The route each section is reached at, so callers do not hand-write paths. */
export const SECTION_HREF: Record<AdminSection, string> = {
  overview: "/admin",
  orders: "/admin/orders",
  repairs: "/admin/repairs",
  programming: "/admin/programming",
  inventory: "/admin/inventory",
  filters: "/admin/filters",
  branches: "/admin/branches",
  featured: "/admin/featured",
  showcase: "/admin/showcase",
  content: "/admin/content",
  offers: "/admin/offers",
  loyalty: "/admin/loyalty",
  notifications: "/admin/notifications",
  customers: "/admin/customers",
  requests: "/admin/requests",
  tradeIns: "/admin/trade-ins",
  marketing: "/admin/marketing",
  staff: "/admin/staff",
  ratings: "/admin/ratings",
  team: "/admin/team",
};

/** Only the owner may change other people's roles. */
export function canManageStaff(role: string): boolean {
  return canAccess(role, "staff");
}

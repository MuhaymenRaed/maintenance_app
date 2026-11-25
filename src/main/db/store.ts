import fs from "node:fs";
import { EventEmitter } from "node:events";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import type { OpKind } from "../../shared/contract";
import { applyOp, cloneRaw, type AnyOp, type OpPayload, type RawTicket } from "../desk/raw";
import { logger } from "../log";

const log = logger("store");

/**
 * The desk's memory on this computer: one SQLite file.
 *
 * ---------------------------------------------------------------------------
 * What is in it
 * ---------------------------------------------------------------------------
 * - `tickets` — every ticket **as the server last returned it**, as JSON, plus
 *   the tickets opened here that the server has not seen yet (their draft).
 *   A row's `id` is the id the window uses and it never changes: a pulled
 *   ticket keeps its server id; a ticket opened here keeps the id it was born
 *   with and gains a `server_id` once it is sent. So a dialog open on a ticket
 *   while it is being uploaded does not lose its ticket.
 * - `outbox` — every change made here that the server has not accepted, in the
 *   order it was made. A change leaves only after the server says yes and the
 *   ticket has been read back.
 * - `refs` — the reference data the desk draws with (the bench's people, the
 *   branches, the fault list, the makes and models) so it all works offline.
 * - `meta` — cursors and small facts: where the last pull stopped, who the
 *   account is.
 * - `notices` — the app's own notification history.
 *
 * ---------------------------------------------------------------------------
 * Why everything is also held in memory
 * ---------------------------------------------------------------------------
 * The board is redrawn on every change, filtered by the window and the search,
 * and the whole bench is a few thousand rows at most. Reading it from memory is
 * instant; SQLite is where it is *kept*. Every write goes to the file inside a
 * transaction before the in-memory copy changes, so a crash at any moment
 * leaves the file and the next start consistent.
 *
 * WAL mode with `synchronous = NORMAL`: a power cut can lose the last fraction
 * of a second, never corrupt the file.
 */

export type TicketRecord = {
  id: string;
  serverId: string | null;
  raw: RawTicket;
  updatedAt: string | null;
  deleted: boolean;
  /** The provisional code of a ticket opened here, kept after it gets a real one — it is on the customer's receipt. */
  localCode: string | null;
  createdHere: boolean;
};

export type OpRecord = {
  id: number;
  ticketId: string;
  kind: OpKind;
  payload: OpPayload[OpKind];
  createdAt: string;
  attempts: number;
  state: "pending" | "failed";
  error: string | null;
  nextAt: number;
};

export type Notice = {
  id: number;
  kind: string;
  title: string;
  body: string;
  ticketId: string | null;
  at: string;
  read: boolean;
};

const SCHEMA_VERSION = 1;

const MIGRATIONS: string[] = [
  `create table if not exists meta (key text primary key, value text);
   create table if not exists tickets (
     id text primary key,
     server_id text unique,
     updated_at text,
     deleted integer not null default 0,
     data text not null,
     local_code text,
     created_here integer not null default 0
   );
   create index if not exists tickets_updated on tickets (updated_at);
   create table if not exists outbox (
     id integer primary key autoincrement,
     ticket_id text not null,
     kind text not null,
     payload text not null,
     created_at text not null,
     attempts integer not null default 0,
     state text not null default 'pending',
     error text,
     next_at integer not null default 0
   );
   create index if not exists outbox_ticket on outbox (ticket_id);
   create table if not exists refs (name text primary key, data text not null, updated_at text not null);
   create table if not exists notices (
     id integer primary key autoincrement,
     kind text not null,
     title text not null,
     body text not null,
     ticket_id text,
     at text not null,
     read integer not null default 0
   );`,
];

export class Store {
  readonly events = new EventEmitter();
  private db!: DatabaseSync;
  private file!: string;
  readonly tickets = new Map<string, TicketRecord>();
  private readonly byServer = new Map<string, string>();
  ops: OpRecord[] = [];
  private refs = new Map<string, unknown>();
  private stmts!: Record<string, StatementSync>;
  /** Ops being sent right now — never merged into or reordered while in flight. */
  readonly inFlight = new Set<number>();
  version = 0;

  open(file: string) {
    this.file = file;
    this.db = new DatabaseSync(file);
    this.db.exec("pragma journal_mode = wal; pragma synchronous = normal; pragma foreign_keys = on; pragma busy_timeout = 5000;");
    this.migrate();
    this.prepare();
    this.load();
    log.info(`opened ${file}: ${this.tickets.size} tickets, ${this.ops.length} waiting changes`);
  }

  close() {
    try {
      this.db.exec("pragma wal_checkpoint(truncate)");
      this.db.close();
    } catch (error) {
      log.warn("close failed", error);
    }
  }

  get path() {
    return this.file;
  }

  /** A consistent copy of the whole database, written to `target` — the backup. */
  copyTo(target: string) {
    fs.rmSync(target, { force: true });
    this.db.exec(`vacuum into '${target.replace(/'/g, "''")}'`);
  }

  private migrate() {
    const current = Number(
      (this.db.prepare("pragma user_version").get() as { user_version: number } | undefined)?.user_version ?? 0,
    );
    for (let version = current; version < SCHEMA_VERSION; version += 1) {
      this.db.exec("begin");
      try {
        this.db.exec(MIGRATIONS[version]);
        this.db.exec(`pragma user_version = ${version + 1}`);
        this.db.exec("commit");
      } catch (error) {
        this.db.exec("rollback");
        throw error;
      }
    }
  }

  private prepare() {
    const db = this.db;
    this.stmts = {
      getMeta: db.prepare("select value from meta where key = ?"),
      setMeta: db.prepare("insert into meta (key, value) values (?, ?) on conflict (key) do update set value = excluded.value"),
      delMeta: db.prepare("delete from meta where key = ?"),
      putTicket: db.prepare(
        `insert into tickets (id, server_id, updated_at, deleted, data, local_code, created_here)
         values (?, ?, ?, ?, ?, ?, ?)
         on conflict (id) do update set server_id = excluded.server_id, updated_at = excluded.updated_at,
           deleted = excluded.deleted, data = excluded.data, local_code = excluded.local_code,
           created_here = excluded.created_here`,
      ),
      delTicket: db.prepare("delete from tickets where id = ?"),
      addOp: db.prepare("insert into outbox (ticket_id, kind, payload, created_at) values (?, ?, ?, ?)"),
      putOpPayload: db.prepare("update outbox set payload = ? where id = ?"),
      putOpState: db.prepare("update outbox set attempts = ?, state = ?, error = ?, next_at = ? where id = ?"),
      delOp: db.prepare("delete from outbox where id = ?"),
      putRef: db.prepare("insert into refs (name, data, updated_at) values (?, ?, ?) on conflict (name) do update set data = excluded.data, updated_at = excluded.updated_at"),
      addNotice: db.prepare("insert into notices (kind, title, body, ticket_id, at) values (?, ?, ?, ?, ?)"),
      listNotices: db.prepare("select * from notices order by id desc limit 200"),
      readNotices: db.prepare("update notices set read = 1 where id = ?"),
      readAllNotices: db.prepare("update notices set read = 1"),
      clearNotices: db.prepare("delete from notices"),
      trimNotices: db.prepare("delete from notices where id not in (select id from notices order by id desc limit 200)"),
    };
  }

  private load() {
    this.tickets.clear();
    this.byServer.clear();
    for (const row of this.db.prepare("select * from tickets").all() as {
      id: string;
      server_id: string | null;
      updated_at: string | null;
      deleted: number;
      data: string;
      local_code: string | null;
      created_here: number;
    }[]) {
      const record: TicketRecord = {
        id: row.id,
        serverId: row.server_id,
        raw: JSON.parse(row.data) as RawTicket,
        updatedAt: row.updated_at,
        deleted: row.deleted === 1,
        localCode: row.local_code,
        createdHere: row.created_here === 1,
      };
      this.tickets.set(record.id, record);
      if (record.serverId) this.byServer.set(record.serverId, record.id);
    }
    this.ops = (this.db.prepare("select * from outbox order by id").all() as {
      id: number;
      ticket_id: string;
      kind: OpKind;
      payload: string;
      created_at: string;
      attempts: number;
      state: "pending" | "failed";
      error: string | null;
      next_at: number;
    }[]).map((row) => ({
      id: row.id,
      ticketId: row.ticket_id,
      kind: row.kind,
      payload: JSON.parse(row.payload) as OpPayload[OpKind],
      createdAt: row.created_at,
      attempts: row.attempts,
      state: row.state,
      error: row.error,
      nextAt: row.next_at,
    }));
    this.refs.clear();
    for (const row of this.db.prepare("select name, data from refs").all() as { name: string; data: string }[]) {
      try {
        this.refs.set(row.name, JSON.parse(row.data));
      } catch {
        // A damaged reference is refetched on the next sync.
      }
    }
  }

  /** Reopens from disk — after a backup has been restored over the file. */
  reopen(file = this.file) {
    this.close();
    this.inFlight.clear();
    this.open(file);
    this.bump();
  }

  transaction<T>(fn: () => T): T {
    this.db.exec("begin immediate");
    try {
      const result = fn();
      this.db.exec("commit");
      return result;
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
  }

  /** Something the window draws has changed. */
  bump() {
    this.version += 1;
    this.events.emit("changed", this.version);
  }

  /* ── meta and refs ─────────────────────────────────────────────────── */

  meta(key: string): string | null {
    const row = this.stmts.getMeta.get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string | null) {
    if (value === null) this.stmts.delMeta.run(key);
    else this.stmts.setMeta.run(key, value);
  }

  ref<T>(name: string): T | undefined {
    return this.refs.get(name) as T | undefined;
  }

  setRef(name: string, data: unknown) {
    this.stmts.putRef.run(name, JSON.stringify(data), new Date().toISOString());
    this.refs.set(name, data);
  }

  /* ── tickets ───────────────────────────────────────────────────────── */

  private persist(record: TicketRecord) {
    this.stmts.putTicket.run(
      record.id,
      record.serverId,
      record.updatedAt,
      record.deleted ? 1 : 0,
      JSON.stringify(record.raw),
      record.localCode,
      record.createdHere ? 1 : 0,
    );
  }

  idForServer(serverId: string): string | undefined {
    return this.byServer.get(serverId);
  }

  /**
   * The server's copy of one ticket, stored. Answers whether the ticket is new
   * to this computer and whether anything about it changed — what decides a
   * "new booking" notification.
   */
  putServerTicket(raw: RawTicket): { id: string; isNew: boolean; changed: boolean; before: RawTicket | null } {
    const existingId = this.byServer.get(raw.id);
    const existing = existingId ? this.tickets.get(existingId) : undefined;
    const id = existing?.id ?? raw.id;
    const before = existing?.raw ?? null;
    const changed = !existing || JSON.stringify(existing.raw) !== JSON.stringify(raw);
    if (!changed) return { id, isNew: false, changed: false, before };
    const record: TicketRecord = {
      id,
      serverId: raw.id,
      raw,
      updatedAt: raw.updated_at,
      deleted: raw.is_deleted,
      localCode: existing?.localCode ?? null,
      createdHere: existing?.createdHere ?? false,
    };
    this.persist(record);
    this.tickets.set(id, record);
    this.byServer.set(raw.id, id);
    return { id, isNew: !existing, changed: true, before };
  }

  /** A ticket opened on this computer, before the server has seen it. */
  putDraft(id: string, raw: RawTicket, localCode: string) {
    const record: TicketRecord = { id, serverId: null, raw, updatedAt: null, deleted: false, localCode, createdHere: true };
    this.persist(record);
    this.tickets.set(id, record);
  }

  /** The server accepted a ticket opened here: remember which server row it is. */
  linkServer(id: string, serverId: string) {
    const record = this.tickets.get(id);
    if (!record) return;
    record.serverId = serverId;
    this.persist(record);
    this.byServer.set(serverId, id);
  }

  removeTicket(id: string) {
    const record = this.tickets.get(id);
    this.stmts.delTicket.run(id);
    this.tickets.delete(id);
    if (record?.serverId) this.byServer.delete(record.serverId);
  }

  /** Every ticket the server holds that has no change waiting here. */
  serverIdsWithoutWork(): Map<string, string> {
    const busy = new Set(this.ops.map((op) => op.ticketId));
    const out = new Map<string, string>();
    for (const record of this.tickets.values()) {
      if (record.serverId && !busy.has(record.id)) out.set(record.serverId, record.id);
    }
    return out;
  }

  /**
   * The ticket as the screen should show it: the server's copy with every
   * change still waiting laid over it, in the order they were made. A refused
   * change is not applied — the screen shows what the server actually holds.
   */
  view(id: string): RawTicket | null {
    const record = this.tickets.get(id);
    if (!record) return null;
    const raw = cloneRaw(record.raw);
    for (const op of this.ops) {
      if (op.ticketId !== id || op.state !== "pending") continue;
      // Dated by when it was made here, as the server will date it on arrival.
      applyOp(raw, { kind: op.kind, payload: op.payload, createdAt: op.createdAt } as AnyOp);
    }
    return raw;
  }

  syncStateOf(id: string): "pending" | "failed" | null {
    let state: "pending" | "failed" | null = null;
    for (const op of this.ops) {
      if (op.ticketId !== id) continue;
      if (op.state === "failed") return "failed";
      state = "pending";
    }
    return state;
  }

  /* ── the outbox ────────────────────────────────────────────────────── */

  /**
   * Queues one change. A second edit to the same fields of the same ticket,
   * made before the first was sent, is folded into it — ten presses on a
   * status stepper offline are one request when the line comes back, and the
   * last press is the one that lands.
   */
  addOp<K extends OpKind>(ticketId: string, kind: K, payload: OpPayload[K]): OpRecord {
    if (kind === "update" || kind === "finance" || kind === "details") {
      const last = [...this.ops].reverse().find((op) => op.ticketId === ticketId);
      if (last && last.kind === kind && last.state === "pending" && last.attempts === 0 && !this.inFlight.has(last.id)) {
        last.payload = { ...(last.payload as object), ...(payload as object) } as OpPayload[OpKind];
        this.stmts.putOpPayload.run(JSON.stringify(last.payload), last.id);
        return last;
      }
    }
    const createdAt = new Date().toISOString();
    const result = this.stmts.addOp.run(ticketId, kind, JSON.stringify(payload), createdAt);
    const op: OpRecord = {
      id: Number(result.lastInsertRowid),
      ticketId,
      kind,
      payload,
      createdAt,
      attempts: 0,
      state: "pending",
      error: null,
      nextAt: 0,
    };
    this.ops.push(op);
    return op;
  }

  updateOpPayload(op: OpRecord) {
    this.stmts.putOpPayload.run(JSON.stringify(op.payload), op.id);
  }

  opDone(op: OpRecord) {
    this.stmts.delOp.run(op.id);
    this.ops = this.ops.filter((candidate) => candidate.id !== op.id);
  }

  opRetryLater(op: OpRecord, error: string, nextAt: number) {
    op.attempts += 1;
    op.error = error;
    op.nextAt = nextAt;
    this.stmts.putOpState.run(op.attempts, op.state, op.error, op.nextAt, op.id);
  }

  opFailed(op: OpRecord, error: string) {
    op.attempts += 1;
    op.state = "failed";
    op.error = error;
    this.stmts.putOpState.run(op.attempts, op.state, op.error, op.nextAt, op.id);
  }

  opRetry(id: number) {
    const op = this.ops.find((candidate) => candidate.id === id);
    if (!op) return;
    op.state = "pending";
    op.error = null;
    op.nextAt = 0;
    this.stmts.putOpState.run(op.attempts, op.state, op.error, op.nextAt, op.id);
  }

  /**
   * Gives up on one change. Discarding a ticket's creation discards everything
   * queued on it and the draft itself — there is no server ticket for any of
   * it to reach.
   */
  opDiscard(id: number) {
    const op = this.ops.find((candidate) => candidate.id === id);
    if (!op) return;
    this.transaction(() => {
      if (op.kind === "create") {
        for (const other of this.ops.filter((candidate) => candidate.ticketId === op.ticketId)) {
          this.stmts.delOp.run(other.id);
        }
        this.ops = this.ops.filter((candidate) => candidate.ticketId !== op.ticketId);
        const record = this.tickets.get(op.ticketId);
        if (record && !record.serverId) this.removeTicket(op.ticketId);
      } else {
        this.stmts.delOp.run(op.id);
        this.ops = this.ops.filter((candidate) => candidate.id !== op.id);
      }
    });
  }

  /** Forgets every ticket and cursor, keeping the waiting changes — "download everything again". */
  forgetServerCopy() {
    this.transaction(() => {
      const keep = new Set(this.ops.map((op) => op.ticketId));
      for (const record of [...this.tickets.values()]) {
        if (!keep.has(record.id)) this.removeTicket(record.id);
      }
      for (const key of ["ticketsCursor", "financeCursor", "lastFullPull", "lastRefs"]) this.setMeta(key, null);
    });
  }

  /* ── notices ───────────────────────────────────────────────────────── */

  addNotice(kind: string, title: string, body: string, ticketId: string | null): Notice {
    const at = new Date().toISOString();
    const result = this.stmts.addNotice.run(kind, title, body, ticketId, at);
    this.stmts.trimNotices.run();
    return { id: Number(result.lastInsertRowid), kind, title, body, ticketId, at, read: false };
  }

  notices(): Notice[] {
    return (this.stmts.listNotices.all() as {
      id: number;
      kind: string;
      title: string;
      body: string;
      ticket_id: string | null;
      at: string;
      read: number;
    }[]).map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      body: row.body,
      ticketId: row.ticket_id,
      at: row.at,
      read: row.read === 1,
    }));
  }

  markNoticesRead(ids?: number[]) {
    if (!ids) this.stmts.readAllNotices.run();
    else for (const id of ids) this.stmts.readNotices.run(id);
  }

  clearNotices() {
    this.stmts.clearNotices.run();
  }
}

export const store = new Store();

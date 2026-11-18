import { EventEmitter } from "node:events";
import { net, powerMonitor } from "electron";
import type { SyncStatus } from "../../shared/contract";
import { store } from "../db/store";
import { getAccount, getSettings, settingsEvents } from "../settings";
import { raise } from "../notify";
import { words } from "../i18n";
import { logger } from "../log";
import { asFailure, ensureSession, sessionEmail, supabase, SyncFailure } from "./client";
import { learnOrigins, pullAllTickets, pullChanges, pullRefs, type PullOutcome } from "./pull";
import { pushAll } from "./push";

const log = logger("sync");

/**
 * The sync loop. One pass is: be signed in, send everything waiting, bring
 * down everything changed, and refresh the reference data when it is due.
 *
 * ---------------------------------------------------------------------------
 * When it runs
 * ---------------------------------------------------------------------------
 * - every `syncIntervalSec` while online (15 seconds by default);
 * - a quarter of a second after any change made here, so a change made with
 *   the line up is on the dashboard before anybody could walk over to look;
 * - the moment the window reports it is back online, the computer wakes up, or
 *   somebody presses "sync now";
 * - while offline, on a widening wait (5s → 60s), so the first moment the line
 *   is back is never more than a minute away.
 *
 * Passes never overlap: a request for one while another is running queues
 * exactly one more pass after it.
 *
 * ---------------------------------------------------------------------------
 * Nothing in here blocks the window
 * ---------------------------------------------------------------------------
 * The window always draws from the local database. A pass that brings new
 * rows bumps the store's version and the window re-reads; a pass that fails
 * changes the status pill and nothing else.
 */
const REFS_EVERY = 5 * 60_000;
const FULL_EVERY = 15 * 60_000;
const OFFLINE_WAIT = [5, 10, 20, 40, 60].map((s) => s * 1000);

class SyncEngine extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private again = false;
  private offlineStreak = 0;
  private authBlockedUntil = 0;
  private started = false;

  status: SyncStatus = {
    state: "starting",
    online: true,
    signedIn: false,
    account: null,
    lastPullAt: null,
    lastPushAt: null,
    pending: 0,
    failed: 0,
    lastError: null,
    hasData: false,
    ticketCount: 0,
    nextRunAt: null,
  };

  start() {
    if (this.started) return;
    this.started = true;
    this.status.lastPullAt = store.meta("lastPullAt");
    this.status.lastPushAt = store.meta("lastPushAt");
    this.refreshCounts();
    powerMonitor.on("resume", () => this.kick(1000));
    powerMonitor.on("unlock-screen", () => this.kick(500));
    settingsEvents.on("change", () => this.kick(0));
    this.kick(0);
  }

  /** Asks for a pass soon. Several asks in a row become one pass. */
  kick(delay = 250) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), delay);
    this.status.nextRunAt = Date.now() + delay;
  }

  /** A pass now, answered when it is finished. */
  async now(): Promise<SyncStatus> {
    this.authBlockedUntil = 0;
    if (this.timer) clearTimeout(this.timer);
    await this.run();
    return this.status;
  }

  /** The account was changed in settings: forget who we were and start again. */
  accountChanged() {
    this.authBlockedUntil = 0;
    this.status.signedIn = false;
    this.status.account = null;
    this.kick(0);
  }

  private set(change: Partial<SyncStatus>) {
    this.status = { ...this.status, ...change };
    this.emit("status", this.status);
  }

  refreshCounts() {
    this.set({
      pending: store.ops.filter((op) => op.state === "pending").length,
      failed: store.ops.filter((op) => op.state === "failed").length,
      hasData: store.meta("lastFullPull") !== null || store.tickets.size > 0,
      ticketCount: [...store.tickets.values()].filter((record) => !record.deleted).length,
    });
  }

  private async run() {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    this.timer = null;
    let nextDelay = getSettings().syncIntervalSec * 1000;
    const wasOffline = this.status.state === "offline";
    try {
      if (!net.isOnline()) throw new SyncFailure("network", "no network");
      if (Date.now() < this.authBlockedUntil) {
        nextDelay = Math.max(1000, this.authBlockedUntil - Date.now());
        return;
      }
      this.set({ state: "syncing" });
      await this.pass();
      this.offlineStreak = 0;
      this.set({ state: "idle", online: true, lastError: null });
      if (wasOffline) {
        const pending = store.ops.filter((op) => op.state === "pending").length;
        raise("online", words().onlineTitle, words().onlineBody(pending));
      }
    } catch (error) {
      const failure = asFailure(error, "sync");
      if (failure.kind === "auth") {
        // A wrong password is not fixed by asking again every few seconds.
        this.authBlockedUntil = Date.now() + 5 * 60_000;
        this.set({ state: "auth", signedIn: false, lastError: failure.message });
        log.error("signed out", failure.message);
        nextDelay = 5 * 60_000;
      } else if (failure.kind === "network" || failure.kind === "server") {
        nextDelay = OFFLINE_WAIT[Math.min(this.offlineStreak, OFFLINE_WAIT.length - 1)];
        this.offlineStreak += 1;
        if (!wasOffline && this.offlineStreak === 1) raise("offline", words().offlineTitle, words().offlineBody);
        this.set({ state: "offline", online: false, lastError: failure.message });
      } else {
        this.set({ state: "error", lastError: failure.message });
        log.error("pass failed", failure);
      }
    } finally {
      this.running = false;
      this.refreshCounts();
      if (this.again) {
        this.again = false;
        this.kick(0);
      } else {
        this.kick(nextDelay);
      }
    }
  }

  private async pass() {
    const client = supabase();
    const userId = await ensureSession();
    const email = await sessionEmail();
    if (!this.status.signedIn) {
      const viewer = store.ref<{ id: string }>("viewer");
      if (viewer && viewer.id !== userId) {
        // Another account than the one this database was filled for: its
        // tickets and cursors describe somebody else's view of the bench.
        log.warn("account changed — downloading the bench again");
        store.forgetServerCopy();
      }
    }

    const refsDue = !store.meta("lastRefs") || Date.now() - Date.parse(store.meta("lastRefs")!) > REFS_EVERY || !store.ref("viewer");
    if (refsDue) await pullRefs(client, userId, email);
    const viewer = store.ref<{ name: string; role: string }>("viewer");
    this.set({ signedIn: true, account: { email: email ?? getAccount().email, name: viewer?.name ?? "", role: viewer?.role ?? "" } });

    // Send first: a pull would only bring down what is about to change.
    const pushed = await pushAll(client, userId);
    if (pushed.sent) {
      store.setMeta("lastPushAt", new Date().toISOString());
      this.set({ lastPushAt: store.meta("lastPushAt") });
      store.bump();
    }
    for (const { op, reason } of pushed.failed) {
      const code = store.tickets.get(op.ticketId)?.raw.code ?? "";
      raise("sync_failed", words().failedTitle(code), words().failedBody(reason), op.ticketId);
    }
    if (pushed.failed.length) store.bump();
    if (pushed.blockedByNetwork) throw new SyncFailure("network", "upload interrupted");

    const fullDue = !store.meta("lastFullPull") || Date.now() - Date.parse(store.meta("lastFullPull")!) > FULL_EVERY;
    const outcome = fullDue ? await pullAllTickets(client) : await pullChanges(client);
    store.setMeta("lastPullAt", new Date().toISOString());
    this.set({ lastPullAt: store.meta("lastPullAt") });
    const learned = await learnOrigins(client);
    if (outcome.changed || refsDue || learned) store.bump();
    this.announce(outcome);
  }

  private announce(outcome: PullOutcome) {
    const service = getSettings().service;
    const onBench = (raw: { service?: string | null }) => (raw.service === "software" ? "software" : "hardware") === service;
    /*
     * A technician is told about his own tickets and nothing else (the shop,
     * 2026-11-18): a ticket handed to him, and a change to one he holds. A new
     * booking on the bench is the managers' to hand out, so it is not his news
     * until it is handed to him — the dashboard's alerts draw the same line.
     */
    const viewer = store.ref<{ id: string; role: string }>("viewer");
    if (viewer?.role === "technician") {
      const mine = (raw: { assigned_to?: string | null }) => raw.assigned_to === viewer.id;
      const handed = [...outcome.arrived, ...outcome.handed].filter((raw) => onBench(raw) && mine(raw));
      for (const raw of handed.slice(0, 5)) {
        raise("new_ticket", words().handedTitle(raw.code), words().newTicketBody(raw.device_model, raw.customer_name), store.idForServer(raw.id) ?? raw.id);
      }
      const told = new Set(handed.map((raw) => raw.id));
      for (const { after } of outcome.moved.filter(({ after }) => onBench(after) && mine(after) && !told.has(after.id)).slice(0, 5)) {
        raise("changed", words().movedTitle(after.code), words().movedBody(after.device_model), store.idForServer(after.id) ?? after.id);
      }
      return;
    }
    for (const raw of outcome.arrived.filter(onBench).slice(0, 5)) {
      raise("new_ticket", words().newTicketTitle(raw.code), words().newTicketBody(raw.device_model, raw.customer_name), store.idForServer(raw.id) ?? raw.id);
    }
    for (const { after } of outcome.moved.filter(({ after }) => onBench(after)).slice(0, 5)) {
      raise("changed", words().movedTitle(after.code), words().movedBody(after.device_model), store.idForServer(after.id) ?? after.id);
    }
  }
}

export const sync = new SyncEngine();

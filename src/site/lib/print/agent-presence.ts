import { useEffect } from "react";

import { usePathname } from "@/i18n/navigation";
/*
 * ⚠️ `@/lib/print/…`, never `./…`. The desk app replaces `agent-client` with
 * its own transport at that exact `@/` path (`src/renderer/overrides/`), and a
 * relative import resolves to the copied folder instead — where the module it
 * names was deliberately never copied. The failure is a build error there and
 * nothing at all here, so it is only ever found by the other repo.
 */
import { AGENT_START_MS, agentStatus, waitForAgent, wakeAgent } from "@/lib/print/agent-client";
import { logPrint } from "@/lib/print/print-log";

/**
 * Is the print agent up? The dashboard asks, and starts it if not.
 *
 * ---------------------------------------------------------------------------
 * Why this exists, and what it replaced
 * ---------------------------------------------------------------------------
 * The agent used to be kept alive by a scheduled task running `ensure.ps1`
 * **every three minutes** — a PowerShell process spawned twenty times an hour,
 * for ever, on a counter PC that is also running the till. The shop reported
 * it in those words: "the current cmd orders that could effect the performance
 * of the laptop or pc". They are right, and the arithmetic is worse than it
 * looks: a PowerShell start costs far more than the loopback probe it exists
 * to make, so nearly all of that work was the cost of asking rather than the
 * cost of the answer.
 *
 * The detection belongs **here**, in the one program that cares. A dashboard
 * that is not open needs no agent; one that is open can ask for itself, for
 * the price of a fetch to 127.0.0.1 that fails in a millisecond when nothing
 * is listening. The task keeps only its logon trigger — one start, at sign-in,
 * which costs nothing and means the agent is usually up before anybody asks.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ The probe is free and the *start* is not, so they are separated
 * ---------------------------------------------------------------------------
 * Starting the agent means handing Windows an `alesnad-print:` URL, and the
 * browser asks "Open Al-Esnad print agent?" until somebody ticks always-allow.
 * A page that fired that on load would put a dialog in front of a reader who
 * had merely opened a list — and Chrome suppresses a protocol launch made with
 * no user activation anyway, so it would often be a dialog *and* no agent.
 *
 * So: probe on mount, and if nothing answers, arm a **one-shot** listener and
 * start on the reader's first press anywhere in the dashboard. From the
 * counter that is indistinguishable from automatic — they click a row, and by
 * the time they reach «طباعة» the agent is listening — and it carries the user
 * activation the protocol wants.
 *
 * It is armed only on the desks that print (`SURFACES`). A sales admin who
 * never prints a ticket should never be asked about a program they do not use.
 */

/** The dashboard sections that print a paper. Locale already stripped. */
const SURFACES = ["/admin/repairs", "/admin/programming"];

/**
 * Long enough that re-entering the repairs board does not re-ask, short enough
 * that an agent somebody killed at lunchtime is found again in the afternoon.
 */
const RECHECK_MS = 5 * 60 * 1000;

/** Shared across mounts, so moving between the two desks is one conversation. */
let lastLook = 0;
let armed: (() => void) | null = null;

function disarm() {
  if (armed) {
    armed();
    armed = null;
  }
}

/**
 * Waits for the reader to touch something, then starts the agent.
 *
 * `pointerdown` and `keydown` both count as activation; `capture` so a handler
 * that stops propagation cannot hide the press from us, and `once`-like
 * teardown so this costs nothing after it has fired. It never calls
 * `preventDefault` — whatever the press was for still happens.
 */
function armFirstPress() {
  if (armed) return;
  const fire = () => {
    disarm();
    if (!wakeAgent()) return;
    void waitForAgent(AGENT_START_MS).then((up: boolean) => {
      logPrint({
        level: up ? "info" : "warn",
        message: up
          ? "the print agent was started before it was needed"
          : "the print agent did not answer after being started quietly",
      });
    });
  };
  const options = { capture: true } as const;
  window.addEventListener("pointerdown", fire, options);
  window.addEventListener("keydown", fire, options);
  armed = () => {
    window.removeEventListener("pointerdown", fire, options);
    window.removeEventListener("keydown", fire, options);
  };
}

async function look() {
  const now = Date.now();
  if (now - lastLook < RECHECK_MS) return;
  lastLook = now;
  try {
    await agentStatus(2500);
    // It is up. Anything armed from an earlier look is stale.
    disarm();
  } catch {
    // ⚠️ Every failure lands here on purpose — not running, blocked by the
    // browser, an unsupported one. Arming for the other two costs a protocol
    // launch that does nothing, which is cheaper than working out which is
    // which from a page that cannot see the PC.
    armFirstPress();
  }
}

/**
 * Mounted once, by `PrintStationHost`. Renders nothing and returns nothing: a
 * reader is never shown that this happened, because there is nothing for them
 * to do about it until they actually press print — and that path already
 * reports for itself.
 */
export function useAgentPresence() {
  const pathname = usePathname();
  /*
   * ⚠️ A plain value, not a ref. Writing a ref during render is an error here
   * (`react-hooks/refs`), and nothing is lost: the effect lists this in its
   * deps, so it is torn down and rebuilt whenever the reader moves between a
   * desk that prints and one that does not — which means the listener below
   * can never close over a stale answer.
   */
  const prints = SURFACES.some((surface) => pathname.startsWith(surface));

  useEffect(() => {
    if (!prints) return;
    void look();

    /*
     * A tab left open overnight is the case this catches: the PC slept, the
     * agent went with it, and the first thing anybody does in the morning is
     * come back to this tab. `visibilitychange` is throttled by `RECHECK_MS`
     * like every other look, so a reader flicking between tabs costs nothing.
     */
    const onVisible = () => {
      if (document.visibilityState === "visible") void look();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      disarm();
    };
  }, [prints]);
}

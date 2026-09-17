/**
 * The live-refresh state machine, with no I/O and no real clock in it.
 *
 * `server.ts` owns the HTTP, the watching and the timers. Everything that
 * decides *what to show* lives here, so `selftest.ts` can drive it with a fake
 * timer instead of racing real `fs.watch` events. Three rules are pinned down
 * here because they are the ones that are easy to get subtly wrong and hard to
 * notice:
 *
 *  - a burst of filesystem events causes one re-read, not one per event;
 *  - a read that fails keeps the last good aggregate and reports the error
 *    instead of blanking the page;
 *  - "no findings" never renders the same as "has not run", because on an audit
 *    dashboard that difference is the whole meaning of a zero.
 */

import type { AuditAggregate, GroupReport } from "./groups"

/** One read of the four files, in the shape the state machine consumes. */
export type ReadOutcome = { ok: true; aggregate: AuditAggregate } | { ok: false; errors: string[] }

export type LiveState = {
  /**
   * Bumped on every applied outcome so a client can tell a re-render from a
   * duplicate delivery, and so the "last read" line moves even when a refresh
   * finds the same bytes.
   */
  revision: number
  /** The most recent aggregate that parsed. Null until the first success. */
  aggregate: AuditAggregate | null
  /** When that aggregate was produced; its own `generatedAt`. */
  aggregateAt: string | null
  /** When the files were last read, success or failure. */
  readAt: string
  /** Problems from the most recent read. Empty means the last read parsed. */
  errors: string[]
}

export function initialLiveState(at: string): LiveState {
  return { revision: 0, aggregate: null, aggregateAt: null, readAt: at, errors: [] }
}

/**
 * Fold a read into the current state. On failure the previous aggregate is
 * carried over untouched — mid-write files are expected during a live audit,
 * and a dashboard that blanked every time an editor flushed a partial table
 * would be useless exactly when it is most wanted. `revision` and `readAt`
 * still move, so the viewer can see that a read happened and failed.
 */
export function applyOutcome(state: LiveState, outcome: ReadOutcome, at: string): LiveState {
  const base = { revision: state.revision + 1, readAt: at }
  if (!outcome.ok) {
    return {
      ...base,
      aggregate: state.aggregate,
      aggregateAt: state.aggregateAt,
      errors: outcome.errors,
    }
  }
  return {
    ...base,
    aggregate: outcome.aggregate,
    aggregateAt: outcome.aggregate.generatedAt,
    errors: [],
  }
}

// ---------------------------------------------------------------------------
// Coalescing
// ---------------------------------------------------------------------------

/** The bit of the timer API the coalescer needs, so a test can supply a fake. */
export type Timer = {
  set(fn: () => void, ms: number): unknown
  clear(handle: unknown): void
}

const systemTimer: Timer = {
  set: (fn, ms) => setTimeout(fn, ms),
  // The handle is `unknown` in the interface so a test can put an object in it;
  // the real timer is the only place that knows it is a Node timeout.
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export type Coalescer = {
  /** Register that something changed; safe and cheap to call in a burst. */
  schedule(): void
  /** Run the pending flush now, if there is one. */
  flush(): void
  /** Drop a pending flush without running it (used on shutdown). */
  cancel(): void
  pending(): boolean
}

/**
 * `fs.watch` fires several events for one logical save, and an editor that
 * writes by rename fires more. This collapses a burst into one callback.
 *
 * The timer is deliberately *not* restarted by later events: a writer that
 * keeps touching files for a second would otherwise postpone the refresh until
 * it went quiet, so a long audit run could leave the dashboard stale for as
 * long as it kept writing. The cost of not restarting is that a burst spanning
 * a window boundary can produce two flushes, which is harmless — a re-read of
 * four small files is cheap, a stale dashboard is not.
 */
export function createCoalescer(options: {
  delayMs: number
  onFlush: () => void
  timer?: Timer
}): Coalescer {
  const timer = options.timer ?? systemTimer
  let handle: unknown = null

  function fire(): void {
    handle = null
    options.onFlush()
  }

  return {
    schedule() {
      if (handle !== null) return
      handle = timer.set(fire, options.delayMs)
    },
    flush() {
      if (handle === null) return
      timer.clear(handle)
      fire()
    },
    cancel() {
      if (handle === null) return
      timer.clear(handle)
      handle = null
    },
    pending() {
      return handle !== null
    },
  }
}

// ---------------------------------------------------------------------------
// The honest zero
// ---------------------------------------------------------------------------

export type Coverage = {
  /** True when no finding has been filed anywhere. */
  empty: boolean
  /** True when every group reached status "reported". */
  complete: boolean
  headline: string
  notes: string[]
}

/**
 * Describe how much of the audit is actually in, in words the page can show
 * verbatim.
 *
 * This is computed server-side and shipped in the state payload rather than in
 * the client so that it is testable and so there is exactly one phrasing of the
 * "no findings is not a clean result" rule. Clients only lay it out.
 */
export function describeCoverage(aggregate: AuditAggregate): Coverage {
  const { totals, groups } = aggregate
  const empty = totals.findings === 0
  const complete = totals.groupsReported === totals.groups

  const idList = (status: GroupReport["status"]): string[] =>
    groups.filter((group) => group.status === status).map((group) => group.id)

  if (!empty) {
    const notes = [
      `${totals.groupsReported} of ${totals.groups} groups have reported; ${totals.agentsReported} of ${totals.agents} agents filed at least one finding.`,
    ]
    if (!complete) {
      notes.push(
        "Some groups have not reported, so these counts are partial — a higher total is still possible.",
      )
    }
    notes.push(
      "A finding is open until its `status` says otherwise; check the open count before reading the total as work outstanding.",
    )
    return {
      empty,
      complete,
      headline: `${totals.findings} finding(s) filed: ${totals.bySeverity.blocker} blocker(s), ${totals.bySeverity.major} major(s), ${totals.bySeverity.minor} minor(s).`,
      notes,
    }
  }

  const notStarted = idList("not-started")
  const running = idList("running")
  const failed = idList("failed")
  const reportedZero = idList("reported")
  const notes: string[] = []

  if (notStarted.length > 0) {
    notes.push(`Not started — no report at all: ${notStarted.join(", ")}.`)
  }
  if (running.length > 0) {
    notes.push(`Running but nothing filed yet: ${running.join(", ")}.`)
  }
  if (failed.length > 0) {
    notes.push(`Failed: ${failed.join(", ")}. A failed group has not produced a result.`)
  }
  if (reportedZero.length > 0) {
    notes.push(
      `Reported with zero findings: ${reportedZero.join(", ")}. Those groups ran and found nothing.`,
    )
  }
  notes.push(
    "Per-group `agentsReported` is coverage, not cleanliness: a group can reach `reported` with only some of its agents having filed, and those agents' surfaces were not looked at.",
  )

  return {
    empty,
    complete,
    headline: complete
      ? "0 findings filed, and every group has reported."
      : "0 findings filed — this is not a clean result.",
    notes,
  }
}

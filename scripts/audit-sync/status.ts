/**
 * The status contract, and the merge that keeps two systems agreeing.
 *
 * ## Why a snapshot, and not last-write-wins
 *
 * The support desk is the system of record, but the audit reports stay editable —
 * that combination means either side can change while the other is not looking. A
 * naive last-write-wins would clobber an edit made on the side that happened not to
 * run last, and it would do so silently, which is the worst property a sync can
 * have.
 *
 * So each run keeps a snapshot of what the two sides agreed on last time. That
 * turns "which one wins?" into a question with an actual answer:
 *
 *   neither changed        → nothing to do
 *   only markdown changed  → push the edit to the desk
 *   only the desk changed  → pull it into the report
 *   both changed, agreeing → nothing to do
 *   both changed, differing→ a genuine conflict, reported, never guessed
 *
 * A three-way merge costs one small state file and removes the entire class of
 * "the sync ate my edit" bugs.
 *
 * ## The status mapping
 *
 * The two vocabularies are different sizes, so the mapping is chosen to be total
 * and lossless in both directions:
 *
 *   finding `open`    ↔  ticket NEW | OPEN | PENDING
 *   finding `fixed`   ↔  ticket RESOLVED
 *   finding `wontfix` ↔  ticket CLOSED
 *
 * This is what gives `wontfix` a home in the desk rather than making it something
 * only the markdown can express. Three findings states, three ticket states, no
 * ambiguity in either direction.
 */

export type FindingStatus = "open" | "fixed" | "wontfix"
export type TicketStatus = "NEW" | "OPEN" | "PENDING" | "RESOLVED" | "CLOSED"

export const FINDING_STATUSES: FindingStatus[] = ["open", "fixed", "wontfix"]

/** Which ticket status each finding status means. */
export function findingToTicket(status: FindingStatus): TicketStatus {
  if (status === "fixed") return "RESOLVED"
  if (status === "wontfix") return "CLOSED"
  return "OPEN"
}

/**
 * Which finding status a ticket means.
 *
 * `PENDING` maps to `open` rather than to something in-between: the report's
 * vocabulary has no "waiting", and inventing one would mean the markdown could
 * hold a state the dashboard cannot count.
 */
export function ticketToFinding(status: TicketStatus): FindingStatus {
  if (status === "RESOLVED") return "fixed"
  if (status === "CLOSED") return "wontfix"
  return "open"
}

export type FindingRow = {
  id: string
  status: FindingStatus
  /** The canonical id this row is a duplicate of, when it is one. */
  dupOf: string | null
}

export type TicketRow = {
  externalRef: string
  id: string
  status: TicketStatus
  updatedAt: Date
}

export type Snapshot = Record<string, { md: FindingStatus; desk: FindingStatus }>

export type SyncAction =
  | { kind: "push"; findingId: string; ticketId: string; to: TicketStatus; reason: string }
  | { kind: "pull"; findingId: string; from: TicketStatus; to: FindingStatus; reason: string }
  | { kind: "converged"; findingId: string; status: FindingStatus; reason: string }
  | {
      kind: "conflict"
      findingId: string
      winner: "markdown" | "desk"
      md: FindingStatus
      desk: FindingStatus
      reason: string
    }
  | { kind: "noop"; findingId: string; reason: string }
  | { kind: "missing-ticket"; findingId: string; reason: string }

export type SyncPlan = {
  actions: SyncAction[]
  /** The snapshot to persist once the actions have been applied. */
  nextSnapshot: Snapshot
}

/**
 * Decides what to do for every finding, without touching the network or the disk.
 *
 * Kept pure so the merge rules can be tested directly. Every ambiguous case is
 * reported as a `conflict` rather than resolved by a guess, because a guess here
 * is indistinguishable from a correct merge until somebody loses work.
 */
export function planSync(input: {
  findings: FindingRow[]
  tickets: TicketRow[]
  snapshot: Snapshot
  /**
   * When the report files were last written.
   *
   * Coarse: it is a property of the *file*, so any edit anywhere in a group's
   * report makes every row in it look recently touched. That is why it is only
   * consulted to break a genuine conflict, after per-row comparison has already
   * established that both sides changed — it never decides a case that the
   * snapshot can answer precisely.
   */
  reportsUpdatedAt: Date
}): SyncPlan {
  const byRef = new Map(input.tickets.map((ticket) => [ticket.externalRef, ticket]))
  const actions: SyncAction[] = []
  const nextSnapshot: Snapshot = {}

  for (const finding of input.findings) {
    const ticket = byRef.get(finding.id)

    // A finding with no ticket is not an error — the report can lead the desk,
    // for example before an import has been run — so it is recorded and skipped.
    if (!ticket) {
      actions.push({
        kind: "missing-ticket",
        findingId: finding.id,
        reason: "no ticket carries this finding id; run the importer to file it.",
      })
      // Deliberately absent from the next snapshot: there is nothing agreed yet,
      // so the first sync after the ticket appears must be treated as a first
      // sighting rather than as "both sides changed".
      continue
    }

    const deskStatus = ticketToFinding(ticket.status)
    const previous = input.snapshot[finding.id]

    // First sighting: no prior agreement. Record it and change nothing. This is
    // what stops the very first run from treating every existing row as an edit.
    if (!previous) {
      actions.push({
        kind: "noop",
        findingId: finding.id,
        reason: "first sighting; recorded without change.",
      })
      nextSnapshot[finding.id] = { md: finding.status, desk: deskStatus }
      continue
    }

    const mdChanged = finding.status !== previous.md
    const deskChanged = deskStatus !== previous.desk

    if (!mdChanged && !deskChanged) {
      actions.push({ kind: "noop", findingId: finding.id, reason: "unchanged on both sides." })
      nextSnapshot[finding.id] = { md: finding.status, desk: deskStatus }
      continue
    }

    // Already agreeing, even though both moved. Nothing to reconcile.
    if (finding.status === deskStatus) {
      actions.push({
        kind: "converged",
        findingId: finding.id,
        status: finding.status,
        reason: "both sides changed to the same value.",
      })
      nextSnapshot[finding.id] = { md: finding.status, desk: deskStatus }
      continue
    }

    if (mdChanged && !deskChanged) {
      actions.push({
        kind: "push",
        findingId: finding.id,
        ticketId: ticket.id,
        to: findingToTicket(finding.status),
        reason: `the report set this to "${finding.status}"; the desk still said "${deskStatus}".`,
      })
      nextSnapshot[finding.id] = { md: finding.status, desk: finding.status }
      continue
    }

    if (!mdChanged && deskChanged) {
      actions.push({
        kind: "pull",
        findingId: finding.id,
        from: ticket.status,
        to: deskStatus,
        reason: `the desk set this to "${deskStatus}"; the report still said "${finding.status}".`,
      })
      nextSnapshot[finding.id] = { md: deskStatus, desk: deskStatus }
      continue
    }

    // Both changed, to different values. Break the tie by time and say so.
    const deskIsNewer = ticket.updatedAt.getTime() > input.reportsUpdatedAt.getTime()
    const winner = deskIsNewer ? "desk" : "markdown"
    const resolved = deskIsNewer ? deskStatus : finding.status

    actions.push({
      kind: "conflict",
      findingId: finding.id,
      winner,
      md: finding.status,
      desk: deskStatus,
      reason:
        `the report says "${finding.status}" and the desk says "${deskStatus}". ` +
        `Kept the ${winner === "desk" ? "desk's" : "report's"} value because it was changed more recently. ` +
        `Set the other side explicitly if that is wrong.`,
    })

    nextSnapshot[finding.id] = { md: resolved, desk: resolved }
  }

  return { actions, nextSnapshot: applyDuplicatePropagation(input.findings, nextSnapshot) }
}

/**
 * Duplicates must not be allowed to disagree with what they duplicate.
 *
 * Five findings are linked as duplicates of another — the same defect filed twice
 * by two audit groups. If the desk resolves `TN-1`, its duplicate `TN-31` describes
 * the same defect and would otherwise still read `open`, so the dashboard would
 * report one bug as simultaneously fixed and unfixed.
 *
 * Propagation runs last, on the *post-merge* snapshot, so it follows whatever was
 * just decided rather than re-litigating it. A duplicate keeps its own value only
 * when the canonical has no agreed status yet.
 */
function applyDuplicatePropagation(findings: FindingRow[], snapshot: Snapshot): Snapshot {
  const canonical = new Map(findings.filter((row) => !row.dupOf).map((row) => [row.id, row]))

  for (const finding of findings) {
    if (!finding.dupOf) continue

    const parent = snapshot[finding.dupOf]
    const self = snapshot[finding.id]

    // If the canonical has no agreed state, or this row has none, there is nothing
    // to inherit from.
    if (!parent || !self) continue
    if (parent.md === self.md) continue

    canonical.set(finding.id, finding)
    snapshot[finding.id] = { md: parent.md, desk: parent.md }
  }

  return snapshot
}

/** Summarises a plan for a human, so a dry run is readable without reading JSON. */
export function summarisePlan(plan: SyncPlan): Record<SyncAction["kind"], number> {
  const counts: Record<string, number> = {
    push: 0,
    pull: 0,
    converged: 0,
    conflict: 0,
    noop: 0,
    "missing-ticket": 0,
  }
  for (const action of plan.actions) counts[action.kind] += 1
  return counts as Record<SyncAction["kind"], number>
}

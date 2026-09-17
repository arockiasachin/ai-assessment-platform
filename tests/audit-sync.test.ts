import { describe, expect, it } from "vitest"

import {
  findingToTicket,
  planSync,
  ticketToFinding,
  type FindingRow,
  type Snapshot,
  type TicketRow,
} from "../scripts/audit-sync/status"

/**
 * The merge is the part of the sync where a bug is silent: a wrong decision here
 * does not throw, it just loses somebody's edit. So every branch is pinned.
 *
 * These are pure — no database, no network — because the whole point of extracting
 * `planSync` was to make these rules testable without either.
 */

const REPORTS_MTIME = new Date("2026-01-01T12:00:00Z")

function finding(
  id: string,
  status: FindingRow["status"],
  dupOf: string | null = null,
): FindingRow {
  return { id, status, dupOf }
}

function ticket(
  externalRef: string,
  status: TicketRow["status"],
  updatedAt = new Date("2025-12-01"),
): TicketRow {
  return { externalRef, id: `ticket-${externalRef}`, status, updatedAt }
}

function plan(findings: FindingRow[], tickets: TicketRow[], snapshot: Snapshot) {
  return planSync({ findings, tickets, snapshot, reportsUpdatedAt: REPORTS_MTIME })
}

const actionFor = (result: ReturnType<typeof plan>, id: string) =>
  result.actions.find((entry) => "findingId" in entry && entry.findingId === id)

describe("status vocabulary mapping", () => {
  it("is total in both directions", () => {
    expect(findingToTicket("open")).toBe("OPEN")
    expect(findingToTicket("fixed")).toBe("RESOLVED")
    expect(findingToTicket("wontfix")).toBe("CLOSED")

    expect(ticketToFinding("NEW")).toBe("open")
    expect(ticketToFinding("OPEN")).toBe("open")
    expect(ticketToFinding("PENDING")).toBe("open")
    expect(ticketToFinding("RESOLVED")).toBe("fixed")
    expect(ticketToFinding("CLOSED")).toBe("wontfix")
  })

  it("round-trips every finding status through its ticket status", () => {
    for (const status of ["open", "fixed", "wontfix"] as const) {
      expect(ticketToFinding(findingToTicket(status))).toBe(status)
    }
  })
})

describe("first sighting", () => {
  it("changes nothing, even when the two sides already disagree", () => {
    // The important case: a fresh clone has no snapshot, and must not treat every
    // pre-existing row as an edit and start rewriting.
    const result = plan([finding("TN-1", "fixed")], [ticket("TN-1", "NEW")], {})

    expect(actionFor(result, "TN-1")?.kind).toBe("noop")
    // The disagreement is recorded as the baseline, not resolved.
    expect(result.nextSnapshot["TN-1"]).toEqual({ md: "fixed", desk: "open" })
  })
})

describe("one side changed", () => {
  it("pushes a report edit to the desk", () => {
    const result = plan([finding("TN-1", "fixed")], [ticket("TN-1", "NEW")], {
      "TN-1": { md: "open", desk: "open" },
    })

    const action = actionFor(result, "TN-1")
    expect(action?.kind).toBe("push")
    if (action?.kind === "push") {
      expect(action.to).toBe("RESOLVED")
      expect(action.ticketId).toBe("ticket-TN-1")
    }
    expect(result.nextSnapshot["TN-1"]).toEqual({ md: "fixed", desk: "fixed" })
  })

  it("pulls a desk change into the report", () => {
    const result = plan([finding("TN-1", "open")], [ticket("TN-1", "RESOLVED")], {
      "TN-1": { md: "open", desk: "open" },
    })

    const action = actionFor(result, "TN-1")
    expect(action?.kind).toBe("pull")
    if (action?.kind === "pull") expect(action.to).toBe("fixed")
    expect(result.nextSnapshot["TN-1"]).toEqual({ md: "fixed", desk: "fixed" })
  })

  it("carries a wontfix from the report to the desk as CLOSED", () => {
    const result = plan([finding("TN-1", "wontfix")], [ticket("TN-1", "OPEN")], {
      "TN-1": { md: "open", desk: "open" },
    })

    const action = actionFor(result, "TN-1")
    expect(action?.kind).toBe("push")
    if (action?.kind === "push") expect(action.to).toBe("CLOSED")
  })
})

describe("no change, or change that already agrees", () => {
  it("does nothing when neither side moved", () => {
    const result = plan([finding("TN-1", "open")], [ticket("TN-1", "PENDING")], {
      "TN-1": { md: "open", desk: "open" },
    })

    expect(actionFor(result, "TN-1")?.kind).toBe("noop")
  })

  it("does nothing when both sides moved to the same value", () => {
    const result = plan([finding("TN-1", "fixed")], [ticket("TN-1", "RESOLVED")], {
      "TN-1": { md: "open", desk: "open" },
    })

    expect(actionFor(result, "TN-1")?.kind).toBe("converged")
  })
})

describe("both sides changed differently", () => {
  it("reports a conflict rather than guessing, and prefers the newer side", () => {
    const deskUpdatedAt = new Date("2026-06-01T00:00:00Z") // newer than the reports
    const result = plan([finding("TN-1", "wontfix")], [ticket("TN-1", "RESOLVED", deskUpdatedAt)], {
      "TN-1": { md: "open", desk: "open" },
    })

    const action = actionFor(result, "TN-1")
    expect(action?.kind).toBe("conflict")
    if (action?.kind === "conflict") {
      expect(action.winner).toBe("desk")
      expect(action.md).toBe("wontfix")
      expect(action.desk).toBe("fixed")
      // The reason must name both values, so a human can judge the resolution.
      expect(action.reason).toContain("wontfix")
      expect(action.reason).toContain("fixed")
    }
    expect(result.nextSnapshot["TN-1"]).toEqual({ md: "fixed", desk: "fixed" })
  })

  it("prefers the report when it is the newer of the two", () => {
    const deskUpdatedAt = new Date("2025-01-01T00:00:00Z") // older than the reports
    const result = plan([finding("TN-1", "wontfix")], [ticket("TN-1", "RESOLVED", deskUpdatedAt)], {
      "TN-1": { md: "open", desk: "open" },
    })

    const action = actionFor(result, "TN-1")
    if (action?.kind === "conflict") expect(action.winner).toBe("markdown")
    expect(result.nextSnapshot["TN-1"]).toEqual({ md: "wontfix", desk: "wontfix" })
  })
})

describe("duplicates follow the finding they duplicate", () => {
  it("propagates a resolution to the duplicate", () => {
    // TN-31 duplicates TN-1 — the same defect filed by two audit groups. If the
    // desk resolves TN-1, leaving TN-31 open would report one bug as both fixed
    // and unfixed.
    const result = plan(
      [finding("TN-1", "open"), finding("TN-31", "open", "TN-1")],
      [ticket("TN-1", "RESOLVED"), ticket("TN-31", "NEW")],
      {
        "TN-1": { md: "open", desk: "open" },
        "TN-31": { md: "open", desk: "open" },
      },
    )

    expect(actionFor(result, "TN-1")?.kind).toBe("pull")
    // The duplicate inherits, without needing an action of its own on the desk.
    expect(result.nextSnapshot["TN-31"]?.md).toBe("fixed")
    expect(result.nextSnapshot["TN-1"]?.md).toBe("fixed")
  })

  it("does not propagate when the canonical has no agreed state yet", () => {
    const result = plan(
      [finding("TN-1", "open"), finding("TN-31", "open", "TN-1")],
      [ticket("TN-1", "OPEN"), ticket("TN-31", "OPEN")],
      {},
    )

    // First sighting for both: the baseline is recorded, nothing is rewritten.
    expect(result.nextSnapshot["TN-31"]).toEqual({ md: "open", desk: "open" })
  })
})

describe("rows without a counterpart", () => {
  it("records a finding that has no ticket, and does not snapshot it", () => {
    const result = plan([finding("TN-99", "open")], [], {})

    const action = actionFor(result, "TN-99")
    expect(action?.kind).toBe("missing-ticket")
    // Absent from the snapshot on purpose: the first sync after the ticket appears
    // must be a first sighting, not "both sides changed".
    expect(result.nextSnapshot["TN-99"]).toBeUndefined()
  })
})

import { describe, expect, it } from "vitest"

import { runTimestamp } from "@/lib/code-eval/serialize"

/**
 * The "Last run" timestamp.
 *
 * The Task tab read the row's `createdAt` while the Runs tab read `finishedAt`,
 * so a backdated run (the courses seed writes one that finished two weeks ago)
 * reported a last run that finished before it was created (SN-40). The run's own
 * timestamps come first; `createdAt` is only the fallback.
 */

const createdAt = new Date("2026-09-17T10:00:00.000Z")
const startedAt = new Date("2026-09-03T10:59:58.000Z")
const finishedAt = new Date("2026-09-03T11:00:00.000Z")

describe("runTimestamp", () => {
  it("prefers the finish time, matching the Runs tab", () => {
    expect(runTimestamp({ finishedAt, startedAt, createdAt })).toBe(finishedAt)
  })

  it("falls back to the start time while a run is in flight", () => {
    expect(runTimestamp({ finishedAt: null, startedAt, createdAt })).toBe(startedAt)
  })

  it("falls back to the row's creation time only for a queued run", () => {
    expect(runTimestamp({ finishedAt: null, startedAt: null, createdAt })).toBe(createdAt)
  })

  it("does not report a last run that finishes before it was created", () => {
    // The reproduction: the row was inserted at the seed's clock but the run
    // finished two weeks earlier.
    expect(runTimestamp({ finishedAt, startedAt, createdAt }).getTime()).toBeLessThan(
      createdAt.getTime(),
    )
  })
})

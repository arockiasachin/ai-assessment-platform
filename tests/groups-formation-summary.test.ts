import { describe, expect, it } from "vitest"

import { formationOutcome } from "@/lib/groups/formation-summary"

/**
 * TN-56: the panel announced "worst-team score 1.000" when none of the default
 * criteria were active, because no roster carried the attributes they read. The
 * score was real; the meaning was invented.
 */
describe("formationOutcome", () => {
  it("reports the objective only when at least one criterion applied", () => {
    const outcome = formationOutcome(
      [
        { label: "GPA balance", active: true },
        { label: "Major mix", active: false },
      ],
      0.72,
    )

    expect(outcome.scored).toBe(true)
    expect(outcome.headline).toBe("Worst-team score 0.720")
    expect(outcome.inactiveCriteria).toEqual(["Major mix"])
  })

  it("refuses to present a score when no criterion applied", () => {
    const outcome = formationOutcome(
      [
        { label: "GPA balance", active: false },
        { label: "Major mix", active: false },
      ],
      1,
    )

    expect(outcome.scored).toBe(false)
    expect(outcome.headline).not.toContain("1.000")
    expect(outcome.headline).toMatch(/split by size alone/)
    expect(outcome.inactiveCriteria).toEqual(["GPA balance", "Major mix"])
  })

  it("names the size-only case when no criteria were supplied at all", () => {
    const outcome = formationOutcome([], 1)

    expect(outcome.scored).toBe(false)
    expect(outcome.headline).toMatch(/No criteria were supplied/)
  })
})

import { describe, expect, it } from "vitest"

import {
  retakeCountPhrase,
  retakeOptionLabel,
  retakeQuestionCountClause,
} from "@/lib/student-retake-view"

/**
 * Adaptive-retake view logic.
 *
 * A perfect score rendered `(0 to retry)` in the dropdown while the card below it
 * said "Nothing to retry" (SN-45). The two surfaces now share one phrase.
 */

describe("retakeCountPhrase", () => {
  it("says 'nothing to retry' instead of '0 to retry'", () => {
    expect(retakeCountPhrase(0)).toBe("nothing to retry")
  })

  it("counts everything else plainly", () => {
    expect(retakeCountPhrase(1)).toBe("1 to retry")
    expect(retakeCountPhrase(3)).toBe("3 to retry")
  })
})

describe("retakeOptionLabel", () => {
  it("uses the same phrase for zero as the card", () => {
    expect(retakeOptionLabel({ courseCode: "DEMO-MATH-101", title: "Check-in", toRetry: 0 })).toBe(
      "DEMO-MATH-101 · Check-in (nothing to retry)",
    )
  })

  it("carries the count when there is work to retry", () => {
    expect(retakeOptionLabel({ courseCode: "DEMO-MATH-101", title: "Check-in", toRetry: 3 })).toBe(
      "DEMO-MATH-101 · Check-in (3 to retry)",
    )
  })
})

describe("retakeQuestionCountClause", () => {
  it("omits the count at zero so it cannot clash with 'Nothing to retry'", () => {
    expect(retakeQuestionCountClause(0)).toBe("")
  })

  it("pluralizes one and many", () => {
    expect(retakeQuestionCountClause(1)).toBe(" — 1 question to retry")
    expect(retakeQuestionCountClause(3)).toBe(" — 3 questions to retry")
  })
})

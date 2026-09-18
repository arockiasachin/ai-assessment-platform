import { describe, expect, it } from "vitest"

import { arrearFor, type ArrearReason } from "@/lib/arrears"
import type { CourseOutcome } from "@/lib/grading/policy"

/**
 * The arrear rule, exhaustively.
 *
 * Pure by construction, so every branch is exercised at a fixed input without a
 * database or a clock. The cases are named after the *fact* they represent, not the
 * branch, because the point of the rule is which real situation each verdict maps to.
 */

const pass: CourseOutcome = { status: "pass", grandTotal: 74 }
const failBelowPass: CourseOutcome = {
  status: "fail",
  grandTotal: 36,
  reason: "below-pass-mark",
}
const failFatIneligible: CourseOutcome = {
  status: "fail",
  reason: "fat-ineligible",
  catPercent: 12,
  minimum: 30,
}
const notJudged: CourseOutcome = { status: "not-judged", reason: "no-grand-total" }

function arrear(
  outcome: CourseOutcome,
  input: { identified: boolean; published: boolean; ended: boolean },
): ArrearReason | null {
  return arrearFor({
    outcome,
    finalAssessmentIdentified: input.identified,
    finalAssessmentPublished: input.published,
    offeringEnded: input.ended,
  })
}

describe("arrearFor", () => {
  it("is a failure when the FAT is published and the course failed on the pass mark", () => {
    expect(arrear(failBelowPass, { identified: true, published: true, ended: true })).toBe("failed")
    // The offering need not have ended: a published failing FAT is an arrear at once.
    expect(arrear(failBelowPass, { identified: true, published: true, ended: false })).toBe(
      "failed",
    )
  })

  it("is a failure when the FAT is published and the CAT gate failed the course", () => {
    expect(arrear(failFatIneligible, { identified: true, published: true, ended: true })).toBe(
      "failed",
    )
  })

  it("is not an arrear when the published FAT passed", () => {
    expect(arrear(pass, { identified: true, published: true, ended: true })).toBeNull()
    expect(arrear(pass, { identified: true, published: true, ended: false })).toBeNull()
  })

  it("does not read an unjudgeable course as a failure", () => {
    // "We cannot judge" is not "the student failed": a published mark the platform
    // cannot turn into a verdict is not an arrear.
    expect(arrear(notJudged, { identified: true, published: true, ended: true })).toBeNull()
    // Without a published FAT, though, the absence rule still applies once ended —
    // the course is unjudgeable *because* the FAT is missing.
    expect(arrear(notJudged, { identified: true, published: false, ended: true })).toBe(
      "did-not-appear",
    )
  })

  it("is an absence when the course has ended with no published FAT mark", () => {
    expect(arrear(notJudged, { identified: true, published: false, ended: true })).toBe(
      "did-not-appear",
    )
    // Even a gate-failed verdict is reported as an absence: the FAT itself is missing.
    expect(arrear(failFatIneligible, { identified: true, published: false, ended: true })).toBe(
      "did-not-appear",
    )
  })

  it("is not an arrear while the course is still running, however the CAT stands", () => {
    // The mid-term student has simply not been given the FAT yet. Marking them in
    // arrears here is exactly what the ended-offering requirement prevents.
    expect(arrear(notJudged, { identified: true, published: false, ended: false })).toBeNull()
    expect(
      arrear(failFatIneligible, { identified: true, published: false, ended: false }),
    ).toBeNull()
    expect(arrear(pass, { identified: true, published: false, ended: false })).toBeNull()
  })

  it("is not an arrear when no final assessment was identified at all", () => {
    // A course with fewer than two assessments has no CAT/FAT split, so there is no
    // FAT for anyone to have missed — even once ended.
    expect(arrear(notJudged, { identified: false, published: false, ended: true })).toBeNull()
    expect(arrear(pass, { identified: false, published: false, ended: true })).toBeNull()
  })

  it("prefers `failed` over `did-not-appear` when both facts are true", () => {
    // A published, failing FAT on an ended offering satisfies both conditions; the
    // published failure is the more specific fact and wins.
    expect(arrear(failBelowPass, { identified: true, published: true, ended: true })).toBe("failed")
  })
})

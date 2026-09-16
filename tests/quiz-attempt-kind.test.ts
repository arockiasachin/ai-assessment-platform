import { describe, expect, it } from "vitest"

import {
  countedAttemptWhere,
  COUNTED_STATUSES,
  FINALIZED_STATUSES,
  finalizedAttemptWhere,
  GRADED,
  inProgressAttemptWhere,
  isCounted,
  isFinalized,
  isGraded,
  PRACTICE,
} from "@/lib/quiz-attempts/kinds"

/**
 * The kind rule, as pure functions.
 *
 * This is the module that replaced two hand-maintained constant pairs declared in two files
 * with eleven read sites between them. The tests pin the three answers it exists to give, and
 * the one property that made the old shape dangerous: a row with **no** `kind` predates the
 * column and must be treated as graded, or every existing attempt would silently stop counting.
 */

describe("isCounted", () => {
  it("counts a graded sitting in a counted status", () => {
    expect(isCounted({ status: "SUBMITTED", kind: GRADED })).toBe(true)
    expect(isCounted({ status: "IN_PROGRESS", kind: GRADED })).toBe(true)
  })

  it("does NOT count a practice sitting, whatever its status", () => {
    // The property the whole column exists for: practising must not consume a graded slot.
    for (const status of COUNTED_STATUSES) {
      expect(isCounted({ status, kind: PRACTICE }), status).toBe(false)
    }
  })

  it("treats a row with no kind as graded", () => {
    // Every row that predates the column. If this were false, adding the column would have
    // silently un-counted every existing attempt and handed students extra sittings.
    expect(isCounted({ status: "SUBMITTED" })).toBe(true)
    expect(isCounted({ status: "SUBMITTED", kind: null })).toBe(true)
  })

  it("does not count a status outside the counted list", () => {
    expect(isCounted({ status: "ABANDONED", kind: GRADED })).toBe(false)
  })
})

describe("isFinalized", () => {
  it("finalises a graded SUBMITTED or GRADED sitting", () => {
    expect(isFinalized({ status: "SUBMITTED", kind: GRADED })).toBe(true)
    expect(isFinalized({ status: "GRADED", kind: GRADED })).toBe(true)
  })

  it("does NOT finalise a practice sitting", () => {
    // A practice sitting that reached SUBMITTED would otherwise move the cohort average, the
    // pass rate and the item analysis — the numbers a teacher acts on.
    for (const status of FINALIZED_STATUSES) {
      expect(isFinalized({ status, kind: PRACTICE }), status).toBe(false)
    }
  })

  it("excludes IN_PROGRESS and EXPIRED", () => {
    expect(isFinalized({ status: "IN_PROGRESS", kind: GRADED })).toBe(false)
    expect(isFinalized({ status: "EXPIRED", kind: GRADED })).toBe(false)
  })

  it("treats a row with no kind as graded", () => {
    expect(isFinalized({ status: "SUBMITTED" })).toBe(true)
  })
})

describe("isGraded", () => {
  it("is true for GRADED and for a missing kind", () => {
    expect(isGraded({ kind: GRADED })).toBe(true)
    expect(isGraded({})).toBe(true)
    expect(isGraded({ kind: null })).toBe(true)
  })

  it("is false only for an explicit PRACTICE", () => {
    expect(isGraded({ kind: PRACTICE })).toBe(false)
  })
})

describe("the where-builders", () => {
  it("countedAttemptWhere scopes to graded and to the counted statuses", () => {
    expect(countedAttemptWhere("a1", "s1")).toEqual({
      assessmentId: "a1",
      studentId: "s1",
      kind: GRADED,
      status: { in: [...COUNTED_STATUSES] },
    })
  })

  it("finalizedAttemptWhere scopes to graded and to the finalized statuses", () => {
    expect(finalizedAttemptWhere("a1", "s1")).toEqual({
      assessmentId: "a1",
      studentId: "s1",
      kind: GRADED,
      status: { in: [...FINALIZED_STATUSES] },
    })
  })

  it("inProgressAttemptWhere is kind-scoped, so a graded start cannot resume practice", () => {
    // Without the kind here, starting a graded sitting would resume an in-progress *practice*
    // one, and the graded attempt would silently be the practice answers.
    expect(inProgressAttemptWhere("a1", "s1")).toEqual({
      assessmentId: "a1",
      studentId: "s1",
      kind: GRADED,
      status: "IN_PROGRESS",
    })
    expect(inProgressAttemptWhere("a1", "s1", PRACTICE).kind).toBe(PRACTICE)
  })

  it("accepts an explicit kind for a caller that genuinely wants practice counts", () => {
    expect(countedAttemptWhere("a1", "s1", PRACTICE).kind).toBe(PRACTICE)
  })
})

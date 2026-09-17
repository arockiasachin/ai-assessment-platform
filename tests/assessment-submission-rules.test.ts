import { describe, expect, it } from "vitest"

import {
  saveDraftAllowed,
  submissionLockReason,
  submissionSubmitAction,
  supportsTextSubmission,
  TEXT_SUBMISSION_KINDS,
} from "@/lib/assessment-submission-rules"

/**
 * The written-submission rules that both the student assessments view and the submission route
 * read. These were the two defects the audit filed at the same component:
 *
 * - `SN-7` / `TN-46`: the view rendered a text editor for `CODE` and `GROUP_PROJECT`, which the
 *   route can only answer with `409`.
 * - `SN-6`: **Save draft** was enabled for a `SUBMITTED`/`LATE` assessment, which the route
 *   refuses, and a graded read-only box carried no explanation.
 */

describe("supportsTextSubmission", () => {
  it("accepts exactly the two prose kinds the submission route records", () => {
    expect(TEXT_SUBMISSION_KINDS).toEqual(["ASSIGNMENT", "DESCRIPTIVE"])
    expect(supportsTextSubmission("ASSIGNMENT")).toBe(true)
    expect(supportsTextSubmission("DESCRIPTIVE")).toBe(true)
  })

  it("refuses the kinds another pipeline owns", () => {
    // A quiz is sat through the attempt pipeline, a code task through the sandbox, and a group
    // project has no per-student text submission at all.
    expect(supportsTextSubmission("QUIZ")).toBe(false)
    expect(supportsTextSubmission("CODE")).toBe(false)
    expect(supportsTextSubmission("GROUP_PROJECT")).toBe(false)
  })
})

describe("saveDraftAllowed", () => {
  it("allows a draft only before anything has been handed in", () => {
    expect(saveDraftAllowed("not_submitted")).toBe(true)
    expect(saveDraftAllowed("draft")).toBe(true)
  })

  it("refuses once the work has been handed in, matching the route's 409", () => {
    expect(saveDraftAllowed("submitted")).toBe(false)
    expect(saveDraftAllowed("resubmitted")).toBe(false)
    expect(saveDraftAllowed("late")).toBe(false)
    expect(saveDraftAllowed("graded")).toBe(false)
  })
})

describe("submissionSubmitAction", () => {
  it("submits a fresh or drafted piece and resubmits a handed-in one", () => {
    expect(submissionSubmitAction("not_submitted")).toBe("submit")
    expect(submissionSubmitAction("draft")).toBe("submit")
    expect(submissionSubmitAction("submitted")).toBe("resubmit")
    expect(submissionSubmitAction("resubmitted")).toBe("resubmit")
    expect(submissionSubmitAction("late")).toBe("resubmit")
  })

  it("offers no action for a graded submission", () => {
    expect(submissionSubmitAction("graded")).toBeNull()
  })
})

describe("submissionLockReason", () => {
  it("explains graded immutability in the student's words", () => {
    expect(submissionLockReason("graded")).toMatch(/graded and can no longer be changed/)
  })

  it("explains why Save draft is unavailable after hand-in", () => {
    expect(submissionLockReason("submitted")).toMatch(/can no longer be saved as a draft/)
    expect(submissionLockReason("late")).toMatch(/can no longer be saved as a draft/)
  })

  it("says nothing for a piece that can still be drafted", () => {
    expect(submissionLockReason("not_submitted")).toBeNull()
    expect(submissionLockReason("draft")).toBeNull()
  })
})

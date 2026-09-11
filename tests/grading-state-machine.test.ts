import { describe, expect, it } from "vitest"

import {
  IllegalGradeReviewTransitionError,
  canTransition,
  isPublishingAction,
  publishesGrade,
  resolveTransition,
} from "@/lib/grading/state-machine"

describe("grade review state machine", () => {
  it("publishes only under human accept/override statuses", () => {
    expect(publishesGrade("AUTO_ACCEPTED")).toBe(true)
    expect(publishesGrade("OVERRIDDEN")).toBe(true)
    expect(publishesGrade("PENDING")).toBe(false)
    expect(publishesGrade("NEEDS_REVIEW")).toBe(false)
    expect(publishesGrade("REJECTED")).toBe(false)

    expect(isPublishingAction("accept")).toBe(true)
    expect(isPublishingAction("override")).toBe(true)
    expect(isPublishingAction("flag")).toBe(false)
    expect(isPublishingAction("reject")).toBe(false)
    expect(isPublishingAction("reopen")).toBe(false)
  })

  it("resolves the legal transitions", () => {
    expect(resolveTransition("PENDING", "accept")).toBe("AUTO_ACCEPTED")
    expect(resolveTransition("PENDING", "override")).toBe("OVERRIDDEN")
    expect(resolveTransition("PENDING", "reject")).toBe("REJECTED")
    expect(resolveTransition("PENDING", "flag")).toBe("NEEDS_REVIEW")
    expect(resolveTransition("NEEDS_REVIEW", "accept")).toBe("AUTO_ACCEPTED")
    expect(resolveTransition("NEEDS_REVIEW", "override")).toBe("OVERRIDDEN")
    expect(resolveTransition("AUTO_ACCEPTED", "override")).toBe("OVERRIDDEN")
    expect(resolveTransition("OVERRIDDEN", "override")).toBe("OVERRIDDEN")
    expect(resolveTransition("REJECTED", "reopen")).toBe("PENDING")
  })

  it("refuses transitions that would bypass human control", () => {
    expect(() => resolveTransition("REJECTED", "accept")).toThrow(IllegalGradeReviewTransitionError)
    expect(() => resolveTransition("AUTO_ACCEPTED", "reject")).toThrow(
      IllegalGradeReviewTransitionError,
    )
    // You cannot "reopen" an already-pending review.
    expect(() => resolveTransition("PENDING", "reopen")).toThrow(IllegalGradeReviewTransitionError)

    expect(canTransition("PENDING", "PENDING")).toBe(false)
    expect(canTransition("REJECTED", "NEEDS_REVIEW")).toBe(false)
  })
})

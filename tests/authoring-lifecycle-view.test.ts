import { describe, expect, it } from "vitest"

import {
  AUTHORING_STAGE_STATUS,
  assessmentReleaseLifecycle,
  questionSetLifecycle,
  rubricLifecycle,
  testCaseSetLifecycle,
  type AuthoringLifecycleView,
} from "@/lib/authoring-lifecycle-view"

/**
 * TL-1: the four authoring surfaces each own their publish machinery, and the rule this
 * module exposes is the **stage mapping** — which native state reads as draft, live, partly
 * live, frozen or empty. The repo has no jsdom, so a rendered-DOM assertion is not available;
 * pinning the pure mapping is the strongest honest proof of the shared vocabulary.
 *
 * The failure this guards is the one the finding named: "an unfinished item is
 * indistinguishable from a published one". A stage that rounds drafts up to live is exactly
 * that bug, so every mapper has an explicit draft case, a mixed case and a live case.
 */

const views: AuthoringLifecycleView[] = [
  assessmentReleaseLifecycle({ released: false, releasedAt: null }),
  assessmentReleaseLifecycle({ released: true, releasedAt: "2026-09-15T08:00:00.000Z" }),
  questionSetLifecycle({ draftCount: 0, publishedCount: 0 }),
  questionSetLifecycle({ draftCount: 3, publishedCount: 0 }),
  questionSetLifecycle({ draftCount: 2, publishedCount: 1 }),
  questionSetLifecycle({ draftCount: 0, publishedCount: 3 }),
  testCaseSetLifecycle({ draftCount: 0, activeCount: 0 }),
  testCaseSetLifecycle({ draftCount: 2, activeCount: 0 }),
  testCaseSetLifecycle({ draftCount: 1, activeCount: 2 }),
  testCaseSetLifecycle({ draftCount: 0, activeCount: 2 }),
  rubricLifecycle({ hasRubric: false, locked: false }),
  rubricLifecycle({ hasRubric: true, locked: false }),
  rubricLifecycle({ hasRubric: true, locked: true }),
]

describe("authoring lifecycle vocabulary", () => {
  it("derives every view's pill tone from its stage, so tone cannot drift per surface", () => {
    for (const view of views) {
      expect(view.status).toBe(AUTHORING_STAGE_STATUS[view.stage])
      expect(view.detail.length).toBeGreaterThan(0)
      expect(view.label.length).toBeGreaterThan(0)
    }
  })

  it("gives every stage a distinct tone", () => {
    const stages = Object.keys(AUTHORING_STAGE_STATUS) as (keyof typeof AUTHORING_STAGE_STATUS)[]
    const tones = stages.map((stage) => AUTHORING_STAGE_STATUS[stage])
    expect(new Set(tones).size).toBe(stages.length)
  })

  it("labels 'nothing authored' identically on every surface", () => {
    const empties = [
      questionSetLifecycle({ draftCount: 0, publishedCount: 0 }),
      testCaseSetLifecycle({ draftCount: 0, activeCount: 0 }),
      rubricLifecycle({ hasRubric: false, locked: false }),
    ]
    for (const view of empties) {
      expect(view.stage).toBe("empty")
      expect(view.label).toBe("Not authored")
    }
  })
})

describe("assessmentReleaseLifecycle", () => {
  it("reads an unreleased assessment as a draft that is hidden from students", () => {
    expect(assessmentReleaseLifecycle({ released: false, releasedAt: null })).toMatchObject({
      stage: "draft",
      label: "Not released",
      detail: "Hidden from students",
    })
  })

  it("reads a released assessment as live and shows when students first saw it", () => {
    expect(
      assessmentReleaseLifecycle({ released: true, releasedAt: "2026-09-15T08:00:00.000Z" }),
    ).toMatchObject({
      stage: "live",
      label: "Released",
      detail: "Visible to students since 15 Sept 2026, 08:00",
    })
  })
})

describe("questionSetLifecycle", () => {
  it("does not round a set of only drafts up to published", () => {
    const view = questionSetLifecycle({ draftCount: 3, publishedCount: 0 })
    expect(view.stage).toBe("draft")
    expect(view.detail).toContain("none published")
    expect(view.detail).toContain("3 questions")
  })

  it("reports a mixed set as partly live rather than as one of the two states", () => {
    const view = questionSetLifecycle({ draftCount: 2, publishedCount: 1 })
    expect(view.stage).toBe("partly-live")
    expect(view.detail).toBe("1 of 3 published; 2 drafts still draft.")
  })

  it("reports an all-published set as live", () => {
    expect(questionSetLifecycle({ draftCount: 0, publishedCount: 3 })).toMatchObject({
      stage: "live",
      label: "Published",
    })
  })
})

describe("testCaseSetLifecycle", () => {
  it("does not round a set of only drafts up to active", () => {
    const view = testCaseSetLifecycle({ draftCount: 2, activeCount: 0 })
    expect(view.stage).toBe("draft")
    expect(view.detail).toContain("never run or shown")
  })

  it("reports a mixed set as partly live", () => {
    expect(testCaseSetLifecycle({ draftCount: 1, activeCount: 2 })).toMatchObject({
      stage: "partly-live",
      detail: "2 of 3 active; 1 draft still draft.",
    })
  })

  it("keeps the engine's own word for an active set", () => {
    expect(testCaseSetLifecycle({ draftCount: 0, activeCount: 2 }).label).toBe("Active")
  })
})

describe("rubricLifecycle", () => {
  it("states that a rubric has no publish step, only authored and frozen", () => {
    expect(rubricLifecycle({ hasRubric: true, locked: false })).toMatchObject({
      stage: "live",
      label: "Authored",
    })
  })

  it("surfaces the freeze, which the server already enforced with a 409", () => {
    expect(rubricLifecycle({ hasRubric: true, locked: true })).toMatchObject({
      stage: "frozen",
      label: "Frozen",
    })
  })

  it("never claims a rubric is frozen before one exists", () => {
    expect(rubricLifecycle({ hasRubric: false, locked: true }).stage).toBe("empty")
  })
})

import { describe, expect, it } from "vitest"

import { RELEASE_CONFIRMATION_BODY, assessmentReleaseView } from "@/lib/assessment-release-view"

/**
 * The rule the release control must not break (TN-1 / TN-31): release is one-way.
 *
 * `POST /api/teacher/assessments/[id]/release` stamps `releasedAt` and there is no route
 * that clears it, so the UI must offer the write exactly while it is still possible — and
 * must say, before the click, that the click cannot be undone. The failure this guards is
 * offering an action the API cannot honour.
 */
describe("assessmentReleaseView", () => {
  it("offers the control for an unreleased assessment", () => {
    expect(assessmentReleaseView({ released: false, releasedAt: null })).toEqual({
      status: "draft",
      label: "Not released",
      detail: "Hidden from students",
      canRelease: true,
    })
  })

  it("offers no control once released, because there is no unrelease path", () => {
    const view = assessmentReleaseView({
      released: true,
      releasedAt: "2026-09-15T08:00:00.000Z",
    })

    expect(view.status).toBe("published")
    expect(view.label).toBe("Released")
    expect(view.canRelease).toBe(false)
    // The instant is shown so the teacher can tell when students first saw it.
    expect(view.detail).toBe("Visible to students since 15 Sept 2026, 08:00")
  })

  it("still reports a released assessment that carries no recorded instant", () => {
    const view = assessmentReleaseView({ released: true, releasedAt: null })
    expect(view.canRelease).toBe(false)
    expect(view.detail).toBe("Visible to students")
  })

  it("states the irreversibility before the write, not after it", () => {
    expect(RELEASE_CONFIRMATION_BODY).toMatch(/cannot be undone/i)
    expect(RELEASE_CONFIRMATION_BODY).toMatch(/no unrelease/i)
  })
})

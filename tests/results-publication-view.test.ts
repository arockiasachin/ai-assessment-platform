import { describe, expect, it } from "vitest"

import {
  RESULTS_PUBLICATION_CONFIRMATION_BODY,
  resultsPublicationView,
} from "@/lib/results-publication-view"

/**
 * The retention-clock control's view state (TN-5, TN-68).
 *
 * Starting the clock is one-way and begins the 15-day retention window, so the rule
 * that matters is that the UI asks first and says so honestly. The component that
 * renders this has no test — there is no jsdom in this repo — so the copy is pinned
 * here. TN-68 added the audience boundary to that honesty requirement: the copy must
 * say the action does **not** release marks to students, because the old label
 * promised a publication the write never performed.
 */

describe("resultsPublicationView", () => {
  it("asks before the one-way write and names the consequence", () => {
    const view = resultsPublicationView({
      courseName: "Algebra Foundations",
      resultsPublishedAt: null,
    })

    expect(view.canStartClock).toBe(true)
    expect(view.confirmationTitle).toContain("Algebra Foundations")
    expect(view.confirmationBody).toContain("15-day retention clock")
    expect(view.confirmationBody).toContain("cannot be undone")
    expect(view.confirmationBody).toContain("no way to clear this date")
  })

  it("does not claim to publish marks, because it only stamps the retention anchor", () => {
    const view = resultsPublicationView({
      courseName: "Algebra Foundations",
      resultsPublishedAt: null,
    })

    expect(view.confirmationBody).toContain("does not release marks to students")
    expect(view.confirmationTitle.toLowerCase()).not.toContain("publish results")
  })

  it("offers no action once started, because there is no unpublish path", () => {
    const view = resultsPublicationView({
      courseName: "Algebra Foundations",
      resultsPublishedAt: "2026-09-17T10:00:00.000Z",
    })

    expect(view.published).toBe(true)
    expect(view.canStartClock).toBe(false)
    expect(view.clockStartedLabel).toBe("Retention clock started 2026-09-17")
  })

  it("keeps the confirmation body in exactly one place", () => {
    expect(RESULTS_PUBLICATION_CONFIRMATION_BODY).toBe(
      resultsPublicationView({ courseName: "x", resultsPublishedAt: null }).confirmationBody,
    )
  })
})

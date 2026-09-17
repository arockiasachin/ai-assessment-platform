import { describe, expect, it } from "vitest"

import {
  RESULTS_PUBLICATION_CONFIRMATION_BODY,
  resultsPublicationView,
} from "@/lib/results-publication-view"

/**
 * The publish-results control's view state (TN-5).
 *
 * Publishing is one-way and starts the 15-day retention clock, so the rule that matters is
 * that the UI asks first and says so honestly. The component that renders this has no test —
 * there is no jsdom in this repo — so the copy is pinned here.
 */

describe("resultsPublicationView", () => {
  it("asks before the one-way write and names the consequence", () => {
    const view = resultsPublicationView({
      courseName: "Algebra Foundations",
      resultsPublishedAt: null,
    })

    expect(view.canPublish).toBe(true)
    expect(view.confirmationTitle).toContain("Algebra Foundations")
    expect(view.confirmationBody).toContain("15-day retention clock")
    expect(view.confirmationBody).toContain("cannot be undone")
    expect(view.confirmationBody).toContain("no unpublish action")
  })

  it("offers no action once published, because there is no unpublish path", () => {
    const view = resultsPublicationView({
      courseName: "Algebra Foundations",
      resultsPublishedAt: "2026-09-17T10:00:00.000Z",
    })

    expect(view.published).toBe(true)
    expect(view.canPublish).toBe(false)
    expect(view.publishedLabel).toBe("Results published 2026-09-17")
  })

  it("keeps the confirmation body in exactly one place", () => {
    expect(RESULTS_PUBLICATION_CONFIRMATION_BODY).toBe(
      resultsPublicationView({ courseName: "x", resultsPublishedAt: null }).confirmationBody,
    )
  })
})

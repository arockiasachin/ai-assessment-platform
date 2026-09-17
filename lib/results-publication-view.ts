/**
 * Pure view state for the offering's retention-clock control (TN-5, TN-68).
 *
 * **What the control actually does, and why it is not called "Publish results" any more.**
 * `publishOfferingResults` stamps `CourseOffering.resultsPublishedAt` exactly once and
 * writes an audit row. It does **not** release anything to students: a mark becomes
 * visible to a student only when its own `Grade.publishedAt` is set, and the only
 * writers of that column are the human review decision and the marks grid
 * (`lib/grading/review-service.ts`, `lib/gradebook-db.ts`). So the old label promised an
 * audience the action never touched (TN-68), while the timestamp it writes is the anchor
 * the 15-day retention clock is measured from.
 *
 * Publishing is **one-way in this product**: there is no route that clears
 * `resultsPublishedAt`, and a repeat click is reported as `already-published` without
 * moving the anchor. A student's mark release and the retention clock are separate
 * decisions, and starting the clock is not reversible by clicking again.
 *
 * Because the write is irreversible and consequential, the UI asks first, and its copy
 * names the consequence, the thing it does *not* do, and the absence of an undo. This
 * lives here rather than inside the component because the repo has no jsdom, so a rule
 * left in a client component has no test — and the one-way rule is exactly what needs
 * pinning.
 */

export type ResultsPublicationState = {
  /** The offering's label, for the confirmation title. */
  courseName: string
  /** ISO instant, or null when the retention clock has not been started. */
  resultsPublishedAt: string | null
}

export type ResultsPublicationView = {
  /** True once the retention anchor is set. */
  published: boolean
  /** The badge text when the clock has been started, e.g. `Retention clock started 2026-09-17`. */
  clockStartedLabel: string
  /** Whether to render the start button. False once started: there is no way back. */
  canStartClock: boolean
  confirmationTitle: string
  confirmationBody: string
}

/**
 * The confirmation body shown before the one-way write.
 *
 * It names the audience boundary first — the action does **not** publish students' marks —
 * then the consequence (the retention clock starts) and the absence of an undo, because
 * those are the facts a teacher needs *before* the button, not after.
 */
export const RESULTS_PUBLICATION_CONFIRMATION_BODY =
  "This does not release marks to students — each student's mark becomes visible when " +
  "it is published from the review queue or the marks grid. It records today as the " +
  "offering's results-publication date and starts the 15-day retention clock, after which " +
  "student work becomes purge-eligible. Starting the clock cannot be undone: there is no " +
  "way to clear this date, and the retention purge is measured from it."

export function resultsPublicationView(state: ResultsPublicationState): ResultsPublicationView {
  const published = state.resultsPublishedAt !== null
  return {
    published,
    clockStartedLabel: published
      ? `Retention clock started ${state.resultsPublishedAt!.slice(0, 10)}`
      : "",
    canStartClock: !published,
    confirmationTitle: `Start the retention clock for "${state.courseName}"?`,
    confirmationBody: RESULTS_PUBLICATION_CONFIRMATION_BODY,
  }
}

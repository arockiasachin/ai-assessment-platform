/**
 * Pure view state for the "Publish results" control (TN-5).
 *
 * Publishing is **one-way in this product**: `publishOfferingResults` stamps
 * `CourseOffering.resultsPublishedAt` exactly once and reports a repeat click as
 * `already-published` without moving the anchor (see
 * `lib/retention/results-publication.ts`). There is no unpublish route. The timestamp is
 * also the anchor the 15-day retention clock is measured from, so a misclick is not
 * reversible by clicking again.
 *
 * Because the write is irreversible and consequential, the UI asks first, and its copy
 * names the consequence and the absence of an undo rather than implying one. This lives
 * here rather than inside the component because the repo has no jsdom, so a rule left in a
 * client component has no test — and the one-way rule is exactly what needs pinning.
 */

export type ResultsPublicationState = {
  /** The offering's label, for the confirmation title. */
  courseName: string
  /** ISO instant, or null when results have not been published. */
  resultsPublishedAt: string | null
}

export type ResultsPublicationView = {
  published: boolean
  /** The badge text when published, e.g. `Results published 2026-09-17`. */
  publishedLabel: string
  /** Whether to render the Publish button. False once published: there is no unpublish path. */
  canPublish: boolean
  confirmationTitle: string
  confirmationBody: string
}

/**
 * The confirmation body shown before the one-way write.
 *
 * It names the consequence (the retention clock starts) and the absence of an undo in the
 * same breath, because that is the fact a teacher needs *before* the button, not after.
 */
export const RESULTS_PUBLICATION_CONFIRMATION_BODY =
  "Students will be able to see their final results, and the 15-day retention clock starts " +
  "the moment you publish. Publishing cannot be undone — there is no unpublish action, and " +
  "the retention purge is measured from this date."

export function resultsPublicationView(state: ResultsPublicationState): ResultsPublicationView {
  const published = state.resultsPublishedAt !== null
  return {
    published,
    publishedLabel: published ? `Results published ${state.resultsPublishedAt!.slice(0, 10)}` : "",
    canPublish: !published,
    confirmationTitle: `Publish results for "${state.courseName}"?`,
    confirmationBody: RESULTS_PUBLICATION_CONFIRMATION_BODY,
  }
}

/**
 * What a student may do with a written submission, stated once.
 *
 * ## Why this module exists
 *
 * The rule "which assessment kinds accept a text submission" was implemented twice: the
 * server route refused anything that was not `ASSIGNMENT`/`DESCRIPTIVE`, and the student
 * assessments view rendered a text editor for **every other kind** — so a `CODE` or
 * `GROUP_PROJECT` card offered a control the server could only answer `409` to
 * (`SN-7`, `TN-46`). The same shape produced a second defect: the view enabled
 * **Save draft** for a `SUBMITTED`/`LATE` assessment, which the route refuses by rule
 * (`SN-6`). This repo has produced that bug repeatedly, so both halves now read the same
 * predicates.
 *
 * ## Zero imports on purpose
 *
 * `lib/assessment-visibility.ts` set the precedent: a rule module with no imports is safe
 * from a client component, a route handler and a seed alike, so it cannot be the reason a
 * caller re-implements it. Nothing here may import Prisma or React.
 */

/** The two kinds whose work is prose and is recorded as a `Submission`. */
export const TEXT_SUBMISSION_KINDS = ["ASSIGNMENT", "DESCRIPTIVE"] as const
export type TextSubmissionKind = (typeof TEXT_SUBMISSION_KINDS)[number]

/** Whether this assessment kind is handed in as text through the submission route. */
export function supportsTextSubmission(type: string): type is TextSubmissionKind {
  return (TEXT_SUBMISSION_KINDS as readonly string[]).includes(type)
}

/**
 * The submission states a student can be in, mirroring `SubmissionState` in
 * `lib/student-assessments.ts` without importing the server-only module.
 */
export type SubmissionState =
  "not_submitted" | "draft" | "submitted" | "resubmitted" | "graded" | "late"

/**
 * Save draft is legal only while the work is still a draft: no submission at all, or a row the
 * server already holds as `DRAFT`. Once anything has been handed in the route refuses, and the
 * button must not pretend otherwise (`SN-6`).
 */
export function saveDraftAllowed(state: SubmissionState): boolean {
  return state === "not_submitted" || state === "draft"
}

/**
 * Which action the primary button triggers, or `null` when the record is immutable.
 *
 * A graded submission is the only terminal state; a second sitting of a submitted piece is a
 * legitimate resubmission.
 */
export function submissionSubmitAction(state: SubmissionState): "submit" | "resubmit" | null {
  if (state === "graded") return null
  return state === "not_submitted" || state === "draft" ? "submit" : "resubmit"
}

/**
 * Why the editor is inert, in the student's words, or `null` when it is not.
 *
 * The graded case used to render a read-only box with no explanation at all (`SN-6`).
 */
export function submissionLockReason(state: SubmissionState): string | null {
  if (state === "graded") return "This submission has been graded and can no longer be changed."
  if (state === "submitted" || state === "resubmitted") {
    return "This work has been handed in. You can resubmit it, but it can no longer be saved as a draft."
  }
  if (state === "late") {
    return "This work was handed in late. You can resubmit it, but it can no longer be saved as a draft."
  }
  return null
}

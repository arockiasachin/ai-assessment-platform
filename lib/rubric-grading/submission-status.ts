import type { SubmissionStatus } from "@/lib/generated/prisma/client"

/**
 * The submission states a grade may be built from (TN-35).
 *
 * A `DRAFT` is work the student is still editing and has never handed in, so a
 * rubric must never score it and a review must never publish a mark for it. The
 * audit reproduced exactly that: a `saveDraft` row appeared in
 * `listEvaluationCandidatesForTeacher`, the model scored it, and `accept`
 * published 15/20 for a piece of work that does not exist yet.
 *
 * Every other state means the student *did* hand something in, and each is
 * legitimately gradeable:
 *
 * - `SUBMITTED` — handed in on time.
 * - `LATE` — handed in after the due date; still a submission.
 * - `GRADED` — already marked. Re-evaluation is legitimate (a teacher may re-run
 *   the model or override), and a graded submission still exists to grade.
 * - `RESUBMITTED` — a revised version handed in after grading.
 *
 * The rule lives in one place because it has to hold on two paths: the
 * candidate reader filters with it, and the evaluator refuses a draft it is
 * handed by id. A check on one path and not the other is the defect shape this
 * project keeps finding.
 */
export const GRADEABLE_SUBMISSION_STATUSES = [
  "SUBMITTED",
  "LATE",
  "GRADED",
  "RESUBMITTED",
] as const satisfies readonly SubmissionStatus[]

export type GradeableSubmissionStatus = (typeof GRADEABLE_SUBMISSION_STATUSES)[number]

/** True when work exists that a rubric may score. `DRAFT` is the only state that is not. */
export function isGradeableSubmissionStatus(status: SubmissionStatus | string): boolean {
  return (GRADEABLE_SUBMISSION_STATUSES as readonly string[]).includes(status)
}

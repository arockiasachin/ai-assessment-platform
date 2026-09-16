import type { Prisma, QuizAttemptKind } from "@/lib/generated/prisma/client"

/**
 * The one place that decides which quiz attempts count.
 *
 * ## Why this module exists
 *
 * The rule used to be two hand-maintained constant pairs — `COUNTED_STATUSES` and
 * `FINALIZED_STATUSES` — declared **twice**, in `quiz-attempts/service.ts` and
 * `analytics/service.ts`, with eleven read sites between them. Adding `kind` to that shape
 * would have meant editing eleven call sites and hoping none was missed, and the ones that
 * matter fail *silently*: a miscount does not throw, it just tells a student they have an
 * attempt left when they do not, or moves the cohort average.
 *
 * So the rule is now expressed once, as predicates, and the call sites read them. There is no
 * longer a list to extend — which was the whole point, because a list cannot express "practice
 * but counted" in the first place.
 *
 * ## The rule
 *
 * | Question | Answer |
 * | -------- | ------ |
 * | Counts against `Assessment.maxAttempts`? | status is counted **and** kind is `GRADED` |
 * | Contributes to analytics? | status is finalised **and** kind is `GRADED` |
 * | Resumable? | status is `IN_PROGRESS` **and** kind matches |
 *
 * A `PRACTICE` sitting is recorded and shown to the student, but never consumes a graded slot
 * and never moves a cohort number.
 *
 * ## The status lists, and what is actually live
 *
 * `GRADED`, `EXPIRED` and `ABANDONED` are **never written by any code path** — only
 * `IN_PROGRESS` and `SUBMITTED` are. They are kept in the lists because the schema allows them
 * and a future writer should not silently fall outside the rule, but a reader should not assume
 * they occur.
 */

/** Statuses that occupy a slot against the attempt cap. */
export const COUNTED_STATUSES = ["IN_PROGRESS", "SUBMITTED", "GRADED", "EXPIRED"] as const

/** Statuses whose work is finished, so it can contribute to a computed number. */
export const FINALIZED_STATUSES = ["SUBMITTED", "GRADED"] as const

export const GRADED: QuizAttemptKind = "GRADED"
export const PRACTICE: QuizAttemptKind = "PRACTICE"

/**
 * Attempts that count against the cap, for a given kind.
 *
 * Only `GRADED` ever meaningfully counts; the parameter exists so a caller that genuinely needs
 * "how many practice sittings has this student had" can ask without inventing a second rule.
 */
export function countedAttemptWhere(
  assessmentId: string,
  studentId: string,
  kind: QuizAttemptKind = GRADED,
): Prisma.QuizAttemptWhereInput {
  return {
    assessmentId,
    studentId,
    kind,
    status: { in: [...COUNTED_STATUSES] },
  }
}

/**
 * Attempts whose work is finished, for a given kind.
 *
 * **`GRADED` is the default and the one analytics must use.** A practice sitting that reached
 * `SUBMITTED` would otherwise contribute to the cohort average, the pass rate and the item
 * analysis — the numbers a teacher acts on.
 */
export function finalizedAttemptWhere(
  assessmentId: string,
  studentId: string,
  kind: QuizAttemptKind = GRADED,
): Prisma.QuizAttemptWhereInput {
  return {
    assessmentId,
    studentId,
    kind,
    status: { in: [...FINALIZED_STATUSES] },
  }
}

/**
 * A student's in-progress sitting **of a given kind**.
 *
 * Kind-scoped on purpose: without it, starting a graded sitting would resume an in-progress
 * *practice* one, and the student's graded attempt would silently be their practice answers.
 */
export function inProgressAttemptWhere(
  assessmentId: string,
  studentId: string,
  kind: QuizAttemptKind = GRADED,
): Prisma.QuizAttemptWhereInput {
  return { assessmentId, studentId, kind, status: "IN_PROGRESS" }
}

/**
 * Attempts that count toward the cap, as a plain array filter.
 *
 * For the callers that already have the rows in hand and would rather not re-query.
 */
export function isCounted(
  attempt: { status: string; kind?: QuizAttemptKind | null },
  kind: QuizAttemptKind = GRADED,
): boolean {
  // A row with no `kind` predates the column, which means it is graded.
  const attemptKind = attempt.kind ?? GRADED
  return attemptKind === kind && (COUNTED_STATUSES as readonly string[]).includes(attempt.status)
}

/**
 * Whether a row is a graded sitting.
 *
 * A row with no `kind` predates the column and is graded, which is why this is a function
 * rather than a `=== "GRADED"` comparison at each call site.
 */
export function isGraded(attempt: { kind?: QuizAttemptKind | null }): boolean {
  return (attempt.kind ?? GRADED) === GRADED
}

/** Whether a row's work is finished, as a plain array filter. */
export function isFinalized(
  attempt: { status: string; kind?: QuizAttemptKind | null },
  kind: QuizAttemptKind = GRADED,
): boolean {
  const attemptKind = attempt.kind ?? GRADED
  return attemptKind === kind && (FINALIZED_STATUSES as readonly string[]).includes(attempt.status)
}

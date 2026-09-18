import type { CourseOutcome } from "@/lib/grading/policy"

/**
 * The arrear rule: which outstanding course outcomes count as arrears.
 *
 * ## The owner's rule, stated once
 *
 * An arrear is one of two things:
 *
 * 1. **A failed final assessment.** The offering's FAT has a published mark and the
 *    course verdict from `evaluateCourseOutcome` is `fail`.
 * 2. **A missing final assessment on a course that has ended.** No published FAT
 *    mark exists once the offering's `endsOn` has passed.
 *
 * ## Why this is a separate, pure module
 *
 * The rule is a policy decision, not a database fact, and it is the one thing later
 * surfaces (the arrears page, the enrolment gate) must agree on. It takes the
 * outcome the reader already computed plus the offering's end state and returns a
 * reason — or `null`. There is no Prisma import, no `server-only`, no clock: the
 * caller supplies everything, so every case below is exercisable without a database.
 *
 * ## "Failed FAT" means the course verdict, not a second threshold
 *
 * Case (1) reads `outcome.status === "fail"` rather than comparing the FAT mark to
 * `PASS_MARK` again. That is deliberate: the course's pass rule is
 * `evaluateCourseOutcome`'s (grand total at least `PASS_MARK`, after the CAT gate),
 * and a second comparison here could call a course failed that the platform marks
 * passed — or the reverse. One definition of passing, reused.
 *
 * ## Absence only counts after the course has ended, and only when a FAT exists
 *
 * Both guards are load-bearing:
 *
 * - **The offering must have ended.** A student mid-term has no FAT mark yet; that
 *   is incomplete, not an arrear, and marking them would gate them out of next
 *   term's registration for work they have not been given.
 * - **A FAT must have been identified.** An offering whose policy resolves to no
 *   CAT/FAT split (fewer than two assessments) has no final assessment for anyone to
 *   miss. Reporting absence there would put every student of such a course in
 *   arrears.
 *
 * `not-judged` is never an arrear. It is the honest verdict for a course where
 * marking is unfinished or the FAT has not been sat yet, and "we cannot judge" is
 * not "the student failed".
 */

export type ArrearReason = "failed" | "did-not-appear"

export type ArrearInput = {
  /** The course verdict from `evaluateCourseOutcome`. */
  outcome: CourseOutcome
  /** Whether the offering's policy resolved to a final assessment at all. */
  finalAssessmentIdentified: boolean
  /** Whether that final assessment has a published `Grade`. */
  finalAssessmentPublished: boolean
  /** Whether the offering's `endsOn` is in the past relative to the caller's clock. */
  offeringEnded: boolean
}

/**
 * The arrear reason for one course outcome, or `null` when none stands.
 *
 * The failed case is checked first and is the only one that requires a published
 * FAT; the absence case therefore cannot shadow it. When the FAT is unpublished the
 * verdict can only be a CAT-gate failure, which the absence case reports as
 * `did-not-appear` once the course has ended — the FAT is genuinely missing, whatever
 * the reason the student did not sit it.
 */
export function arrearFor(input: ArrearInput): ArrearReason | null {
  if (input.finalAssessmentPublished && input.outcome.status === "fail") {
    return "failed"
  }

  if (input.offeringEnded && input.finalAssessmentIdentified && !input.finalAssessmentPublished) {
    return "did-not-appear"
  }

  return null
}

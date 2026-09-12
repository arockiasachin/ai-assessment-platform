/**
 * Pure retention-decision logic for the student-work retention policy.
 *
 * The product policy, stated by the owner:
 *
 * > "Student work is retained till he gets graded for the whole course and 15
 * > days after results are published."
 *
 * Interpreting that conservatively: a student's work artifacts are kept for as
 * long as the course is in progress and are only ever removed once **both**
 *
 *   1. the offering's results have been **published**
 *      (`CourseOffering.resultsPublishedAt` is non-null), and
 *   2. **15 days** have elapsed since that publication.
 *
 * Nothing is deleted while a course is ungraded or its results unpublished. This
 * module is deliberately pure — no clock, no database, no I/O — so the core
 * decision is unit-testable in isolation and can never be influenced by a
 * caller-supplied "delete this" flag. The purge routine supplies the anchor it
 * reads from the database and the current time; it does not accept an
 * eligibility or cutoff argument from a request.
 */

/** The retention window after results publication, in days. */
export const RESULT_RETENTION_WINDOW_DAYS = 15

/** The retention window in milliseconds. */
export const RESULT_RETENTION_WINDOW_MS = RESULT_RETENTION_WINDOW_DAYS * 24 * 60 * 60 * 1000

/** The minimal offering state the decision needs. */
export type RetentionAnchor = {
  /**
   * When results were published for the offering, or `null` when they have not
   * been published. An offering without a publication date can never be purged.
   */
  resultsPublishedAt: Date | null
}

/**
 * Why an offering is or is not purge-eligible.
 *
 * - `unpublished` — no `resultsPublishedAt`; the clock has not started.
 * - `within-window` — published, but fewer than 15 full days have elapsed.
 * - `invalid-anchor` — the stored publication date is not a usable `Date`; we
 *   refuse to purge rather than guess.
 * - `window-elapsed` — published at least 15 days ago; eligible.
 */
export type RetentionDecisionReason =
  "unpublished" | "within-window" | "invalid-anchor" | "window-elapsed"

export type RetentionDecision =
  | { eligible: false; reason: "unpublished" | "within-window" | "invalid-anchor" }
  | { eligible: true; reason: "window-elapsed"; cutoff: Date }

/** True when a `Date` is a real, finite instant. */
function isValidDate(value: Date | null | undefined): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime())
}

/**
 * The instant at which an offering published at `resultsPublishedAt` becomes
 * purge-eligible: publication + 15 days.
 */
export function retentionCutoff(
  resultsPublishedAt: Date,
  windowMs: number = RESULT_RETENTION_WINDOW_MS,
): Date {
  return new Date(resultsPublishedAt.getTime() + windowMs)
}

/**
 * Decide whether an offering's student work may be purged at `now`.
 *
 * The boundary is inclusive: at exactly 15 days after publication the offering
 * is eligible; one millisecond earlier it is not. An unpublished or unparseable
 * anchor is never eligible.
 */
export function decideRetention(
  anchor: RetentionAnchor,
  now: Date,
  windowMs: number = RESULT_RETENTION_WINDOW_MS,
): RetentionDecision {
  if (!isValidDate(now)) {
    return { eligible: false, reason: "invalid-anchor" }
  }
  if (anchor.resultsPublishedAt === null || anchor.resultsPublishedAt === undefined) {
    return { eligible: false, reason: "unpublished" }
  }
  if (!isValidDate(anchor.resultsPublishedAt)) {
    return { eligible: false, reason: "invalid-anchor" }
  }

  const cutoff = retentionCutoff(anchor.resultsPublishedAt, windowMs)
  if (now.getTime() >= cutoff.getTime()) {
    return { eligible: true, reason: "window-elapsed", cutoff }
  }
  return { eligible: false, reason: "within-window" }
}

/** Convenience boolean form of {@link decideRetention}. */
export function isRetentionEligible(
  anchor: RetentionAnchor,
  now: Date,
  windowMs: number = RESULT_RETENTION_WINDOW_MS,
): boolean {
  return decideRetention(anchor, now, windowMs).eligible
}

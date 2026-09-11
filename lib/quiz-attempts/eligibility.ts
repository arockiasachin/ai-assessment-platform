/**
 * Attempt and deadline policy, kept pure so it is exhaustively unit tested
 * without a database. The service layer calls this *before* creating or
 * mutating an attempt, so a capped or deadline-blocked request never writes.
 *
 * Defaults and where they live
 * ----------------------------
 * The cap is resolved in one place, `resolveMaxAttempts`, with this precedence:
 *
 *  1. `Assessment.maxAttempts` when the assessment sets a valid positive cap;
 *  2. the `QUIZ_MAX_ATTEMPTS` environment override (operator-wide);
 *  3. `DEFAULT_MAX_ATTEMPTS = 3`.
 *
 * A malformed or non-positive value at either level is ignored in favour of the
 * next, so a bad value can never disable the cap (or make it negative).
 *
 * Deadline handling
 * -----------------
 * - Starting a *new* attempt after `dueDate` is blocked (`deadline`).
 * - Submitting an attempt that was already started is always allowed, but a
 *   submission after `dueDate` is flagged late (`isLateSubmission`) and called
 *   out in the audit trail and the auto-scorer rationale. This is deliberate
 *   "handle late" rather than "discard late work": a student who started before
 *   the deadline can finish, and the teacher sees that it was late.
 */

export const DEFAULT_MAX_ATTEMPTS = 3

/** The env override key for the attempt cap. */
export const MAX_ATTEMPTS_ENV_KEY = "QUIZ_MAX_ATTEMPTS"

export type AttemptBlockCode = "deadline" | "cap" | null

export type AttemptEligibility = {
  allowed: boolean
  /** Why a new attempt is blocked, or `null` when allowed. */
  reason: string | null
  /** Machine-readable block reason for status-code mapping. */
  code: AttemptBlockCode
  used: number
  remaining: number
  maxAttempts: number
}

function positiveInt(value: number | string | undefined | null): number | null {
  if (value === undefined || value === null || value === "") return null
  const parsed = typeof value === "number" ? Math.floor(value) : Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 1) return null
  return parsed
}

/**
 * Resolve the configured attempt cap from the per-assessment column, then the
 * `QUIZ_MAX_ATTEMPTS` environment override, then the default. A malformed or
 * non-positive value at either level is ignored in favour of the next, so a bad
 * value can never disable the cap (or make it negative).
 */
export function resolveMaxAttempts(
  assessmentMaxAttempts: number | string | undefined | null = null,
  raw: string | undefined | null = process.env[MAX_ATTEMPTS_ENV_KEY],
): number {
  return positiveInt(assessmentMaxAttempts) ?? positiveInt(raw) ?? DEFAULT_MAX_ATTEMPTS
}

/**
 * Decide whether a student may start a new attempt. `existingAttemptCount` is
 * the number of attempts that still count toward the cap (the caller excludes
 * abandoned ones).
 */
export function evaluateAttemptEligibility(input: {
  existingAttemptCount: number
  maxAttempts: number
  now: Date
  dueDate: Date
}): AttemptEligibility {
  const used = Math.max(0, Math.floor(input.existingAttemptCount))
  const maxAttempts = Math.max(1, Math.floor(input.maxAttempts))
  const remaining = Math.max(0, maxAttempts - used)

  if (input.now.getTime() > input.dueDate.getTime()) {
    return {
      allowed: false,
      reason: "The deadline for this quiz has passed.",
      code: "deadline",
      used,
      remaining,
      maxAttempts,
    }
  }

  if (used >= maxAttempts) {
    return {
      allowed: false,
      reason: `Attempt limit reached (${used} of ${maxAttempts} attempts used).`,
      code: "cap",
      used,
      remaining,
      maxAttempts,
    }
  }

  return { allowed: true, reason: null, code: null, used, remaining, maxAttempts }
}

/** True when a submission happened after the assessment deadline. */
export function isLateSubmission(submittedAt: Date, dueDate: Date): boolean {
  return submittedAt.getTime() > dueDate.getTime()
}

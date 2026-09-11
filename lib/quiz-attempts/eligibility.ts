/**
 * Attempt and deadline policy, kept pure so it is exhaustively unit tested
 * without a database. The service layer calls this *before* creating or
 * mutating an attempt, so a capped or deadline-blocked request never writes.
 *
 * Defaults and where they live
 * ----------------------------
 * `prisma/schema.prisma` is frozen and there is no assessment-level JSON column
 * (only `Question.metadata` / `Group.metadata` / `CodeTask.metadata` exist), so a
 * per-assessment attempt cap has nowhere to live without a migration. The cap is
 * therefore a server-side default (`DEFAULT_MAX_ATTEMPTS = 3`) with a single
 * documented environment override (`QUIZ_MAX_ATTEMPTS`). This is reported as a
 * schema gap in `docs/features/quiz-grading.md`; the resolution function is the
 * one place to bind a real `Assessment.metadata` column to once the schema is
 * unfrozen.
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

/**
 * Resolve the configured attempt cap. A malformed or non-positive override is
 * ignored in favour of the default, so a bad env value can never disable the cap
 * (or make it negative).
 */
export function resolveMaxAttempts(
  raw: string | undefined | null = process.env[MAX_ATTEMPTS_ENV_KEY],
): number {
  if (raw === undefined || raw === null || raw.trim() === "") return DEFAULT_MAX_ATTEMPTS
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_MAX_ATTEMPTS
  return parsed
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

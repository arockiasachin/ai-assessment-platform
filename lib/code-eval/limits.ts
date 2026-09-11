/**
 * Submission-limit policy, kept pure so it is exhaustively unit tested without a
 * database or Docker. The service layer calls this *before* touching the
 * sandbox, so a capped or late submission never costs a container run.
 */

export type SubmissionBlockCode = "deadline" | "cap" | null

export type SubmissionEligibility = {
  allowed: boolean
  /** Why submission is blocked, or `null` when allowed. */
  reason: string | null
  /** Machine-readable block reason for status-code mapping. */
  code: SubmissionBlockCode
  used: number
  remaining: number
  maxSubmissions: number
}

export function evaluateSubmissionEligibility(input: {
  existingRunCount: number
  maxSubmissions: number
  now: Date
  dueDate: Date
}): SubmissionEligibility {
  const used = Math.max(0, Math.floor(input.existingRunCount))
  const maxSubmissions = Math.max(1, Math.floor(input.maxSubmissions))
  const remaining = Math.max(0, maxSubmissions - used)

  if (input.now.getTime() > input.dueDate.getTime()) {
    return {
      allowed: false,
      reason: "The deadline for this code task has passed.",
      code: "deadline",
      used,
      remaining,
      maxSubmissions,
    }
  }

  if (used >= maxSubmissions) {
    return {
      allowed: false,
      reason: `Submission limit reached (${used} of ${maxSubmissions} runs used).`,
      code: "cap",
      used,
      remaining,
      maxSubmissions,
    }
  }

  return { allowed: true, reason: null, code: null, used, remaining, maxSubmissions }
}

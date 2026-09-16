/**
 * The retake policy, as pure rules.
 *
 * Three policies, and the difference between them is *who* may grant another sitting:
 *
 * | Policy | Another graded sitting is available when |
 * | ------ | ---------------------------------------- |
 * | `NONE` | never — one sitting, whatever `maxAttempts` says |
 * | `FIXED` | the student is under the retake cap |
 * | `APPROVAL` | a teacher has **approved** a `RetakeRequest` for this assessment |
 *
 * The model deliberately separates "may I sit this a second time" from "how many times may I
 * sit", because they are different questions and the UI copy cannot be honest with one number.
 * `maxAttempts` bounds total sittings; `retakesAllowed` bounds retakes *after the first*. A
 * teacher who types "1 retake" means `maxAttempts = 2`, and calling that two attempts in the UI
 * would be a lie.
 *
 * ## Why the first sitting is always allowed
 *
 * Every policy grants the first graded sitting unconditionally. `NONE` means "no *retakes*", not
 * "no assessment" — a distinction that is easy to lose and would lock students out of work they
 * are entitled to sit.
 */

export type RetakePolicy = "NONE" | "FIXED" | "APPROVAL"

export type RetakeContext = {
  policy: RetakePolicy
  /** Graded sittings already used. */
  gradedAttemptsUsed: number
  /** Whether an approved `RetakeRequest` exists for this student and assessment. */
  hasApprovedRequest: boolean
  /** Whether a request exists at all, so the UI can say "awaiting approval" rather than "ask". */
  hasPendingRequest: boolean
}

export type RetakeDecision =
  | { allowed: true; kind: "first-sitting" | "retake" }
  | {
      allowed: false
      /** `cap` maps to 429, `approval-required` to 403, `awaiting-approval` to 409. */
      code: "cap" | "approval-required" | "awaiting-approval"
      reason: string
    }

/**
 * The effective cap on **total graded sittings** for an assessment, or `null` when the
 * caller should use `resolveMaxAttempts`' own chain.
 *
 * `retakesAllowed` is expressed in retakes, so the total is `retakes + 1`. `NONE` is one sitting
 * by definition. This is where a retake count becomes a sitting count, and it is deliberately
 * separate from `decideRetake` so the cap is applied in exactly one place.
 */
export function resolveSittingCap(input: {
  policy: RetakePolicy
  maxAttempts: number
  retakesAllowed: number | null
}): number {
  if (input.policy === "NONE") return 1
  if (input.retakesAllowed === null) return input.maxAttempts
  if (!Number.isFinite(input.retakesAllowed) || input.retakesAllowed < 0) return input.maxAttempts
  return Math.max(1, Math.floor(input.retakesAllowed) + 1)
}

/**
 * Decide the **policy** question: is another graded sitting permitted at all?
 *
 * Only the part the cap cannot express. `FIXED` defers entirely to the cap — which
 * `resolveSittingCap` computes and `evaluateAttemptEligibility` enforces — so this function does
 * not re-derive it. Re-deriving it here would apply the cap twice, and the second application is
 * where the two could disagree.
 *
 * `gradedAttemptsUsed` counts sittings that count toward the cap; the caller has already
 * excluded practice and abandoned attempts, because that filtering is `./kinds`'s job and doing
 * it here too would be a second definition of the same rule.
 */
export function decideRetake(context: RetakeContext): RetakeDecision {
  // The first sitting is unconditional under every policy. `NONE` means "no *retakes*", not "no
  // assessment" — losing that distinction would lock students out of work they may sit.
  if (context.gradedAttemptsUsed <= 0) {
    return { allowed: true, kind: "first-sitting" }
  }

  switch (context.policy) {
    case "NONE":
      return {
        allowed: false,
        code: "cap",
        reason: "This assessment allows one graded sitting.",
      }

    case "APPROVAL": {
      if (context.hasApprovedRequest) return { allowed: true, kind: "retake" }
      if (context.hasPendingRequest) {
        return {
          allowed: false,
          code: "awaiting-approval",
          reason: "Your retake request is awaiting your teacher's approval.",
        }
      }
      return {
        allowed: false,
        code: "approval-required",
        reason: "This assessment allows a retake only on an approved request.",
      }
    }

    case "FIXED":
      // The cap decides, and it is enforced by the caller.
      return { allowed: true, kind: "retake" }
  }
}

/**
 * The sentence a teacher sees for an assessment's policy, so the effect of a setting is visible
 * where it is set rather than only when a student is blocked by it.
 */
export function describeRetakePolicy(
  policy: RetakePolicy,
  maxAttempts: number,
  retakesAllowed: number | null,
): string {
  if (policy === "NONE") return "One graded sitting. No retakes."
  if (policy === "APPROVAL") return "Retakes only on an approved request."

  const total = resolveSittingCap({ policy, maxAttempts, retakesAllowed })
  const retakes = total - 1
  return retakes <= 0
    ? "One graded sitting. No retakes."
    : `${total} graded sittings — the first, plus ${retakes} ${retakes === 1 ? "retake" : "retakes"}.`
}

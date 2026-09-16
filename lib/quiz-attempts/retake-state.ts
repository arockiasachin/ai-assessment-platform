import { prisma } from "@/lib/prisma"

import { GRADED, isCounted } from "./kinds"
import { resolveMaxAttempts } from "./eligibility"
import { decideRetake, resolveSittingCap, type RetakePolicy } from "./retake-policy"

/**
 * The retake picture for one student and assessment, in one place.
 *
 * `startQuizAttempt` is the authority on whether a sitting may be started — it re-checks inside a
 * transaction. This is the **read-only** view of the same rules, so a page can show a student
 * what is available rather than offering a button that will fail. Having one function means the
 * two cannot drift into disagreeing, which for a gate like this is the whole risk.
 *
 * Returns `null` when the assessment does not exist.
 */

export type RetakeRequestStatusValue = "PENDING" | "APPROVED" | "REJECTED"

export type RetakeState = {
  policy: RetakePolicy
  /** Graded sittings already used. Practice and abandoned attempts are excluded. */
  gradedAttemptsUsed: number
  /** The cap on total graded sittings, derived from the policy. */
  sittingCap: number
  /** Whether another graded sitting may be started right now. */
  canRetake: boolean
  /** Why not, when `canRetake` is false. Null when allowed. */
  blockedReason: string | null
  /** The student's request, on an `APPROVAL` assessment. */
  requestStatus: RetakeRequestStatusValue | null
  /**
   * Whether a practice sitting may be started.
   *
   * Mirrors `startPracticeAttempt`'s one gate: practice opens only once the deadline has passed
   * or a graded attempt has been submitted, because the start view returns the questions.
   */
  canPractise: boolean
}

export async function getRetakeStateForStudent(
  studentId: string,
  assessmentId: string,
  now: Date = new Date(),
): Promise<RetakeState | null> {
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: {
      id: true,
      dueDate: true,
      maxAttempts: true,
      retakePolicy: true,
      retakesAllowed: true,
    },
  })
  if (!assessment) return null

  const [attempts, request] = await Promise.all([
    prisma.quizAttempt.findMany({
      where: { assessmentId, studentId },
      select: { status: true, kind: true },
    }),
    prisma.retakeRequest.findUnique({
      where: { assessmentId_studentId: { assessmentId, studentId } },
      select: { status: true },
    }),
  ])

  const gradedAttemptsUsed = attempts.filter((attempt) => isCounted(attempt)).length
  // Whether any graded sitting has been submitted — the practice gate. Read from the rows already
  // in hand rather than a second query.
  const hasSubmittedGraded = attempts.some(
    (attempt) => attempt.kind === GRADED && attempt.status === "SUBMITTED",
  )

  // `resolveMaxAttempts` owns the per-assessment → env → default chain, so the cap is not
  // re-derived here. A null `maxAttempts` means "use the platform default", not "zero sittings".
  const effectiveCap = resolveSittingCap({
    policy: assessment.retakePolicy,
    maxAttempts: resolveMaxAttempts(assessment.maxAttempts),
    retakesAllowed: assessment.retakesAllowed,
  })

  const decision = decideRetake({
    policy: assessment.retakePolicy,
    gradedAttemptsUsed,
    hasApprovedRequest: request?.status === "APPROVED",
    hasPendingRequest: request?.status === "PENDING",
  })

  const reachedCap = gradedAttemptsUsed >= effectiveCap
  const canRetake = decision.allowed && !reachedCap
  const blockedReason = !decision.allowed
    ? decision.reason
    : reachedCap
      ? `Attempt limit reached (${gradedAttemptsUsed} of ${effectiveCap} attempts used).`
      : null

  const pastDeadline = now.getTime() > assessment.dueDate.getTime()

  return {
    policy: assessment.retakePolicy,
    gradedAttemptsUsed,
    sittingCap: effectiveCap,
    canRetake,
    blockedReason,
    requestStatus: (request?.status as RetakeRequestStatusValue | undefined) ?? null,
    canPractise: pastDeadline || hasSubmittedGraded,
  }
}

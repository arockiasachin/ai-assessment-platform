import type { Prisma, QuizAttemptKind } from "@/lib/generated/prisma/client"
import { prisma } from "@/lib/prisma"

import { inProgressAttemptWhere } from "./kinds"

/**
 * The single query for a student's resumable in-progress sitting.
 *
 * ## Why this is a function, not a `findFirst` at the call site
 *
 * Resuming a sitting used to be a `prisma.quizAttempt.findFirst({ where: { assessmentId,
 * studentId, status: "IN_PROGRESS" } })` whose `where` a caller assembled. It was correct on
 * the paths its author had in mind and silently missing the `kind` scope on the one they did
 * not: starting a graded quiz could resume an in-progress **practice** sitting, and submitting
 * it then recorded nothing, because a practice sitting never enters the grade pipeline.
 *
 * That is the recurring "guard correct on the considered paths" shape, and adding one more
 * condition would only fix the instance. The scope is now impossible to omit:
 *
 * - `kind` is a **required** argument with no default, so a caller that forgets it does not
 *   compile; and
 * - the query body — including the rule in `inProgressAttemptWhere` — lives here, so no call
 *   site ever assembles the `where` again.
 *
 * Both start paths (the graded start, and the practice start) and the locked re-check inside
 * the graded start call this, so there is exactly one definition of "resumable".
 */
export async function findResumableAttempt(
  assessmentId: string,
  studentId: string,
  kind: QuizAttemptKind,
  client: Prisma.TransactionClient = prisma,
): Promise<{ id: string } | null> {
  return client.quizAttempt.findFirst({
    where: inProgressAttemptWhere(assessmentId, studentId, kind),
    orderBy: { attemptNumber: "desc" },
    select: { id: true },
  })
}

import type { TestRunResponse } from "@/lib/contracts/code-eval"
import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"

import { loadOwnedCodeTask } from "./authz"
import { serializeTestRun } from "./serialize"

/**
 * Teacher-facing run evidence.
 *
 * A `TestRun` is surfaced here for a human to read. This module cannot publish a
 * grade; publication stays in `lib/grading/review-service.ts`.
 */
export async function listRunsForTeacher(
  user: AuthUser,
  assessmentId: string,
  options: { studentId?: string } = {},
): Promise<TestRunResponse[]> {
  const { owned, codeTask } = await loadOwnedCodeTask(user, assessmentId)
  const runs = await prisma.testRun.findMany({
    where: {
      codeTaskId: codeTask.id,
      ...(options.studentId ? { studentId: options.studentId } : {}),
    },
    include: { student: { select: { fullName: true, registerNumber: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  })

  return runs.map((run) =>
    serializeTestRun(run, owned.id, {
      studentName: run.student.fullName,
      studentRegisterNumber: run.student.registerNumber,
    }),
  )
}

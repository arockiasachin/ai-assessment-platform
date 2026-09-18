import type { TestCase } from "@/lib/generated/prisma/client"
import { prisma } from "@/lib/prisma"

import { resolveDraftTestCaseIds } from "./metadata"

/**
 * The test cases a run may execute.
 *
 * Draft-ness lives in `CodeTask.metadata.draftTestCaseIds`, not a column. A
 * generated case is a **draft** until a teacher publishes it, and
 * `components/teacher-code-task-actions.tsx` promises the teacher that "Drafts
 * are never run and never shown to students." Before this module the execution
 * pipeline loaded every case with no filter, so the promise was false: an
 * unreviewed, model-authored case decided a student's pass/fail. Filtering here
 * — the one loader both the Submit and Run paths use — makes publishing mean
 * something.
 *
 * A task with no `draftTestCaseIds` marker (a hand-authored or imported task)
 * has no drafts, so the filter is skipped rather than issuing a `notIn: []`
 * predicate.
 */
export async function loadActiveTestCases(
  codeTaskId: string,
  metadata: unknown,
): Promise<TestCase[]> {
  const draftIds = resolveDraftTestCaseIds(metadata)
  return prisma.testCase.findMany({
    where: {
      codeTaskId,
      ...(draftIds.size > 0 ? { id: { notIn: [...draftIds] } } : {}),
    },
    orderBy: { order: "asc" },
  })
}

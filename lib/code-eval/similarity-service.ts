import {
  setSimilarityVerdictRequestSchema,
  similarityScanRequestSchema,
  type SimilarityListResponse,
  type SimilarityPair,
} from "@/lib/contracts/code-eval"
import type { CodeLanguage } from "@/lib/contracts/code-eval"
import type { Prisma } from "@/lib/generated/prisma/client"
import { writeAuditLog } from "@/lib/grading/audit"
import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"

import { loadOwnedCodeTask } from "./authz"
import { CodeEvalError } from "./errors"
import { SIMILARITY_FLAG_THRESHOLD, compareSources, nextSimilarityVerdict } from "./similarity"

/**
 * Cohort similarity scanning for one owned code task.
 *
 * The scan compares the latest submission of every enrolled student against
 * every other, persists a `SimilarityCheck` per pair, and reports the flagged
 * pairs. It **flags for human review and never decides**: below-threshold pairs
 * are stored as `PENDING`, at/above threshold as `FLAGGED`, and only a teacher
 * action can move a pair to `CLEARED`. Similarity is never exposed to students.
 */

type RunWithStudent = {
  studentId: string
  sourceCode: string | null
  createdAt: Date
  student: { fullName: string; registerNumber: string }
}

function orderedPair(a: string, b: string): { studentId: string; comparedStudentId: string } {
  return a < b ? { studentId: a, comparedStudentId: b } : { studentId: b, comparedStudentId: a }
}

function readEvidence(value: unknown): SimilarityPair["evidence"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  return {
    method:
      typeof record.method === "string" ? record.method : "normalized-token-shingling-jaccard",
    shingleSize: typeof record.shingleSize === "number" ? record.shingleSize : 0,
    sharedShingles: typeof record.sharedShingles === "number" ? record.sharedShingles : 0,
    tokenCountA: typeof record.tokenCountA === "number" ? record.tokenCountA : 0,
    tokenCountB: typeof record.tokenCountB === "number" ? record.tokenCountB : 0,
  }
}

export async function listSimilarityForTeacher(
  user: AuthUser,
  assessmentId: string,
): Promise<SimilarityListResponse> {
  const { codeTask } = await loadOwnedCodeTask(user, assessmentId)
  const checks = await prisma.similarityCheck.findMany({
    where: { codeTaskId: codeTask.id },
    include: {
      student: { select: { fullName: true } },
      comparedStudent: { select: { fullName: true } },
    },
    orderBy: { similarity: "desc" },
    take: 500,
  })

  return {
    success: true,
    threshold: SIMILARITY_FLAG_THRESHOLD,
    pairs: checks.map((check) => ({
      id: check.id,
      codeTaskId: check.codeTaskId ?? codeTask.id,
      similarity: check.similarity,
      verdict: check.verdict,
      studentId: check.studentId,
      studentName: check.student.fullName,
      comparedStudentId: check.comparedStudentId,
      comparedStudentName: check.comparedStudent.fullName,
      evidence: readEvidence(check.evidence),
      checkedAt: check.checkedAt.toISOString(),
    })),
  }
}

export async function scanCohortSimilarityForTeacher(
  user: AuthUser,
  assessmentId: string,
  input: unknown,
): Promise<SimilarityListResponse> {
  const request = similarityScanRequestSchema.parse(input ?? {})
  const threshold = request.threshold ?? SIMILARITY_FLAG_THRESHOLD
  const { codeTask } = await loadOwnedCodeTask(user, assessmentId)

  const runs: RunWithStudent[] = await prisma.testRun.findMany({
    where: { codeTaskId: codeTask.id, sourceCode: { not: null } },
    select: {
      studentId: true,
      sourceCode: true,
      createdAt: true,
      student: { select: { fullName: true, registerNumber: true } },
    },
    orderBy: { createdAt: "desc" },
  })

  // Latest submission per student.
  const latestByStudent = new Map<string, RunWithStudent>()
  for (const run of runs) {
    if (!latestByStudent.has(run.studentId)) latestByStudent.set(run.studentId, run)
  }
  const submissions = [...latestByStudent.values()]
  const language: CodeLanguage = codeTask.language === "javascript" ? "javascript" : "python"

  for (let i = 0; i < submissions.length; i += 1) {
    for (let j = i + 1; j < submissions.length; j += 1) {
      const a = submissions[i]
      const b = submissions[j]
      if (!a.sourceCode || !b.sourceCode) continue
      const comparison = compareSources(a.sourceCode, b.sourceCode, language, { threshold })
      const pair = orderedPair(a.studentId, b.studentId)

      const existing = await prisma.similarityCheck.findFirst({
        where: {
          assessmentId,
          codeTaskId: codeTask.id,
          studentId: pair.studentId,
          comparedStudentId: pair.comparedStudentId,
        },
        select: { id: true, verdict: true },
      })

      // A scan recomputes the score, not the human decision: keep a FLAGGED/CLEARED
      // verdict so re-running the scan cannot wipe a teacher's review (TN-48).
      const verdict = nextSimilarityVerdict(existing?.verdict, comparison.flagged)
      const evidence = comparison.evidence as unknown as Prisma.InputJsonValue

      if (existing) {
        await prisma.similarityCheck.update({
          where: { id: existing.id },
          data: {
            similarity: comparison.similarity,
            verdict,
            evidence,
            checkedAt: new Date(),
          },
        })
      } else {
        await prisma.similarityCheck.create({
          data: {
            assessmentId,
            codeTaskId: codeTask.id,
            studentId: pair.studentId,
            comparedStudentId: pair.comparedStudentId,
            similarity: comparison.similarity,
            verdict,
            evidence,
          },
        })
      }
    }
  }

  return listSimilarityForTeacher(user, assessmentId)
}

/** Human review action: clear or re-flag a pair. Never a grade decision. */
export async function setSimilarityVerdictForTeacher(
  user: AuthUser,
  assessmentId: string,
  checkId: string,
  input: unknown,
): Promise<SimilarityPair> {
  const request = setSimilarityVerdictRequestSchema.parse(input)
  const { codeTask } = await loadOwnedCodeTask(user, assessmentId)
  const check = await prisma.similarityCheck.findUnique({ where: { id: checkId } })
  if (!check || check.codeTaskId !== codeTask.id) {
    throw new CodeEvalError(404, "Similarity check not found.")
  }

  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.similarityCheck.update({
      where: { id: check.id },
      data: { verdict: request.verdict },
      include: {
        student: { select: { fullName: true } },
        comparedStudent: { select: { fullName: true } },
      },
    })
    await writeAuditLog(tx, {
      entityType: "SimilarityCheck",
      entityId: check.id,
      action: "code_similarity.reviewed",
      actor: { id: user.id, role: user.role },
      before: { verdict: check.verdict },
      after: { verdict: request.verdict },
    })
    return saved
  })

  return {
    id: updated.id,
    codeTaskId: updated.codeTaskId ?? codeTask.id,
    similarity: updated.similarity,
    verdict: updated.verdict,
    studentId: updated.studentId,
    studentName: updated.student.fullName,
    comparedStudentId: updated.comparedStudentId,
    comparedStudentName: updated.comparedStudent.fullName,
    evidence: readEvidence(updated.evidence),
    checkedAt: updated.checkedAt.toISOString(),
  }
}

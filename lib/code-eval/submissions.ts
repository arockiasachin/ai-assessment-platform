import {
  codeSubmissionRequestSchema,
  type StudentCodeTask,
  type TestRunResponse,
} from "@/lib/contracts/code-eval"
import type { Prisma } from "@/lib/generated/prisma/client"
import { writeAuditLog } from "@/lib/grading/audit"
import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"

import { loadEnrolledCodeTask, resolveStudentProfileId, type EnrolledCodeTask } from "./authz"
import { CodeEvalError } from "./errors"
import { executeSandbox, type SandboxExecutor } from "./executor"
import type { HarnessTestSpec } from "./harness"
import { evaluateSubmissionEligibility } from "./limits"
import { resolveMaxSubmissions } from "./metadata"
import {
  buildTestResults,
  computeCoverage,
  normalizeCategory,
  parseHarnessOutput,
  resolveRunStatus,
  summarizeResults,
} from "./results"
import { serializeTestRun, toRunEvidenceJson } from "./serialize"

/**
 * Student-side submission pipeline.
 *
 * The service enforces, in order: active enrollment, a CODE assessment with a
 * code task, the deadline, and the submission cap — **before** a container is
 * created. The sandbox then runs the student's code against active test cases
 * and the run is persisted as evidence. A `TestRun` is never a `Grade`; nothing
 * here writes to `Grade` or `GradeReview`.
 *
 * The executor is injectable so the pipeline is testable without Docker.
 */

export type SubmissionDeps = { executor?: SandboxExecutor }

function toHarnessTests(
  testCases: readonly {
    id: string
    name: string
    category: string
    input: string | null
    expectedOutput: string | null
    points: unknown
  }[],
): HarnessTestSpec[] {
  return testCases.map((testCase) => ({
    id: testCase.id,
    name: testCase.name,
    category: normalizeCategory(testCase.category),
    input: testCase.input,
    expectedOutput: testCase.expectedOutput,
    points: Number(testCase.points),
  }))
}

/** The student's enrolled CODE tasks with their submission budget. */
export async function listStudentCodeTasks(user: AuthUser): Promise<StudentCodeTask[]> {
  const studentId = await resolveStudentProfileId(user)
  const assessments = await prisma.assessment.findMany({
    where: {
      type: "CODE",
      codeTask: { isNot: null },
      offering: { enrollments: { some: { studentId, status: "active" } } },
    },
    select: {
      id: true,
      title: true,
      dueDate: true,
      maxMarks: true,
      codeTask: {
        select: {
          id: true,
          language: true,
          instructions: true,
          starterCode: true,
          timeLimitMs: true,
          memoryLimitMb: true,
          metadata: true,
          testCases: { select: { id: true } },
        },
      },
    },
    orderBy: { dueDate: "asc" },
    take: 200,
  })

  const tasks: StudentCodeTask[] = []
  for (const assessment of assessments) {
    const codeTask = assessment.codeTask
    if (!codeTask) continue

    const runs = await prisma.testRun.findMany({
      where: { codeTaskId: codeTask.id, studentId },
      select: { status: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    })
    const maxSubmissions = resolveMaxSubmissions(codeTask.metadata)
    const eligibility = evaluateSubmissionEligibility({
      existingRunCount: runs.length,
      maxSubmissions,
      now: new Date(),
      dueDate: assessment.dueDate,
    })

    tasks.push({
      assessmentId: assessment.id,
      assessmentTitle: assessment.title,
      dueDate: assessment.dueDate.toISOString(),
      language: codeTask.language === "javascript" ? "javascript" : "python",
      instructions: codeTask.instructions,
      starterCode: codeTask.starterCode,
      testCaseCount: codeTask.testCases.length,
      maxMarks: assessment.maxMarks,
      timeLimitMs: codeTask.timeLimitMs,
      memoryLimitMb: codeTask.memoryLimitMb,
      maxSubmissions,
      submissionsUsed: runs.length,
      canSubmit: eligibility.allowed,
      blockedReason: eligibility.reason,
      latestRunStatus: runs[0]?.status ?? null,
      latestRunAt: runs[0]?.createdAt.toISOString() ?? null,
    })
  }

  return tasks
}

/** Load one enrolled code task, or throw (handles type/enrollment checks). */
export async function getStudentCodeTask(
  user: AuthUser,
  assessmentId: string,
): Promise<EnrolledCodeTask> {
  return loadEnrolledCodeTask(user, assessmentId)
}

async function loadOwnedRun(user: AuthUser, runId: string) {
  const studentId = await resolveStudentProfileId(user)
  const run = await prisma.testRun.findUnique({
    where: { id: runId },
    include: {
      codeTask: { select: { assessmentId: true } },
      student: { select: { fullName: true, registerNumber: true } },
    },
  })
  // A run that belongs to another student is reported as not found, so the
  // endpoint never confirms the existence of someone else's work.
  if (!run || run.studentId !== studentId || !run.codeTask.assessmentId) {
    throw new CodeEvalError(404, "Test run not found.")
  }
  return { run, assessmentId: run.codeTask.assessmentId }
}

export async function getStudentRun(user: AuthUser, runId: string): Promise<TestRunResponse> {
  const { run, assessmentId } = await loadOwnedRun(user, runId)
  return serializeTestRun(run, assessmentId)
}

export async function listStudentRuns(
  user: AuthUser,
  assessmentId: string,
): Promise<TestRunResponse[]> {
  const enrolled = await loadEnrolledCodeTask(user, assessmentId)
  const runs = await prisma.testRun.findMany({
    where: { codeTaskId: enrolled.codeTaskId, studentId: enrolled.studentId },
    orderBy: { createdAt: "desc" },
    take: 100,
  })
  return runs.map((run) => serializeTestRun(run, enrolled.assessmentId))
}

/**
 * Run one submission in the sandbox and persist the evidence. All limits are
 * enforced server-side from the database rows, never from the request body.
 */
export async function submitCodeForStudent(
  user: AuthUser,
  input: unknown,
  deps: SubmissionDeps = {},
): Promise<TestRunResponse> {
  const request = codeSubmissionRequestSchema.parse(input)
  const enrolled = await loadEnrolledCodeTask(user, request.assessmentId)
  const executor = deps.executor ?? executeSandbox

  const testCaseRows = await prisma.testCase.findMany({
    where: { codeTaskId: enrolled.codeTaskId },
    orderBy: { order: "asc" },
  })
  if (testCaseRows.length === 0) {
    throw new CodeEvalError(409, "This code task has no test cases yet.")
  }

  // Reserve the submission slot atomically. The cap is check-then-act, so a
  // plain count followed by a create lets two concurrent requests both pass the
  // check at the boundary and each cost a sandbox run. Locking the code task row
  // serializes reservations for the same task; the slot is committed before the
  // (expensive) container starts, and released only if the transaction rolls
  // back.
  const now = new Date()
  const reservation = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "CodeTask" WHERE "id" = ${enrolled.codeTaskId} FOR UPDATE`

    const existingRunCount = await tx.testRun.count({
      where: { codeTaskId: enrolled.codeTaskId, studentId: enrolled.studentId },
    })
    const eligibility = evaluateSubmissionEligibility({
      existingRunCount,
      maxSubmissions: enrolled.maxSubmissions,
      now,
      dueDate: enrolled.dueDate,
    })
    if (!eligibility.allowed) {
      throw new CodeEvalError(
        eligibility.code === "cap" ? 429 : 409,
        eligibility.reason ?? "Blocked.",
      )
    }

    const existingSubmission = await tx.submission.findUnique({
      where: {
        assessmentId_studentId: {
          assessmentId: enrolled.assessmentId,
          studentId: enrolled.studentId,
        },
      },
      select: { id: true, status: true },
    })
    if (existingSubmission?.status === "GRADED") {
      throw new CodeEvalError(409, "This submission has already been graded.")
    }

    const submission = await tx.submission.upsert({
      where: {
        assessmentId_studentId: {
          assessmentId: enrolled.assessmentId,
          studentId: enrolled.studentId,
        },
      },
      create: {
        assessmentId: enrolled.assessmentId,
        studentId: enrolled.studentId,
        status: "SUBMITTED",
        contentText: request.sourceCode,
        submittedAt: now,
      },
      update: {
        status: "RESUBMITTED",
        contentText: request.sourceCode,
        submittedAt: now,
      },
      select: { id: true },
    })

    const run = await tx.testRun.create({
      data: {
        codeTaskId: enrolled.codeTaskId,
        studentId: enrolled.studentId,
        submissionId: submission.id,
        status: "RUNNING",
        language: enrolled.language,
        sourceCode: request.sourceCode,
        queuedAt: now,
        startedAt: now,
      },
      select: { id: true },
    })

    return { runId: run.id }
  })

  const outcome = await executor({
    language: enrolled.language === "javascript" ? "javascript" : "python",
    source: request.sourceCode,
    tests: toHarnessTests(testCaseRows),
    timeLimitMs: enrolled.timeLimitMs,
    memoryLimitMb: enrolled.memoryLimitMb,
  })

  const harnessResults = parseHarnessOutput(outcome.stdout)
  const resultTestCases = testCaseRows.map((testCase) => ({
    id: testCase.id,
    name: testCase.name,
    description: testCase.description,
    category: testCase.category,
    points: Number(testCase.points),
  }))
  const results = buildTestResults(harnessResults, resultTestCases, {
    killedMessage: outcome.message ?? undefined,
  })
  const summary = summarizeResults(results)
  const status = resolveRunStatus({
    timedOut: outcome.timedOut,
    memoryExceeded: outcome.memoryExceeded,
    allPassed: summary.allPassed,
  })
  const coverage = computeCoverage(harnessResults.length, testCaseRows.length)

  const updated = await prisma.$transaction(async (tx) => {
    const saved = await tx.testRun.update({
      where: { id: reservation.runId },
      data: {
        status,
        passedCount: summary.passedCount,
        failedCount: summary.failedCount,
        totalCount: summary.totalCount,
        coverage,
        resultsJson: toRunEvidenceJson({
          results,
          timedOut: outcome.timedOut,
          memoryExceeded: outcome.memoryExceeded,
          killMessage: outcome.message,
        }) as unknown as Prisma.InputJsonValue,
        stdout: outcome.stdout.slice(0, 100_000),
        stderr: outcome.stderr.slice(0, 100_000),
        runtimeMs: outcome.wallClockMs,
        finishedAt: new Date(),
      },
    })
    await writeAuditLog(tx, {
      entityType: "TestRun",
      entityId: saved.id,
      action: "test_run.completed",
      actor: { id: user.id, role: user.role },
      after: {
        codeTaskId: enrolled.codeTaskId,
        status,
        passedCount: summary.passedCount,
        failedCount: summary.failedCount,
        totalCount: summary.totalCount,
        coverage,
        timedOut: outcome.timedOut,
        memoryExceeded: outcome.memoryExceeded,
      },
    })
    return saved
  })

  return serializeTestRun(updated, enrolled.assessmentId)
}

import { releasedAssessmentWhere } from "@/lib/assessment-visibility"
import {
  codeSubmissionRequestSchema,
  type StudentCodeTask,
  type TestRunResponse,
} from "@/lib/contracts/code-eval"
import type { Prisma } from "@/lib/generated/prisma/client"
import type { SubmissionStatus } from "@/lib/generated/prisma/enums"
import { writeAuditLog } from "@/lib/grading/audit"
import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"

import { loadEnrolledCodeTask, resolveStudentProfileId, type EnrolledCodeTask } from "./authz"
import { evaluateFatGateForStudent } from "@/lib/grading/offering-config-service"

import { CodeEvalError, SandboxUnavailableError } from "./errors"
import type { SandboxExecutor } from "./executor"
import { executeTestCases, type ExecutionResult } from "./execute"
import { evaluateSubmissionEligibility } from "./limits"
import { resolveDraftTestCaseIds, resolveMaxSubmissions } from "./metadata"
import { reapStuckRuns } from "./reaper"
import { runTimestamp, serializeStudentTestRun, toRunEvidenceJson } from "./serialize"
import { loadActiveTestCases } from "./test-cases"

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

/** The student's enrolled CODE tasks with their submission budget. */
export async function listStudentCodeTasks(user: AuthUser): Promise<StudentCodeTask[]> {
  const studentId = await resolveStudentProfileId(user)
  // A crashed process leaves a reserved run `RUNNING` forever; reap before reading so
  // the student is never shown a run that has been "still running" for days (SN-48).
  await reapStuckRuns()
  const assessments = await prisma.assessment.findMany({
    where: {
      type: "CODE",
      codeTask: { isNot: null },
      // Release governs visibility of the list too (SN-5). An unreleased code task shown here is
      // the same defect as the unreleased assessment the assessment list used to show.
      ...releasedAssessmentWhere(),
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
      select: { status: true, createdAt: true, startedAt: true, finishedAt: true },
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

    // Drafts are never run and never shown to students, so the count a student
    // reads must be the active cases only — otherwise the page promises cases
    // that no run will ever execute.
    const draftIds = resolveDraftTestCaseIds(codeTask.metadata)
    tasks.push({
      assessmentId: assessment.id,
      assessmentTitle: assessment.title,
      dueDate: assessment.dueDate.toISOString(),
      language: codeTask.language === "javascript" ? "javascript" : "python",
      instructions: codeTask.instructions,
      starterCode: codeTask.starterCode,
      testCaseCount: codeTask.testCases.filter((testCase) => !draftIds.has(testCase.id)).length,
      maxMarks: assessment.maxMarks,
      timeLimitMs: codeTask.timeLimitMs,
      memoryLimitMb: codeTask.memoryLimitMb,
      maxSubmissions,
      submissionsUsed: runs.length,
      canSubmit: eligibility.allowed,
      blockedReason: eligibility.reason,
      latestRunStatus: runs[0]?.status ?? null,
      // The run's own time, not the row's insert time: a backdated run made the
      // Task tab say it had run after it had finished (SN-40).
      latestRunAt: runs[0] ? runTimestamp(runs[0]).toISOString() : null,
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
      codeTask: { select: { id: true, assessmentId: true } },
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

/**
 * The current `TestCase` rows a run's student projection needs.
 *
 * Read at serialization time, not from the run's stored evidence: a teacher
 * un-hiding a case must reveal its detail on the next read, and a teacher hiding
 * one must suppress it even for a run whose evidence predates the change.
 */
async function loadVisibilityCases(codeTaskId: string) {
  return prisma.testCase.findMany({
    where: { codeTaskId },
    select: { id: true, input: true, expectedOutput: true, isHidden: true },
    orderBy: { order: "asc" },
  })
}

export async function getStudentRun(user: AuthUser, runId: string): Promise<TestRunResponse> {
  const { run, assessmentId } = await loadOwnedRun(user, runId)
  const testCases = await loadVisibilityCases(run.codeTaskId)
  return serializeStudentTestRun(run, assessmentId, testCases)
}

export async function listStudentRuns(
  user: AuthUser,
  assessmentId: string,
): Promise<TestRunResponse[]> {
  const enrolled = await loadEnrolledCodeTask(user, assessmentId)
  // The Runs tab is where "Still running" is shown, so reap before reading here too
  // (SN-48). A stuck row is reported as an interrupted run rather than an eternal one.
  await reapStuckRuns()
  const runs = await prisma.testRun.findMany({
    where: { codeTaskId: enrolled.codeTaskId, studentId: enrolled.studentId },
    orderBy: { createdAt: "desc" },
    take: 100,
  })
  const testCases = await loadVisibilityCases(enrolled.codeTaskId)
  return runs.map((run) => serializeStudentTestRun(run, enrolled.assessmentId, testCases))
}

/**
 * A committed submission reservation: the `TestRun` that will hold the evidence, the
 * `Submission` row it is attached to, and the submission's state **before** this request
 * touched it. The pre-state is what makes the reservation reversible: an unavailable sandbox
 * must not leave a consumed slot or an overwritten draft behind.
 */
type SubmissionReservation = {
  runId: string
  submissionId: string
  previousSubmission: {
    id: string
    status: SubmissionStatus
    contentText: string | null
    submittedAt: Date | null
  } | null
}

/**
 * Undo a reservation when the sandbox could not run.
 *
 * The slot is counted by the number of `TestRun` rows, so deleting the reserved run is what
 * returns the student's attempt. The submission is restored to exactly what it was: updated
 * back to its previous values if it existed, deleted if this request created it. Without this,
 * a Docker outage would silently consume a graded attempt and overwrite the student's previous
 * submission with code that never executed — the SN-27 defect.
 */
async function releaseReservation(reservation: SubmissionReservation): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.testRun.deleteMany({ where: { id: reservation.runId } })
    if (reservation.previousSubmission) {
      await tx.submission.update({
        where: { id: reservation.previousSubmission.id },
        data: {
          status: reservation.previousSubmission.status,
          contentText: reservation.previousSubmission.contentText,
          submittedAt: reservation.previousSubmission.submittedAt,
        },
      })
    } else {
      await tx.submission.deleteMany({ where: { id: reservation.submissionId } })
    }
  })
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

  /*
   * The FAT gate, for a code task that is a course's final assessment.
   *
   * Placed **before** the slot reservation, so a refused submission costs nothing: no row, and no
   * sandbox container. The same three narrowings as the quiz path apply, because they live in
   * `evaluateFatGateForStudent` — it refuses only a genuine below-minimum CAT score on the offering's
   * *resolved* FAT, and never on insufficient marking.
   */
  const fatGate = await evaluateFatGateForStudent({
    offeringId: enrolled.offeringId,
    assessmentId: enrolled.assessmentId,
    studentId: enrolled.studentId,
  })
  if (!fatGate.allowed) throw new CodeEvalError(403, fatGate.message)

  // Only active (non-draft) cases execute. Generated cases are model-authored and
  // unreviewed until a teacher publishes them, so running them would let an
  // unpublished draft decide a student's pass/fail — contradicting the teacher's
  // "Drafts are never run and never shown to students" promise.
  const testCaseRows = await loadActiveTestCases(enrolled.codeTaskId, enrolled.metadata)
  if (testCaseRows.length === 0) {
    throw new CodeEvalError(409, "This code task has no active test cases yet.")
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
      select: { id: true, status: true, contentText: true, submittedAt: true },
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

    return { runId: run.id, submissionId: submission.id, previousSubmission: existingSubmission }
  })

  let execution: ExecutionResult
  try {
    execution = await executeTestCases(
      {
        language: enrolled.language === "javascript" ? "javascript" : "python",
        source: request.sourceCode,
        testCases: testCaseRows.map((testCase) => ({
          id: testCase.id,
          name: testCase.name,
          description: testCase.description,
          category: testCase.category,
          input: testCase.input,
          expectedOutput: testCase.expectedOutput,
          points: Number(testCase.points),
          isHidden: testCase.isHidden,
        })),
        timeLimitMs: enrolled.timeLimitMs,
        memoryLimitMb: enrolled.memoryLimitMb,
      },
      { executor: deps.executor },
    )
  } catch (error) {
    /*
     * The sandbox could not run. Report it as unavailable (503) and give the student their slot
     * back, rather than persisting a `FAILED` run and returning `success: true` for code that
     * never executed. The shared executor classifies this as `SandboxUnavailableError` where the
     * condition is actually known — no string matching on the message.
     */
    if (error instanceof SandboxUnavailableError) await releaseReservation(reservation)
    throw error
  }

  const { results, summary, status, coverage } = execution

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
          timedOut: execution.timedOut,
          memoryExceeded: execution.memoryExceeded,
          killMessage: execution.killMessage,
        }) as unknown as Prisma.InputJsonValue,
        stdout: execution.stdout.slice(0, 100_000),
        stderr: execution.stderr.slice(0, 100_000),
        runtimeMs: execution.runtimeMs,
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
        timedOut: execution.timedOut,
        memoryExceeded: execution.memoryExceeded,
      },
    })
    return saved
  })

  // The student-facing projection strips hidden-case detail and the harness's
  // framing from stdout; the stored evidence keeps both for the teacher.
  return serializeStudentTestRun(updated, enrolled.assessmentId, testCaseRows)
}

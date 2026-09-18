import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  FREE_RUN_ENTITY_TYPE,
  HARNESS_RESULT_SENTINEL,
  getStudentRun,
  listStudentCodeTasks,
  runSamplesForStudent,
  submitCodeForStudent,
  type SandboxExecutor,
} from "@/lib/code-eval"
import type { AuthUser } from "@/lib/session"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * The Run/Submit split:
 *
 *  - the free **Run** executes visible sample cases only, persists nothing and
 *    consumes no cap slot (throttled instead);
 *  - **Submit** executes every active case, persists evidence, and its student
 *    payload reveals input/expected/actual for visible cases only;
 *  - **drafts** are never executed by either path.
 *
 * The executor is injected, so no Docker daemon is needed.
 */

function studentSession(user: { id: string; email: string }): AuthUser {
  return { id: user.id, email: user.email, role: "student" }
}

function passingExecutor(seen: string[][]): SandboxExecutor {
  return async (request) => {
    seen.push(request.tests.map((test) => test.id))
    const tests = request.tests.map((test) => ({
      id: test.id,
      passed: true,
      stdout: "observed output",
      stderr: "",
      message: "output matched",
      signal: null,
      durationMs: 2,
    }))
    return {
      kind: "completed",
      exitCode: 0,
      stdout: `${HARNESS_RESULT_SENTINEL}${JSON.stringify({ tests })}\n`,
      stderr: "",
      wallClockMs: 4,
      timedOut: false,
      memoryExceeded: false,
      outputLimitExceeded: false,
      message: null,
    }
  }
}

const VISIBLE_INPUT = "visible-input"
const VISIBLE_EXPECTED = "VISIBLE_OK_7"
const HIDDEN_INPUT = "hidden-input"
const HIDDEN_EXPECTED = "HIDDEN_SECRET_42"

async function createFixture(options: { maxSubmissions?: number; withDraft?: boolean } = {}) {
  const fixture = await createSpineFixture(prisma)
  const assessment = await prisma.assessment.create({
    data: {
      offeringId: fixture.offering.id,
      courseId: fixture.course.id,
      classId: fixture.classroom.id,
      title: "Run/submit exercise",
      type: "CODE",
      dueDate: new Date("2030-01-01T00:00:00.000Z"),
      maxMarks: 10,
      createdById: fixture.teacher.staffProfile!.id,
      releasedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  })

  const codeTask = await prisma.codeTask.create({
    data: {
      assessmentId: assessment.id,
      language: "python",
      instructions: "Print the value you were given.",
      timeLimitMs: 2_000,
      memoryLimitMb: 128,
      metadata: {
        generator: "code-eval",
        maxSubmissions: options.maxSubmissions ?? 5,
        draftTestCaseIds: [],
      },
    },
  })

  const visible = await prisma.testCase.create({
    data: {
      codeTaskId: codeTask.id,
      order: 0,
      name: "Visible sample",
      description: "Shown to students",
      category: "input-output",
      input: VISIBLE_INPUT,
      expectedOutput: VISIBLE_EXPECTED,
      points: 2,
      isHidden: false,
    },
  })
  const hidden = await prisma.testCase.create({
    data: {
      codeTaskId: codeTask.id,
      order: 1,
      name: "Hidden graded case",
      description: "Never shown to students",
      category: "input-output",
      input: HIDDEN_INPUT,
      expectedOutput: HIDDEN_EXPECTED,
      points: 3,
      isHidden: true,
    },
  })

  let draft: { id: string } | null = null
  if (options.withDraft) {
    // A draft that is deliberately *visible*: the active-only filter must exclude
    // it on its own, independent of `isHidden`.
    const created = await prisma.testCase.create({
      data: {
        codeTaskId: codeTask.id,
        order: 2,
        name: "Unpublished draft",
        category: "input-output",
        input: "draft-input",
        expectedOutput: "DRAFT_SECRET",
        points: 5,
        isHidden: false,
      },
    })
    draft = created
    await prisma.codeTask.update({
      where: { id: codeTask.id },
      data: {
        metadata: {
          generator: "code-eval",
          maxSubmissions: options.maxSubmissions ?? 5,
          draftTestCaseIds: [created.id],
        },
      },
    })
  }

  await prisma.enrollment.create({
    data: { studentId: fixture.student.studentProfile!.id, offeringId: fixture.offering.id },
  })

  return { fixture, assessment, codeTask, visible, hidden, draft }
}

const SOURCE = "print(input())"

describe("free sample Run", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterEach(() => {
    delete process.env.CODE_FREE_RUN_MAX_PER_WINDOW
    delete process.env.CODE_FREE_RUN_WINDOW_SECONDS
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("executes visible samples only and persists no TestRun, Submission or cap slot", async () => {
    const { fixture, assessment, codeTask, visible, draft } = await createFixture({
      withDraft: true,
    })
    const student = studentSession(fixture.student)
    const seen: string[][] = []

    const result = await runSamplesForStudent(
      student,
      { assessmentId: assessment.id, sourceCode: SOURCE },
      { executor: passingExecutor(seen) },
    )

    // Only the visible, active case reached the sandbox.
    expect(seen).toEqual([[visible.id]])
    expect(result.totalCount).toBe(1)
    expect(result.passedCount).toBe(1)
    expect(result.sampleCount).toBe(1)
    expect(result.hiddenCount).toBe(1)
    expect(result.results.map((entry) => entry.testCaseId)).toEqual([visible.id])
    expect(result.results[0]).toMatchObject({
      isHidden: false,
      input: VISIBLE_INPUT,
      expectedOutput: VISIBLE_EXPECTED,
      actualOutput: "observed output",
    })

    // Nothing that counts was written.
    expect(await prisma.testRun.count({ where: { codeTaskId: codeTask.id } })).toBe(0)
    expect(await prisma.submission.count({ where: { assessmentId: assessment.id } })).toBe(0)

    // The cap is untouched, and the draft is nowhere in the payload.
    const tasks = await listStudentCodeTasks(student)
    const task = tasks.find((entry) => entry.assessmentId === assessment.id)
    expect(task?.submissionsUsed).toBe(0)
    expect(task?.canSubmit).toBe(true)
    expect(task?.testCaseCount).toBe(2)
    expect(JSON.stringify(result)).not.toContain("DRAFT_SECRET")
    expect(JSON.stringify(result)).not.toContain(HIDDEN_EXPECTED)

    // The only write a free run makes is its throttle marker in the shared store.
    expect(await prisma.auditLog.count({ where: { entityType: FREE_RUN_ENTITY_TYPE } })).toBe(1)
    expect(await prisma.auditLog.count({ where: { entityType: "TestRun" } })).toBe(0)
    // `draft` is referenced so a future fixture change cannot silently drop it.
    expect(draft).not.toBeNull()

    // The slot really is intact: a later Submit is still the student's first.
    const submitted = await submitCodeForStudent(
      student,
      { assessmentId: assessment.id, sourceCode: SOURCE },
      { executor: passingExecutor([]) },
    )
    expect(submitted.status).toBe("PASSED")
    const after = await listStudentCodeTasks(student)
    expect(after.find((entry) => entry.assessmentId === assessment.id)?.submissionsUsed).toBe(1)
  })

  it("enforces isHidden on the Submit payload while keeping the pass/fail count", async () => {
    const { fixture, assessment } = await createFixture()
    const student = studentSession(fixture.student)

    const run = await submitCodeForStudent(
      student,
      { assessmentId: assessment.id, sourceCode: SOURCE },
      { executor: passingExecutor([]) },
    )

    // Both active cases ran: Submit is unchanged in *scope* (hidden cases still
    // count), only in what detail it returns.
    expect(run.totalCount).toBe(2)
    expect(run.passedCount).toBe(2)

    const visible = run.results.find((entry) => entry.name === "Visible sample")
    expect(visible).toMatchObject({
      isHidden: false,
      input: VISIBLE_INPUT,
      expectedOutput: VISIBLE_EXPECTED,
      actualOutput: "observed output",
    })

    const hidden = run.results.find((entry) => entry.name === "Hidden graded case")
    expect(hidden).toMatchObject({
      passed: true,
      isHidden: true,
      input: null,
      expectedOutput: null,
      actualOutput: null,
      stdout: "",
      stderr: "",
      message: "",
    })

    // The hidden case's expected output must not appear anywhere in the payload.
    expect(JSON.stringify(run)).not.toContain(HIDDEN_EXPECTED)
    expect(JSON.stringify(run)).not.toContain(HIDDEN_INPUT)
    // And the harness's own result line is stripped from the student's stdout.
    expect(run.stdout ?? "").not.toContain(HARNESS_RESULT_SENTINEL)

    // Teacher evidence keeps the raw stream; the student read applies the same rule.
    const stored = await prisma.testRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(stored.stdout ?? "").toContain(HARNESS_RESULT_SENTINEL)

    const reread = await getStudentRun(student, run.id)
    const rereadHidden = reread.results.find((entry) => entry.name === "Hidden graded case")
    expect(rereadHidden?.expectedOutput).toBeNull()
    expect(JSON.stringify(reread)).not.toContain(HIDDEN_EXPECTED)
  })

  it("never executes a draft, on either path", async () => {
    const { fixture, assessment, codeTask, visible, hidden, draft } = await createFixture({
      withDraft: true,
    })
    const student = studentSession(fixture.student)
    const submitSeen: string[][] = []

    const run = await submitCodeForStudent(
      student,
      { assessmentId: assessment.id, sourceCode: SOURCE },
      { executor: passingExecutor(submitSeen) },
    )

    expect(submitSeen).toEqual([[visible.id, hidden.id]])
    expect(run.totalCount).toBe(2)
    expect(run.results.map((entry) => entry.testCaseId)).not.toContain(draft!.id)
    expect(JSON.stringify(run)).not.toContain("DRAFT_SECRET")

    const sampleSeen: string[][] = []
    await runSamplesForStudent(
      student,
      { assessmentId: assessment.id, sourceCode: SOURCE },
      { executor: passingExecutor(sampleSeen) },
    )
    expect(sampleSeen).toEqual([[visible.id]])

    expect(await prisma.testRun.count({ where: { codeTaskId: codeTask.id } })).toBe(1)
  })

  it("throttles free runs with a database-backed window", async () => {
    process.env.CODE_FREE_RUN_MAX_PER_WINDOW = "2"
    process.env.CODE_FREE_RUN_WINDOW_SECONDS = "60"
    const { fixture, assessment, codeTask } = await createFixture()
    const student = studentSession(fixture.student)

    const first = await runSamplesForStudent(
      student,
      { assessmentId: assessment.id, sourceCode: SOURCE },
      { executor: passingExecutor([]) },
    )
    expect(first.totalCount).toBe(1)

    await runSamplesForStudent(
      student,
      { assessmentId: assessment.id, sourceCode: SOURCE },
      { executor: passingExecutor([]) },
    )

    await expect(
      runSamplesForStudent(
        student,
        { assessmentId: assessment.id, sourceCode: SOURCE },
        { executor: passingExecutor([]) },
      ),
    ).rejects.toMatchObject({ status: 429 })

    // Two attempts were recorded; the third never reached the sandbox.
    expect(await prisma.auditLog.count({ where: { entityType: FREE_RUN_ENTITY_TYPE } })).toBe(2)
    expect(await prisma.testRun.count({ where: { codeTaskId: codeTask.id } })).toBe(0)
  })
})

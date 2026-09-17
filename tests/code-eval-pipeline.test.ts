import { afterAll, beforeEach, describe, expect, it } from "vitest"

import type { AuthUser } from "@/lib/session"
import { HARNESS_RESULT_SENTINEL, type SandboxExecutor } from "@/lib/code-eval"
import { createMockProvider } from "@/lib/llm"
import {
  generateTestCaseDraftsForTeacher,
  getCodeTaskForTeacher,
  getStudentRun,
  listRunsForTeacher,
  listSimilarityForTeacher,
  listStudentCodeTasks,
  listStudentRuns,
  publishGeneratedTestCasesForTeacher,
  scanCohortSimilarityForTeacher,
  setSimilarityVerdictForTeacher,
  submitCodeForStudent,
} from "@/lib/code-eval"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * Database-backed pipeline coverage for code evaluation.
 *
 * The sandbox executor is injected, so these tests exercise the real service,
 * authorization, persistence, submission caps, draft generation, and similarity
 * scanning WITHOUT Docker. The real container behaviour is proven separately in
 * `code-eval-docker.test.ts` (which skips without a daemon).
 */

function teacherSession(user: { id: string; email: string }): AuthUser {
  return { id: user.id, email: user.email, role: "teacher" }
}

function studentSession(user: { id: string; email: string }): AuthUser {
  return { id: user.id, email: user.email, role: "student" }
}

const PASSING_SOURCE = "value = int(input())\nprint(value)"

function passingExecutor(): SandboxExecutor {
  return async (request) => {
    const tests = request.tests.map((test) => ({
      id: test.id,
      passed: true,
      stdout: "ok",
      stderr: "",
      message: "output matched",
      signal: null,
      durationMs: 1,
    }))
    return {
      kind: "completed",
      exitCode: 0,
      stdout: `${HARNESS_RESULT_SENTINEL}${JSON.stringify({ tests })}\n`,
      stderr: "",
      wallClockMs: 3,
      timedOut: false,
      memoryExceeded: false,
      outputLimitExceeded: false,
      message: null,
    }
  }
}

/** The executor's real "Docker is down" outcome, injected so no daemon is needed. */
function unavailableExecutor(): SandboxExecutor {
  return async () => ({
    kind: "unavailable",
    exitCode: null,
    stdout: "",
    stderr: "",
    wallClockMs: 0,
    timedOut: false,
    memoryExceeded: false,
    outputLimitExceeded: false,
    message: "Sandbox unavailable: The docker daemon is not reachable.",
  })
}

async function createCodeFixture(options: { maxSubmissions?: number; dueDate?: Date } = {}) {
  const fixture = await createSpineFixture(prisma)
  const dueDate = options.dueDate ?? new Date("2030-01-01T00:00:00.000Z")

  // Released: this is the assessment students submit to via `submitCodeForStudent` and read via
  // `listStudentCodeTasks`/`listStudentRuns`, all of which now scope on release. Leaving it
  // unreleased encoded the SN-5 bug in the fixture.
  const assessment = await prisma.assessment.create({
    data: {
      offeringId: fixture.offering.id,
      courseId: fixture.course.id,
      classId: fixture.classroom.id,
      title: "Sorting exercise",
      type: "CODE",
      dueDate,
      maxMarks: 10,
      createdById: fixture.teacher.staffProfile!.id,
      releasedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  })

  const codeTask = await prisma.codeTask.create({
    data: {
      assessmentId: assessment.id,
      language: "python",
      instructions: "Read an integer and print it.",
      starterCode: "value = int(input())",
      timeLimitMs: 2_000,
      memoryLimitMb: 128,
      metadata: {
        generator: "code-eval",
        maxSubmissions: options.maxSubmissions ?? 5,
        draftTestCaseIds: [],
      },
    },
  })

  const firstTest = await prisma.testCase.create({
    data: {
      codeTaskId: codeTask.id,
      order: 0,
      name: "Echoes the input",
      category: "input-output",
      input: "7\n",
      expectedOutput: "7\n",
      points: 2,
      isHidden: false,
    },
  })
  const secondTest = await prisma.testCase.create({
    data: {
      codeTaskId: codeTask.id,
      order: 1,
      name: "Uses print",
      category: "structure",
      input: JSON.stringify({ mustContain: ["print"] }),
      expectedOutput: null,
      points: 1,
      isHidden: true,
    },
  })

  await prisma.enrollment.create({
    data: { studentId: fixture.student.studentProfile!.id, offeringId: fixture.offering.id },
  })

  return { fixture, assessment, codeTask, firstTest, secondTest }
}

async function createOtherTeacher(): Promise<AuthUser> {
  const user = await prisma.user.create({
    data: {
      email: "other-code-teacher@test.local",
      passwordHash: "test-only-not-a-real-hash",
      role: "TEACHER",
      staffProfile: { create: { fullName: "Olive Other", empId: "EMP-CODE-OTHER" } },
    },
  })
  return teacherSession(user)
}

async function createEnrolledStudent(
  fixture: Awaited<ReturnType<typeof createSpineFixture>>,
  email: string,
) {
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: "test-only-not-a-real-hash",
      role: "STUDENT",
      studentProfile: {
        create: { fullName: `Student ${email}`, registerNumber: `REG-${email}` },
      },
    },
    include: { studentProfile: true },
  })
  await prisma.enrollment.create({
    data: { studentId: user.studentProfile!.id, offeringId: fixture.offering.id },
  })
  return { user: studentSession(user), profileId: user.studentProfile!.id }
}

describe("code evaluation pipeline", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("persists per-test evidence and never publishes a grade", async () => {
    const { fixture, assessment } = await createCodeFixture()
    const student = studentSession(fixture.student)

    const run = await submitCodeForStudent(
      student,
      { assessmentId: assessment.id, sourceCode: PASSING_SOURCE },
      { executor: passingExecutor() },
    )

    expect(run.status).toBe("PASSED")
    expect(run.passedCount).toBe(2)
    expect(run.totalCount).toBe(2)
    expect(run.earnedPoints).toBe(3)
    expect(run.maxPoints).toBe(3)
    expect(run.results.map((result) => result.category)).toEqual(["input-output", "structure"])
    expect(run.results.every((result) => result.passed)).toBe(true)

    const stored = await prisma.testRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(stored.resultsJson).toBeTruthy()
    expect(stored.passedCount).toBe(2)

    const submission = await prisma.submission.findUnique({
      where: {
        assessmentId_studentId: {
          assessmentId: assessment.id,
          studentId: fixture.student.studentProfile!.id,
        },
      },
    })
    expect(submission?.status).toBe("SUBMITTED")
    expect(submission?.contentText).toBe(PASSING_SOURCE)

    const audits = await prisma.auditLog.count({
      where: { entityType: "TestRun", action: "test_run.completed" },
    })
    expect(audits).toBe(1)

    // The hard product rule: a TestRun is evidence, never a published grade.
    expect(await prisma.grade.count()).toBe(0)
    expect(await prisma.gradeReview.count()).toBe(0)
  })

  it("enforces the submission cap server-side before running the sandbox", async () => {
    const { fixture, assessment } = await createCodeFixture({ maxSubmissions: 1 })
    const student = studentSession(fixture.student)
    let calls = 0
    const executor: SandboxExecutor = async (request) => {
      calls += 1
      return passingExecutor()(request)
    }

    const first = await submitCodeForStudent(
      student,
      { assessmentId: assessment.id, sourceCode: PASSING_SOURCE },
      { executor },
    )
    expect(first.status).toBe("PASSED")

    await expect(
      submitCodeForStudent(
        student,
        { assessmentId: assessment.id, sourceCode: PASSING_SOURCE },
        { executor },
      ),
    ).rejects.toMatchObject({ status: 429 })
    expect(calls).toBe(1)

    const tasks = await listStudentCodeTasks(student)
    const task = tasks.find((entry) => entry.assessmentId === assessment.id)
    expect(task?.canSubmit).toBe(false)
    expect(task?.submissionsUsed).toBe(1)
    expect(task?.maxSubmissions).toBe(1)
  })

  it("rejects a submission after the deadline without calling the sandbox", async () => {
    const { fixture, assessment } = await createCodeFixture({
      dueDate: new Date("2020-01-01T00:00:00.000Z"),
    })
    const student = studentSession(fixture.student)
    let calls = 0
    const executor: SandboxExecutor = async (request) => {
      calls += 1
      return passingExecutor()(request)
    }

    await expect(
      submitCodeForStudent(
        student,
        { assessmentId: assessment.id, sourceCode: PASSING_SOURCE },
        { executor },
      ),
    ).rejects.toMatchObject({ status: 409 })
    expect(calls).toBe(0)
  })

  it("denies a non-enrolled student and a teacher on the student service", async () => {
    const { fixture, assessment } = await createCodeFixture()

    const outsider = await prisma.user.create({
      data: {
        email: "outsider@test.local",
        passwordHash: "test-only-not-a-real-hash",
        role: "STUDENT",
        studentProfile: { create: { fullName: "Out Sider", registerNumber: "REG-OUTSIDER" } },
      },
    })

    await expect(
      submitCodeForStudent(
        studentSession(outsider),
        { assessmentId: assessment.id, sourceCode: PASSING_SOURCE },
        { executor: passingExecutor() },
      ),
    ).rejects.toMatchObject({ status: 403 })

    await expect(
      submitCodeForStudent(
        teacherSession(fixture.teacher),
        { assessmentId: assessment.id, sourceCode: PASSING_SOURCE },
        { executor: passingExecutor() },
      ),
    ).rejects.toMatchObject({ status: 403 })
  })

  it("never lets a student read another student's run", async () => {
    const { fixture, assessment } = await createCodeFixture()
    const owner = studentSession(fixture.student)

    const run = await submitCodeForStudent(
      owner,
      { assessmentId: assessment.id, sourceCode: PASSING_SOURCE },
      { executor: passingExecutor() },
    )

    const other = await createEnrolledStudent(fixture, "other-student@test.local")
    await expect(getStudentRun(other.user, run.id)).rejects.toMatchObject({ status: 404 })
    await expect(listStudentRuns(other.user, assessment.id)).resolves.toEqual([])

    // The owner still sees their own run.
    const own = await getStudentRun(owner, run.id)
    expect(own.id).toBe(run.id)
  })

  it("denies a non-owner teacher the task, runs, and similarity, and a student everything", async () => {
    const { fixture, assessment } = await createCodeFixture()
    const owner = teacherSession(fixture.teacher)
    await submitCodeForStudent(
      studentSession(fixture.student),
      { assessmentId: assessment.id, sourceCode: PASSING_SOURCE },
      { executor: passingExecutor() },
    )

    const otherTeacher = await createOtherTeacher()
    await expect(getCodeTaskForTeacher(otherTeacher, assessment.id)).rejects.toMatchObject({
      status: 403,
    })
    await expect(listRunsForTeacher(otherTeacher, assessment.id)).rejects.toMatchObject({
      status: 403,
    })
    await expect(listSimilarityForTeacher(otherTeacher, assessment.id)).rejects.toMatchObject({
      status: 403,
    })

    const student = studentSession(fixture.student)
    await expect(listRunsForTeacher(student, assessment.id)).rejects.toMatchObject({ status: 403 })
    await expect(getCodeTaskForTeacher(student, assessment.id)).rejects.toMatchObject({
      status: 403,
    })

    // The owner sees the run evidence.
    const runs = await listRunsForTeacher(owner, assessment.id)
    expect(runs).toHaveLength(1)
    expect(runs[0].studentName).toBe(fixture.student.studentProfile!.fullName)
  })

  it("generates deterministic draft test cases and requires a publish action", async () => {
    const { fixture, assessment } = await createCodeFixture()
    const teacher = teacherSession(fixture.teacher)
    const provider = createMockProvider()

    const first = await generateTestCaseDraftsForTeacher(
      teacher,
      assessment.id,
      { count: 3, focus: "input handling" },
      { provider },
    )
    expect(first).toHaveLength(3)
    expect(first.every((testCase) => testCase.status === "draft")).toBe(true)

    const second = await generateTestCaseDraftsForTeacher(
      teacher,
      assessment.id,
      { count: 3, focus: "input handling" },
      { provider },
    )
    expect(second.map((testCase) => testCase.name)).toEqual(first.map((testCase) => testCase.name))

    const detail = await getCodeTaskForTeacher(teacher, assessment.id)
    expect(detail.task.draftTestCaseCount).toBe(6)

    const published = await publishGeneratedTestCasesForTeacher(teacher, assessment.id, {
      testCaseIds: first.map((testCase) => testCase.id),
    })
    expect(published.published).toHaveLength(3)
    expect(published.alreadyActive).toEqual([])

    const after = await getCodeTaskForTeacher(teacher, assessment.id)
    expect(after.task.draftTestCaseCount).toBe(3)
    const publishedCase = after.testCases.find((testCase) => testCase.id === first[0].id)
    expect(publishedCase?.status).toBe("active")

    // Publishing only drafts is rejected once nothing remains.
    await expect(
      publishGeneratedTestCasesForTeacher(teacher, assessment.id, {
        testCaseIds: first.map((testCase) => testCase.id),
      }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it("flags a similar cohort pair, never decides, and records a human verdict", async () => {
    const { fixture, assessment, codeTask } = await createCodeFixture()

    const similarA = `def add(a, b):\n    total = a + b\n    return total\n\ndef average(values):\n    result = add(sum(values), 0) / len(values)\n    return result\n`
    const similarB = `# a second student\n` + similarA.replace("total = a + b", "total=a+b")
    const different = `def sort_values(values):\n    items = list(values)\n    for i in range(len(items)):\n        for j in range(len(items) - 1 - i):\n            if items[j] > items[j + 1]:\n                items[j], items[j + 1] = items[j + 1], items[j]\n    return items\n`

    const owner = studentSession(fixture.student)
    const b = await createEnrolledStudent(fixture, "similar-b@test.local")
    const c = await createEnrolledStudent(fixture, "different-c@test.local")

    const sources = [similarA, similarB, different]
    const studentIds = [fixture.student.studentProfile!.id, b.profileId, c.profileId]
    for (let index = 0; index < studentIds.length; index += 1) {
      await prisma.testRun.create({
        data: {
          codeTaskId: codeTask.id,
          studentId: studentIds[index],
          status: "PASSED",
          language: "python",
          sourceCode: sources[index],
        },
      })
    }

    const teacher = teacherSession(fixture.teacher)
    const scan = await scanCohortSimilarityForTeacher(teacher, assessment.id, {})
    expect(scan.pairs).toHaveLength(3)

    const flagged = scan.pairs.filter((pair) => pair.verdict === "FLAGGED")
    expect(flagged).toHaveLength(1)
    expect(flagged[0].similarity).toBeGreaterThanOrEqual(0.8)
    const flaggedIds = [flagged[0].studentId, flagged[0].comparedStudentId].sort()
    expect(flaggedIds).toEqual([fixture.student.studentProfile!.id, b.profileId].sort())

    // Humans can clear a flagged pair; the flag never decides a grade.
    const cleared = await setSimilarityVerdictForTeacher(teacher, assessment.id, flagged[0].id, {
      verdict: "CLEARED",
    })
    expect(cleared.verdict).toBe("CLEARED")

    // A re-scan recomputes the score; it must not discard the human verdict (TN-48).
    const rescan = await scanCohortSimilarityForTeacher(teacher, assessment.id, {})
    expect(rescan.pairs.find((pair) => pair.id === flagged[0].id)?.verdict).toBe("CLEARED")

    expect(await prisma.grade.count()).toBe(0)

    // A student cannot read the similarity report at all.
    await expect(listSimilarityForTeacher(owner, assessment.id)).rejects.toMatchObject({
      status: 403,
    })
  })

  it("reports an unavailable sandbox as 503 and does not consume the attempt (SN-27)", async () => {
    const { fixture, assessment, codeTask } = await createCodeFixture({ maxSubmissions: 1 })
    const student = studentSession(fixture.student)

    await expect(
      submitCodeForStudent(
        student,
        { assessmentId: assessment.id, sourceCode: PASSING_SOURCE },
        { executor: unavailableExecutor() },
      ),
    ).rejects.toMatchObject({ status: 503 })

    // Nothing was persisted, so no slot was burned and no FAILED run misrepresents the outage.
    expect(await prisma.testRun.count({ where: { codeTaskId: codeTask.id } })).toBe(0)
    expect(await prisma.submission.count({ where: { assessmentId: assessment.id } })).toBe(0)
    const before = await listStudentCodeTasks(student)
    expect(before.find((task) => task.assessmentId === assessment.id)?.submissionsUsed).toBe(0)

    // The slot really is intact: a later working submission is the student's first.
    const run = await submitCodeForStudent(
      student,
      { assessmentId: assessment.id, sourceCode: PASSING_SOURCE },
      { executor: passingExecutor() },
    )
    expect(run.status).toBe("PASSED")
    const after = await listStudentCodeTasks(student)
    expect(after.find((task) => task.assessmentId === assessment.id)?.submissionsUsed).toBe(1)
  })

  it("restores a pre-existing submission when the sandbox is unavailable (SN-27)", async () => {
    const { fixture, assessment, codeTask } = await createCodeFixture({ maxSubmissions: 3 })
    const student = studentSession(fixture.student)
    await prisma.submission.create({
      data: {
        assessmentId: assessment.id,
        studentId: fixture.student.studentProfile!.id,
        status: "DRAFT",
        contentText: "my saved draft",
      },
    })

    await expect(
      submitCodeForStudent(
        student,
        { assessmentId: assessment.id, sourceCode: "raise RuntimeError('boom')" },
        { executor: unavailableExecutor() },
      ),
    ).rejects.toMatchObject({ status: 503 })

    // The draft is not overwritten by code that never ran, and no run row was left behind.
    const submission = await prisma.submission.findUniqueOrThrow({
      where: {
        assessmentId_studentId: {
          assessmentId: assessment.id,
          studentId: fixture.student.studentProfile!.id,
        },
      },
    })
    expect(submission.status).toBe("DRAFT")
    expect(submission.contentText).toBe("my saved draft")
    expect(await prisma.testRun.count({ where: { codeTaskId: codeTask.id } })).toBe(0)
  })
})

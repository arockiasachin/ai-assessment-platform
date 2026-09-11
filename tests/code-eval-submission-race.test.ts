import { afterAll, beforeEach, describe, expect, it } from "vitest"

import {
  HARNESS_RESULT_SENTINEL,
  submitCodeForStudent,
  type SandboxExecutor,
} from "@/lib/code-eval"
import type { AuthUser } from "@/lib/session"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * Submission-cap race regression for code evaluation.
 *
 * The cap is enforced by counting existing runs and then creating a new one as
 * two separate statements. Two concurrent submissions at the cap boundary would
 * both pass the check, exceed `maxSubmissions`, and each cost a sandbox run. The
 * service must reserve the slot atomically so at most `maxSubmissions` executors
 * are ever invoked, however many requests arrive at once.
 */

function studentSession(user: { id: string; email: string }): AuthUser {
  return { id: user.id, email: user.email, role: "student" }
}

function fakeExecutor(counter: { calls: number }, delayMs: number): SandboxExecutor {
  return async (request) => {
    counter.calls += 1
    await new Promise((resolve) => setTimeout(resolve, delayMs))
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
      wallClockMs: 1,
      timedOut: false,
      memoryExceeded: false,
      outputLimitExceeded: false,
      message: null,
    }
  }
}

async function createCodeFixture(maxSubmissions: number) {
  const fixture = await createSpineFixture(prisma)
  const assessment = await prisma.assessment.create({
    data: {
      offeringId: fixture.offering.id,
      courseId: fixture.course.id,
      classId: fixture.classroom.id,
      title: "Race exercise",
      type: "CODE",
      dueDate: new Date("2030-01-01T00:00:00.000Z"),
      maxMarks: 10,
      createdById: fixture.teacher.staffProfile!.id,
    },
  })
  const codeTask = await prisma.codeTask.create({
    data: {
      assessmentId: assessment.id,
      language: "python",
      instructions: "Print the input.",
      timeLimitMs: 2_000,
      memoryLimitMb: 128,
      metadata: { generator: "code-eval", maxSubmissions, draftTestCaseIds: [] },
    },
  })

  await prisma.testCase.create({
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
  await prisma.enrollment.create({
    data: {
      studentId: fixture.student.studentProfile!.id,
      offeringId: fixture.offering.id,
      status: "active",
    },
  })
  return { fixture, assessment, codeTask }
}

describe("code submission cap race", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("runs at most maxSubmissions executors under concurrent submissions", async () => {
    const { fixture, assessment, codeTask } = await createCodeFixture(1)
    const student = studentSession(fixture.student)
    const counter = { calls: 0 }
    const executor = fakeExecutor(counter, 150)

    const results = await Promise.allSettled([
      submitCodeForStudent(
        student,
        { assessmentId: assessment.id, sourceCode: "value = int(input())\nprint(value)" },
        { executor },
      ),
      submitCodeForStudent(
        student,
        { assessmentId: assessment.id, sourceCode: "value = int(input())\nprint(value)" },
        { executor },
      ),
    ])

    const fulfilled = results.filter((result) => result.status === "fulfilled")
    const rejected = results.filter((result) => result.status === "rejected")

    expect(counter.calls).toBeLessThanOrEqual(1)
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ status: 429 })

    const runs = await prisma.testRun.count({ where: { codeTaskId: codeTask.id } })
    expect(runs).toBe(1)
  })
})

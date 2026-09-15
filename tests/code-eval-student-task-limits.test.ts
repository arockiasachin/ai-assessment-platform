import { afterAll, beforeEach, describe, expect, it } from "vitest"

import { listStudentCodeTasks } from "@/lib/code-eval"
import { studentCodeTaskListResponseSchema } from "@/lib/contracts/code-eval"
import type { AuthUser } from "@/lib/session"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * The student's own code task must state what the task is worth and the limits a
 * run is killed at. Before this contract extension those three fields were not on
 * `StudentCodeTask`, so a student page could not render "25 points" or
 * "5s · 256 MB" without inventing them.
 */

function studentSession(user: { id: string; email: string }): AuthUser {
  return { id: user.id, email: user.email, role: "student" }
}

describe("student code task contract", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("carries the assessment's maxMarks and the task's sandbox limits", async () => {
    const fixture = await createSpineFixture(prisma)

    const assessment = await prisma.assessment.create({
      data: {
        offeringId: fixture.offering.id,
        courseId: fixture.course.id,
        classId: fixture.classroom.id,
        title: "Limits exercise",
        type: "CODE",
        dueDate: new Date("2030-01-01T00:00:00.000Z"),
        maxMarks: 25,
        createdById: fixture.teacher.staffProfile!.id,
      },
    })

    await prisma.codeTask.create({
      data: {
        assessmentId: assessment.id,
        language: "python",
        timeLimitMs: 5_000,
        memoryLimitMb: 256,
        metadata: { generator: "code-eval", maxSubmissions: 3, draftTestCaseIds: [] },
      },
    })

    await prisma.enrollment.create({
      data: { studentId: fixture.student.studentProfile!.id, offeringId: fixture.offering.id },
    })

    const tasks = await listStudentCodeTasks(studentSession(fixture.student))
    const task = tasks.find((entry) => entry.assessmentId === assessment.id)

    expect(task?.maxMarks).toBe(25)
    expect(task?.timeLimitMs).toBe(5_000)
    expect(task?.memoryLimitMb).toBe(256)

    // The published response shape accepts exactly what the service returns.
    const parsed = studentCodeTaskListResponseSchema.safeParse({ success: true, tasks })
    expect(parsed.success).toBe(true)
  })
})

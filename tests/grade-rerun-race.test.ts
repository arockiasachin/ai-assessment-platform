import { afterAll, beforeEach, describe, expect, it } from "vitest"

import { applyManualMark, recordAiSuggestion } from "@/lib/grading/review-service"
import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The model re-run and a teacher's manual mark can overlap. `recordAiSuggestion`
 * must re-check `publishedAt` at write time, not just when it read the row, or
 * an uncommitted manual mark (invisible to its first read) is overwritten when
 * the conflicting insert resolves.
 */
describe("grade re-run race with a manual mark", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("never overwrites a manual published mark that commits during the run", async () => {
    const f = await createSpineFixture(prisma)
    const studentId = f.student.studentProfile!.id
    await prisma.enrollment.create({
      data: { studentId, offeringId: f.offering.id, status: "active" },
    })

    // Hold an uncommitted manual mark open, then run grading on another
    // connection. The run's first read cannot see the uncommitted row, so it
    // proceeds to upsert and blocks on the unique key until the mark commits.
    const manual = prisma.$transaction(async (tx) => {
      await applyManualMark(tx, {
        assessmentId: f.assessment.id,
        studentId,
        points: 12,
        maxPoints: f.assessment.maxMarks,
        actor: { id: f.teacher.id, role: "teacher" },
      })
      await sleep(1000)
    })

    await sleep(200)
    await recordAiSuggestion(
      {
        assessmentId: f.assessment.id,
        studentId,
        suggestedPoints: 20,
        rationale: "Re-run while the teacher was saving.",
        confidence: 0.9,
        model: "mock",
        promptVersion: "v1",
        latencyMs: 5,
      },
      { id: "ai", role: "system" },
    )
    await manual

    const grade = await prisma.grade.findUniqueOrThrow({
      where: { assessmentId_studentId: { assessmentId: f.assessment.id, studentId } },
    })
    expect(Number(grade.points)).toBe(12)
    expect(grade.source).toBe("TEACHER_OVERRIDE")
    expect(grade.publishedAt).not.toBeNull()
  })
})

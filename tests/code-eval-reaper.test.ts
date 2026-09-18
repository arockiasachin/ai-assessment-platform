import { afterAll, beforeEach, describe, expect, it } from "vitest"

import { STUCK_RUN_GRACE_MS, STUCK_RUN_MESSAGE, reapStuckRuns } from "@/lib/code-eval/reaper"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * Stuck-run reaper.
 *
 * The submit pipeline reserves a `RUNNING` row, then fills it in a second
 * transaction. A crash between them left the row "Still running" forever (SN-48);
 * the reaper turns anything older than a plausible sandbox run into an `ERROR`
 * with a finish time, and leaves a genuinely in-flight run alone.
 */

async function runFixture() {
  const fixture = await createSpineFixture(prisma)
  const assessment = await prisma.assessment.create({
    data: {
      offeringId: fixture.offering.id,
      courseId: fixture.course.id,
      classId: fixture.classroom.id,
      title: "Reaper exercise",
      type: "CODE",
      dueDate: new Date("2030-01-01T00:00:00.000Z"),
      maxMarks: 30,
      createdById: fixture.teacher.staffProfile!.id,
      releasedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  })
  const codeTask = await prisma.codeTask.create({
    data: {
      assessmentId: assessment.id,
      language: "python",
      timeLimitMs: 5_000,
      memoryLimitMb: 256,
      metadata: { generator: "code-eval", maxSubmissions: 3, draftTestCaseIds: [] },
    },
  })
  return { studentId: fixture.student.studentProfile!.id, codeTaskId: codeTask.id }
}

describe("reapStuckRuns", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("marks a stale RUNNING run as ERROR and gives it a finish time", async () => {
    const { studentId, codeTaskId } = await runFixture()
    const run = await prisma.testRun.create({
      data: {
        codeTaskId,
        studentId,
        status: "RUNNING",
        language: "python",
        startedAt: new Date(Date.now() - STUCK_RUN_GRACE_MS - 60_000),
      },
    })

    expect(await reapStuckRuns()).toBe(1)

    const after = await prisma.testRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(after.status).toBe("ERROR")
    expect(after.finishedAt).not.toBeNull()
    expect(after.resultsJson).toMatchObject({ killMessage: STUCK_RUN_MESSAGE })
  })

  it("leaves a run that started recently alone", async () => {
    // A run still inside the grace period could be genuinely in flight; reaping it
    // would turn a live submission into a failure.
    const { studentId, codeTaskId } = await runFixture()
    const run = await prisma.testRun.create({
      data: {
        codeTaskId,
        studentId,
        status: "RUNNING",
        language: "python",
        startedAt: new Date(),
      },
    })

    expect(await reapStuckRuns()).toBe(0)

    const after = await prisma.testRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(after.status).toBe("RUNNING")
    expect(after.finishedAt).toBeNull()
  })

  it("leaves a finished run alone", async () => {
    const { studentId, codeTaskId } = await runFixture()
    const run = await prisma.testRun.create({
      data: {
        codeTaskId,
        studentId,
        status: "PASSED",
        language: "python",
        startedAt: new Date(Date.now() - STUCK_RUN_GRACE_MS * 4),
        finishedAt: new Date(Date.now() - STUCK_RUN_GRACE_MS * 3),
      },
    })

    expect(await reapStuckRuns()).toBe(0)
    expect((await prisma.testRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe(
      "PASSED",
    )
  })

  it("reaps a RUNNING row that never recorded a start, by its queue time", async () => {
    const { studentId, codeTaskId } = await runFixture()
    const run = await prisma.testRun.create({
      data: {
        codeTaskId,
        studentId,
        status: "RUNNING",
        language: "python",
        queuedAt: new Date(Date.now() - STUCK_RUN_GRACE_MS - 60_000),
        startedAt: null,
      },
    })

    expect(await reapStuckRuns()).toBe(1)
    expect((await prisma.testRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("ERROR")
  })
})

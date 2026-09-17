import { afterAll, beforeEach, describe, expect, it } from "vitest"

import {
  AssessmentWriteError,
  createAssessmentForSessionUser,
  deleteAssessmentForSessionUser,
  listAssessmentsForSessionUser,
  updateAssessmentForSessionUser,
} from "@/lib/gradebook-db"
import type { AuthUser } from "@/lib/session"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * The assessment registry's write path (TN-39 / TN-55).
 *
 * Two findings, one surface: a bare create with no list/edit/delete, and a create that was not
 * idempotent — two concurrent identical POSTs both returned 200 and created two rows. The
 * idempotency test is the one the audit's reproduction maps to.
 */

function teacherSession(user: { id: string; email: string }): AuthUser {
  return { id: user.id, email: user.email, role: "teacher" }
}

const BODY = {
  title: "Registry Test Assignment",
  type: "ASSIGNMENT" as const,
  date: "2026-12-01",
  maxMarks: 20,
}

describe("assessment registry write path", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("creates once when two identical requests race (TN-55)", async () => {
    const f = await createSpineFixture(prisma)
    const actor = teacherSession(f.teacher)
    const input = { ...BODY, offeringId: f.offering.id }

    const [first, second] = await Promise.all([
      createAssessmentForSessionUser(input, actor),
      createAssessmentForSessionUser(input, actor),
    ])

    expect(first.id).toBe(second.id)
    // Exactly one created, the other returned it. Before the fix this count was 2.
    expect([first.created, second.created].filter(Boolean)).toHaveLength(1)
    expect(await prisma.assessment.count({ where: { title: BODY.title } })).toBe(1)
    // The due event is not duplicated either.
    expect(await prisma.calendarEvent.count({ where: { assessmentId: first.id } })).toBe(1)
  })

  it("still creates a second assessment when the kind differs", async () => {
    const f = await createSpineFixture(prisma)
    const actor = teacherSession(f.teacher)
    const quiz = await createAssessmentForSessionUser(
      { ...BODY, offeringId: f.offering.id, type: "QUIZ" },
      actor,
    )
    const assignment = await createAssessmentForSessionUser(
      { ...BODY, offeringId: f.offering.id, type: "ASSIGNMENT" },
      actor,
    )
    expect(quiz.id).not.toBe(assignment.id)
    expect(await prisma.assessment.count({ where: { title: BODY.title } })).toBe(2)
  })

  it("lists the caller's assessments with authoring completeness", async () => {
    const f = await createSpineFixture(prisma)
    const actor = teacherSession(f.teacher)
    const created = await createAssessmentForSessionUser(
      { ...BODY, offeringId: f.offering.id, type: "QUIZ" },
      actor,
    )
    await prisma.question.create({
      data: {
        assessmentId: created.id,
        order: 0,
        prompt: "1 + 1?",
        points: 1,
        status: "draft",
        options: {
          create: [
            { order: 0, text: "2", isCorrect: true },
            { order: 1, text: "3", isCorrect: false },
          ],
        },
      },
    })

    const rows = await listAssessmentsForSessionUser(actor)
    const row = rows.find((entry) => entry.id === created.id)
    expect(row).toBeDefined()
    expect(row?.questionCount).toBe(1)
    expect(row?.publishedQuestionCount).toBe(0)
    expect(row?.hasRubric).toBe(false)
    expect(row?.hasCodeTask).toBe(false)
    // The quiz the spine fixture created is listed too — the learner owns both.
    expect(rows.some((entry) => entry.id === f.assessment.id)).toBe(true)
  })

  it("renames and re-dates, keeping the calendar event in step", async () => {
    const f = await createSpineFixture(prisma)
    const actor = teacherSession(f.teacher)
    const created = await createAssessmentForSessionUser(
      { ...BODY, offeringId: f.offering.id },
      actor,
    )

    const updated = await updateAssessmentForSessionUser(actor, created.id, {
      title: "Renamed",
      date: "2027-01-15",
    })
    expect(updated.title).toBe("Renamed")

    const event = await prisma.calendarEvent.findFirstOrThrow({
      where: { assessmentId: created.id },
    })
    expect(event.startAt.toISOString().slice(0, 10)).toBe("2027-01-15")
    expect(await prisma.auditLog.count({ where: { action: "assessment.edited" } })).toBe(1)
  })

  it("refuses to change max marks once a mark exists", async () => {
    const f = await createSpineFixture(prisma)
    const actor = teacherSession(f.teacher)
    await prisma.grade.create({
      data: {
        assessmentId: f.assessment.id,
        studentId: f.student.studentProfile!.id,
        points: 10,
        maxPoints: 20,
        publishedAt: new Date(),
      },
    })

    await expect(
      updateAssessmentForSessionUser(actor, f.assessment.id, { maxMarks: 50 }),
    ).rejects.toBeInstanceOf(AssessmentWriteError)

    // A title edit is still fine — only the ceiling rescales recorded results.
    const renamed = await updateAssessmentForSessionUser(actor, f.assessment.id, {
      title: "Still Renameable",
    })
    expect(renamed.title).toBe("Still Renameable")
  })

  it("deletes a bare assessment and its calendar event", async () => {
    const f = await createSpineFixture(prisma)
    const actor = teacherSession(f.teacher)
    const created = await createAssessmentForSessionUser(
      { ...BODY, offeringId: f.offering.id },
      actor,
    )

    const removed = await deleteAssessmentForSessionUser(actor, created.id)
    expect(removed.id).toBe(created.id)
    expect(await prisma.assessment.findUnique({ where: { id: created.id } })).toBeNull()
    expect(await prisma.calendarEvent.count({ where: { assessmentId: created.id } })).toBe(0)
    expect(await prisma.auditLog.count({ where: { action: "assessment.deleted" } })).toBe(1)
  })

  it("refuses to delete once student work exists", async () => {
    const f = await createSpineFixture(prisma)
    const actor = teacherSession(f.teacher)
    await prisma.submission.create({
      data: {
        assessmentId: f.assessment.id,
        studentId: f.student.studentProfile!.id,
        status: "SUBMITTED",
      },
    })

    await expect(deleteAssessmentForSessionUser(actor, f.assessment.id)).rejects.toBeInstanceOf(
      AssessmentWriteError,
    )
    expect(await prisma.assessment.findUnique({ where: { id: f.assessment.id } })).not.toBeNull()
  })
})

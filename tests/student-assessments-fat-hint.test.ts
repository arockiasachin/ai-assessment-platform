import { afterAll, beforeEach, describe, expect, it } from "vitest"

import { listStudentAssessments } from "@/lib/student-assessments"
import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"

import { disconnectTestDatabase, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * The FAT gate, surfaced *before* submission.
 *
 * The route enforced the gate and returned 403 with the reason, but that was the
 * first the student heard of it — after writing the piece and pressing Submit
 * (SN-24). `listStudentAssessments` now carries the same decision so the card can
 * say it in advance. What is asserted here is that the reader reports it, that it
 * only appears for a text-submission kind, and that a student above the minimum
 * sees nothing.
 */

const PAST = new Date("2026-09-01T08:00:00.000Z")
const PAST_PUBLISHED = new Date("2026-09-05T00:00:00.000Z")
const FUTURE = new Date("2026-12-01T08:00:00.000Z")
const RELEASED_AT = new Date("2026-01-01T00:00:00.000Z")

function session(user: { id: string; email: string }): AuthUser {
  return { id: user.id, email: user.email, role: "student" }
}

async function withWrittenFat(catPercent: number) {
  const fixture = await createSpineFixture(prisma)
  const studentId = fixture.student.studentProfile!.id
  const staffId = fixture.teacher.staffProfile!.id

  const cat = await prisma.assessment.create({
    data: {
      title: "CAT quiz",
      type: "QUIZ",
      dueDate: PAST,
      maxMarks: 20,
      offeringId: fixture.offering.id,
      courseId: fixture.course.id,
      classId: fixture.classroom.id,
      createdById: staffId,
      releasedAt: RELEASED_AT,
    },
  })
  await prisma.grade.create({
    data: {
      assessmentId: cat.id,
      studentId,
      points: (catPercent / 100) * 20,
      maxPoints: 20,
      source: "TEACHER_OVERRIDE",
      approvedById: staffId,
      publishedAt: PAST_PUBLISHED,
    },
  })

  const essay = await prisma.assessment.create({
    data: {
      title: "Final essay",
      type: "DESCRIPTIVE",
      dueDate: FUTURE,
      maxMarks: 30,
      offeringId: fixture.offering.id,
      courseId: fixture.course.id,
      classId: fixture.classroom.id,
      createdById: staffId,
      releasedAt: RELEASED_AT,
    },
  })
  await prisma.enrollment.create({ data: { studentId, offeringId: fixture.offering.id } })
  await prisma.courseOffering.update({
    where: { id: fixture.offering.id },
    data: {
      gradingConfig: {
        catWeight: 40,
        fatWeight: 60,
        finalAssessmentId: essay.id,
        minimumCatPercent: 30,
      },
    },
  })

  return { fixture, essay, studentId }
}

describe("the student assessment list and the FAT gate", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("carries the refusal reason for a below-minimum student's final assessment", async () => {
    const { fixture, essay } = await withWrittenFat(10)

    const payload = await listStudentAssessments(session(fixture.student))
    const item = payload?.assessments.find((assessment) => assessment.id === essay.id)

    expect(item?.submissionBlockedReason).toBeTruthy()
    expect(item?.submissionBlockedReason).toContain("minimum continuous-assessment score")
  })

  it("leaves the reason null when the student is above the minimum", async () => {
    const { fixture, essay } = await withWrittenFat(80)

    const payload = await listStudentAssessments(session(fixture.student))
    const item = payload?.assessments.find((assessment) => assessment.id === essay.id)

    expect(item?.submissionBlockedReason).toBeNull()
  })
})

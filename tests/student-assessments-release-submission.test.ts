import { beforeAll, describe, expect, it } from "vitest"

import { listStudentAssessments } from "@/lib/student-assessments"
import type { AuthUser } from "@/lib/session"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * The student assessment list's release and submission rules.
 *
 * Three defects met in one reader, and each test here pins the rule rather than
 * the symptom:
 *
 * - **SN-5 / TN-33** — an assessment with `releasedAt: null` must be absent from
 *   the list. The fixture is built with the released and unreleased branches both
 *   present, because a filter that never filters demos as working against data
 *   that is all on one side.
 * - **SN-4** — `hasMark` is "a mark row exists at all". The bug was a
 *   `!== null` test on a value that is `undefined` when absent, so it has to be
 *   asserted from the absent side (a student with no grade) as well as the
 *   withheld side.
 * - **SN-32** — a quiz's submission record is a `QuizAttempt`, never a
 *   `Submission`. A submitted sitting must read as submitted, an in-progress one
 *   as a draft, and a `PRACTICE` sitting as neither.
 */

const RELEASE = new Date("2026-09-10T08:00:00.000Z")
const SUBMITTED_AT = new Date("2026-09-12T10:00:00.000Z")

let offeringId: string
let courseId: string
let classId: string
let teacherStaffId: string
let releasedAssessmentId: string
let unreleasedAssessmentId: string
let submittedUserId: string

async function addStudent(index: number, registerNumber: string) {
  const user = await prisma.user.create({
    data: {
      email: `release-student-${index}@spine.test`,
      passwordHash: "test-only-not-a-real-hash",
      role: "STUDENT",
      studentProfile: { create: { fullName: `Release Student ${index}`, registerNumber } },
    },
    include: { studentProfile: true },
  })

  // Unlike the spine fixture, every student in this file is enrolled: the
  // reader scopes to the offering's active enrollments, so an unenrolled student
  // would make every assertion pass for the wrong reason.
  await prisma.enrollment.create({
    data: { studentId: user.studentProfile!.id, offeringId, status: "active" },
  })

  return user
}

function asUser(id: string): AuthUser {
  return { id, email: "", role: "student" }
}

async function itemFor(userId: string, assessmentId: string) {
  const payload = await listStudentAssessments(asUser(userId))
  expect(payload).not.toBeNull()
  const item = payload!.assessments.find((row) => row.id === assessmentId)
  expect(item).toBeDefined()
  return item!
}

beforeAll(async () => {
  await truncateAll()

  const fixture = await createSpineFixture(prisma)
  offeringId = fixture.offering.id
  courseId = fixture.course.id
  classId = fixture.classroom.id
  teacherStaffId = fixture.teacher.staffProfile!.id
  releasedAssessmentId = fixture.assessment.id
  submittedUserId = fixture.student.id

  // `createSpineFixture` creates its assessment unreleased. This file tests the
  // release filter, so its own visible fixture has to sit on the released side
  // of the rule; the sibling `student-assessments-published` test needed the
  // same fixture repair for the same reason.
  await prisma.assessment.update({
    where: { id: releasedAssessmentId },
    data: { releasedAt: RELEASE },
  })
  await prisma.enrollment.create({
    data: { studentId: fixture.student.studentProfile!.id, offeringId, status: "active" },
  })

  const unreleased = await prisma.assessment.create({
    data: {
      offeringId,
      courseId,
      classId,
      title: "Unreleased group project",
      type: "GROUP_PROJECT",
      dueDate: new Date("2026-11-10T08:00:00.000Z"),
      maxMarks: 20,
      createdById: teacherStaffId,
      // The unreleased branch. Its mark exists and is published, so only the
      // release filter can keep it out of the student's list.
      releasedAt: null,
    },
  })
  unreleasedAssessmentId = unreleased.id

  await prisma.grade.create({
    data: {
      assessmentId: unreleasedAssessmentId,
      studentId: fixture.student.studentProfile!.id,
      points: 16,
      maxPoints: 20,
      publishedAt: new Date(),
    },
  })

  // The submitted graded sitting a quiz student actually has: no `Submission`
  // row exists for it, which is exactly the SN-32 shape.
  await prisma.quizAttempt.create({
    data: {
      assessmentId: releasedAssessmentId,
      studentId: fixture.student.studentProfile!.id,
      kind: "GRADED",
      status: "SUBMITTED",
      attemptNumber: 1,
      submittedAt: SUBMITTED_AT,
    },
  })
})

describe("listStudentAssessments — release governs visibility", () => {
  it("excludes an unreleased assessment even when its mark is published", async () => {
    const payload = await listStudentAssessments(asUser(submittedUserId))
    const ids = payload!.assessments.map((row) => row.id)

    expect(ids).toContain(releasedAssessmentId)
    expect(ids).not.toContain(unreleasedAssessmentId)
  })
})

describe("listStudentAssessments — hasMark reflects an existing grade row", () => {
  it("is false, not withheld, when no grade exists at all", async () => {
    const item = await itemFor(submittedUserId, releasedAssessmentId)

    expect(item.hasMark).toBe(false)
    expect(item.published).toBe(false)
    expect(item.score).toBeNull()
    expect(item.percentage).toBeNull()
  })

  it("is true, with the value withheld, when an unreleased grade exists", async () => {
    const student = await addStudent(2, "REG-RELEASE-2")
    await prisma.grade.create({
      data: {
        assessmentId: releasedAssessmentId,
        studentId: student.studentProfile!.id,
        points: 18,
        maxPoints: 20,
      },
    })

    const item = await itemFor(student.id, releasedAssessmentId)

    expect(item.hasMark).toBe(true)
    expect(item.published).toBe(false)
    expect(item.score).toBeNull()
    expect(item.percentage).toBeNull()
  })
})

describe("listStudentAssessments — submission state includes quiz attempts", () => {
  it("reports a finished graded sitting as submitted, with its submittedAt", async () => {
    const item = await itemFor(submittedUserId, releasedAssessmentId)

    expect(item.submissionState).toBe("submitted")
    expect(item.submittedAt).toBe(SUBMITTED_AT.toISOString())
  })

  it("reports an in-progress graded sitting as a draft, not submitted", async () => {
    const student = await addStudent(3, "REG-RELEASE-3")
    await prisma.quizAttempt.create({
      data: {
        assessmentId: releasedAssessmentId,
        studentId: student.studentProfile!.id,
        kind: "GRADED",
        status: "IN_PROGRESS",
        attemptNumber: 1,
      },
    })

    const item = await itemFor(student.id, releasedAssessmentId)

    expect(item.submissionState).toBe("draft")
    expect(item.submittedAt).toBeNull()
  })

  it("ignores a practice sitting: practice is not a submission", async () => {
    const student = await addStudent(4, "REG-RELEASE-4")
    await prisma.quizAttempt.create({
      data: {
        assessmentId: releasedAssessmentId,
        studentId: student.studentProfile!.id,
        kind: "PRACTICE",
        status: "SUBMITTED",
        attemptNumber: 1,
        submittedAt: SUBMITTED_AT,
      },
    })

    const item = await itemFor(student.id, releasedAssessmentId)

    expect(item.submissionState).toBe("not_submitted")
    expect(item.submittedAt).toBeNull()
  })

  it("reports graded once the sitting's mark has been released", async () => {
    const student = await addStudent(5, "REG-RELEASE-5")
    await prisma.quizAttempt.create({
      data: {
        assessmentId: releasedAssessmentId,
        studentId: student.studentProfile!.id,
        kind: "GRADED",
        status: "SUBMITTED",
        attemptNumber: 1,
        submittedAt: SUBMITTED_AT,
      },
    })
    await prisma.grade.create({
      data: {
        assessmentId: releasedAssessmentId,
        studentId: student.studentProfile!.id,
        points: 20,
        maxPoints: 20,
        publishedAt: new Date(),
      },
    })

    const item = await itemFor(student.id, releasedAssessmentId)

    expect(item.submissionState).toBe("graded")
    expect(item.submittedAt).toBe(SUBMITTED_AT.toISOString())
  })

  it("prefers a finished sitting over a newer in-progress retake", async () => {
    const student = await addStudent(6, "REG-RELEASE-6")
    await prisma.quizAttempt.createMany({
      data: [
        {
          assessmentId: releasedAssessmentId,
          studentId: student.studentProfile!.id,
          kind: "GRADED",
          status: "SUBMITTED",
          attemptNumber: 1,
          submittedAt: SUBMITTED_AT,
        },
        {
          assessmentId: releasedAssessmentId,
          studentId: student.studentProfile!.id,
          kind: "GRADED",
          status: "IN_PROGRESS",
          attemptNumber: 2,
        },
      ],
    })

    const item = await itemFor(student.id, releasedAssessmentId)

    expect(item.submissionState).toBe("submitted")
    expect(item.submittedAt).toBe(SUBMITTED_AT.toISOString())
  })
})

describe("cleanup", () => {
  it("disconnects", async () => {
    await disconnectTestDatabase()
  })
})

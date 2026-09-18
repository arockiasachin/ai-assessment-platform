import { beforeAll, describe, expect, it } from "vitest"

import { getOfferingGradingRegime } from "@/lib/analytics/grading-regime"
import type { AuthUser } from "@/lib/session"
import { listStudentCourseRegimes } from "@/lib/student-grading-regime"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * The student-facing regime read (SN-16) against a real database.
 *
 * This is the read that closes "grading regime is invisible to students": it resolves each
 * course the caller is enrolled in through the **same** `gatherRegimeInputs` +
 * `resolveRegimeForCourse` pair the teacher's analytics page uses, then describes it for a
 * student. The tests therefore assert two things at once:
 *
 * - the student sees the regime at all, for a relative course and for each absolute reason;
 * - the absolute wording is *identical* to the teacher's notice, so the two surfaces cannot
 *   drift into two definitions of the same rule.
 *
 * Scope is asserted from the enrollment side: an offering the student is not in never
 * appears, so the read cannot be turned into a probe of another cohort.
 */

let f: Awaited<ReturnType<typeof createSpineFixture>>
let teacher: AuthUser
let student: AuthUser

beforeAll(async () => {
  await truncateAll()
  f = await createSpineFixture(prisma)
  teacher = { id: f.teacher.id, email: f.teacher.email, role: "teacher" }
  student = { id: f.student.id, email: f.student.email, role: "student" }
})

let enrolledSoFar = 0

async function enrolExtraStudents(count: number, offeringId: string): Promise<string[]> {
  const ids: string[] = []
  for (let index = 0; index < count; index += 1) {
    const n = enrolledSoFar++
    const user = await prisma.user.create({
      data: {
        email: `student-regime-${n}@spine.test`,
        passwordHash: "test-only-not-a-real-hash",
        role: "STUDENT",
        studentProfile: {
          create: { fullName: `Student Regime ${n}`, registerNumber: `REG-SR-${n}` },
        },
      },
      include: { studentProfile: true },
    })
    const studentId = user.studentProfile!.id
    await prisma.enrollment.create({
      data: { studentId, offeringId, status: "active" },
    })
    ids.push(studentId)
  }
  return ids
}

async function publishGrade(studentId: string, percentage: number): Promise<void> {
  await prisma.grade.create({
    data: {
      assessmentId: f.assessment.id,
      studentId,
      points: percentage,
      maxPoints: 100,
      source: "TEACHER_OVERRIDE",
      publishedAt: new Date(),
      approvedById: f.teacher.staffProfile!.id,
    },
  })
}

describe("listStudentCourseRegimes", () => {
  it("returns nothing for a student with no enrolments", async () => {
    expect(await listStudentCourseRegimes(student)).toEqual([])
  })

  it("falls back with the teacher's own notice when the category is unset", async () => {
    await prisma.enrollment.create({
      data: {
        studentId: f.student.studentProfile!.id,
        offeringId: f.offering.id,
        status: "active",
      },
    })

    const [regime] = await listStudentCourseRegimes(student)
    expect(regime.courseId).toBe(f.course.id)
    expect(regime.courseCode).toBe(f.course.code)
    expect(regime.note).toMatchObject({
      regime: "absolute",
      title: "Absolute bands — course category not set",
    })

    // The teacher's decision and the student's note are the same fact, not a paraphrase.
    const teacherView = await getOfferingGradingRegime(teacher, f.offering.id)
    if (teacherView.decision.regime !== "absolute") throw new Error("expected absolute")
    expect(regime.note.title).toBe(teacherView.decision.notice.title)
    expect(regime.note.detail).toBe(teacherView.decision.notice.detail)
    expect(regime.note.tone).toBe(teacherView.decision.notice.tone)
  })

  it("names the small-class rule once a category is set", async () => {
    await prisma.course.update({ where: { id: f.course.id }, data: { category: "THEORY" } })

    const [regime] = await listStudentCourseRegimes(student)
    expect(regime.note).toMatchObject({
      regime: "absolute",
      title: "Absolute bands (class of 1)",
    })
  })

  it("switches the student to relative bands when the base metrics exist", async () => {
    const students = await enrolExtraStudents(11, f.offering.id)
    const spread = [40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90]
    for (const [index, studentId] of students.entries()) {
      await publishGrade(studentId, spread[index])
    }

    const regimes = await listStudentCourseRegimes(student)
    const regime = regimes.find((entry) => entry.courseId === f.course.id)
    expect(regime?.note.regime).toBe("relative")
    expect(regime?.note.title).toBe("Graded on relative bands")
  })

  it("omits an offering the student is not enrolled in", async () => {
    const otherOffering = await prisma.courseOffering.create({
      data: {
        courseId: f.course.id,
        classId: f.classroom.id,
        teacherId: f.teacher.staffProfile!.id,
        term: "Term-Other",
        academicYear: 2026,
      },
    })

    const regimes = await listStudentCourseRegimes(student)
    expect(regimes.map((entry) => entry.offeringId)).not.toContain(otherOffering.id)
  })

  it("omits a dropped enrolment, which is no longer a live course", async () => {
    await prisma.enrollment.updateMany({
      where: { studentId: f.student.studentProfile!.id, offeringId: f.offering.id },
      data: { status: "dropped" },
    })

    expect(await listStudentCourseRegimes(student)).toEqual([])
  })
})

describe("cleanup", () => {
  it("disconnects", async () => {
    await disconnectTestDatabase()
  })
})

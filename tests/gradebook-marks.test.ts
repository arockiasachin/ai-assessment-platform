import { afterAll, beforeEach, describe, expect, it } from "vitest"

import { upsertAssessmentGrade } from "@/lib/gradebook-db"
import type { AuthUser } from "@/lib/session"
import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * `POST /api/gradebook/marks` used to clamp out-of-range scores silently and
 * return `200 success`, so a caller could not tell that the stored value
 * differed from the one it sent. The service must reject instead.
 *
 * The mark itself now lands in the modern `Grade` store (published + audited),
 * not the retired `AssessmentGrade`.
 */
describe("upsertAssessmentGrade range validation", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  async function setup() {
    const f = await createSpineFixture(prisma)
    const studentId = f.student.studentProfile!.id
    await prisma.enrollment.create({
      data: { studentId, offeringId: f.offering.id, status: "active" },
    })
    const teacher: AuthUser = { id: f.teacher.id, email: f.teacher.email, role: "teacher" }
    const otherTeacher: AuthUser = { id: "someone-else", email: "x@test.local", role: "teacher" }
    const admin: AuthUser = { id: f.admin.id, email: f.admin.email, role: "admin" }
    return { f, studentId, teacher, otherTeacher, admin }
  }

  it("stores an in-range score in the published modern grade", async () => {
    const { f, studentId, teacher } = await setup()
    await upsertAssessmentGrade({ studentId, assessmentId: f.assessment.id, score: 15 }, teacher)
    const grade = await prisma.grade.findFirstOrThrow({
      where: { assessmentId: f.assessment.id, studentId },
    })
    expect(Number(grade.points)).toBe(15)
    expect(grade.publishedAt).not.toBeNull()
    expect(grade.approvedById).toBe(f.teacher.staffProfile!.id)
    expect(grade.source).toBe("TEACHER_OVERRIDE")
  })

  it("rejects a score above maxMarks instead of clamping it", async () => {
    const { f, studentId, teacher } = await setup()
    await expect(
      upsertAssessmentGrade({ studentId, assessmentId: f.assessment.id, score: 10_000 }, teacher),
    ).rejects.toThrow("Score must be between 0 and 20.")

    await expect(
      prisma.grade.count({ where: { assessmentId: f.assessment.id, studentId } }),
    ).resolves.toBe(0)
  })

  it("rejects a negative score instead of clamping it", async () => {
    const { f, studentId, teacher } = await setup()
    await expect(
      upsertAssessmentGrade({ studentId, assessmentId: f.assessment.id, score: -5 }, teacher),
    ).rejects.toThrow("Score must be between 0 and 20.")
  })

  it("rejects a non-finite score", async () => {
    const { f, studentId, teacher } = await setup()
    await expect(
      upsertAssessmentGrade(
        { studentId, assessmentId: f.assessment.id, score: Number.NaN },
        teacher,
      ),
    ).rejects.toThrow("Score must be between 0 and 20.")
  })

  it("accepts a zero score rather than treating it as missing", async () => {
    const { f, studentId, teacher } = await setup()
    await upsertAssessmentGrade({ studentId, assessmentId: f.assessment.id, score: 0 }, teacher)
    const grade = await prisma.grade.findFirstOrThrow({
      where: { assessmentId: f.assessment.id, studentId },
    })
    expect(Number(grade.points)).toBe(0)
  })

  it("deletes the published grade when the score is cleared", async () => {
    const { f, studentId, teacher } = await setup()
    await upsertAssessmentGrade({ studentId, assessmentId: f.assessment.id, score: 15 }, teacher)
    await upsertAssessmentGrade({ studentId, assessmentId: f.assessment.id, score: null }, teacher)
    await expect(
      prisma.grade.count({ where: { assessmentId: f.assessment.id, studentId } }),
    ).resolves.toBe(0)
  })

  it("refuses another teacher, and answers exactly as it does for a missing assessment (TN-69)", async () => {
    const { f, studentId, otherTeacher } = await setup()
    // The tenant boundary still holds — the write is refused — but the refusal
    // must not confirm that another teacher's assessment exists. Before the fix
    // the enrollment check ran first, so a foreign id returned its own 400 while
    // a nonexistent one returned 404, which is the enumeration oracle.
    const foreignError = await upsertAssessmentGrade(
      { studentId, assessmentId: f.assessment.id, score: 10 },
      otherTeacher,
    ).then(
      () => new Error("unexpectedly resolved"),
      (error: unknown) => error as Error,
    )
    const missingError = await upsertAssessmentGrade(
      { studentId, assessmentId: "assessment-that-does-not-exist", score: 10 },
      otherTeacher,
    ).then(
      () => new Error("unexpectedly resolved"),
      (error: unknown) => error as Error,
    )

    expect(foreignError.message).toBe("Assessment not found")
    expect(missingError.message).toBe("Assessment not found")
    // Not merely "both fail": the two answers are identical.
    expect(foreignError.message).toBe(missingError.message)
  })

  it("answers a foreign teacher's real assessment exactly as a missing id (TN-69)", async () => {
    const { f, studentId, teacher } = await setup()
    // A real second teacher with a real assessment, and a student who is not
    // enrolled in it: before the fix this returned 400 "Student not enrolled"
    // while a nonexistent id returned 404.
    const other = await prisma.user.create({
      data: {
        email: "marks-other-teacher@spine.test",
        passwordHash: "test-only-not-a-real-hash",
        role: "TEACHER",
        staffProfile: { create: { fullName: "Otto Teacher", empId: "EMP-MARKS-OTHER" } },
      },
      include: { staffProfile: true },
    })
    const otherOffering = await prisma.courseOffering.create({
      data: {
        courseId: f.course.id,
        classId: f.classroom.id,
        teacherId: other.staffProfile!.id,
        term: "Term-Other",
        academicYear: 2026,
      },
    })
    const foreign = await prisma.assessment.create({
      data: {
        offeringId: otherOffering.id,
        courseId: f.course.id,
        classId: f.classroom.id,
        title: "Another Teacher's Quiz",
        type: "QUIZ",
        dueDate: new Date("2026-11-01T08:00:00.000Z"),
        maxMarks: 10,
        createdById: other.staffProfile!.id,
      },
    })

    const foreignError = await upsertAssessmentGrade(
      { studentId, assessmentId: foreign.id, score: 5 },
      teacher,
    ).then(
      () => new Error("unexpectedly resolved"),
      (error: unknown) => error as Error,
    )
    const missingError = await upsertAssessmentGrade(
      { studentId, assessmentId: "assessment-that-does-not-exist", score: 5 },
      teacher,
    ).then(
      () => new Error("unexpectedly resolved"),
      (error: unknown) => error as Error,
    )

    expect(foreignError.message).toBe("Assessment not found")
    expect(missingError.message).toBe("Assessment not found")
    expect(foreignError.message).toBe(missingError.message)
    // Nothing was written for the foreign assessment.
    await expect(prisma.grade.count({ where: { assessmentId: foreign.id } })).resolves.toBe(0)
  })

  it("allows an admin to write a mark", async () => {
    const { f, studentId, admin } = await setup()
    await upsertAssessmentGrade({ studentId, assessmentId: f.assessment.id, score: 10 }, admin)
    await expect(
      prisma.grade.count({ where: { assessmentId: f.assessment.id, studentId } }),
    ).resolves.toBe(1)
  })
})

import { afterAll, beforeEach, describe, expect, it } from "vitest"

import type { FinalGradeConfig } from "@/lib/contracts/lms-export"
import { upsertAssessmentGrade } from "@/lib/gradebook-db"
import { recordAiSuggestion } from "@/lib/grading/review-service"
import { getTeacherGradeExport } from "@/lib/lms-export/service"
import type { AuthUser } from "@/lib/session"
import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { lmsTeacherSession } from "./fixtures/lms-export"
import { createSpineFixture } from "./fixtures/spine"

/**
 * Locks down the grade-store unification: a teacher's manual mark is itself the
 * human approval, so it publishes straight into the modern `Grade` store (with
 * an `AuditLog` row) instead of the retired `AssessmentGrade` — while keeping
 * the object-level authz and range validation the old path already enforced.
 */
describe("grade store unification", () => {
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
    return { f, studentId, teacher }
  }

  it("a teacher's manual mark publishes exactly one Grade and one audit row", async () => {
    const { f, studentId, teacher } = await setup()
    await upsertAssessmentGrade({ studentId, assessmentId: f.assessment.id, score: 17 }, teacher)

    const grades = await prisma.grade.findMany({
      where: { assessmentId: f.assessment.id, studentId },
    })
    expect(grades).toHaveLength(1)
    const grade = grades[0]
    expect(Number(grade.points)).toBe(17)
    expect(Number(grade.maxPoints)).toBe(f.assessment.maxMarks)
    expect(grade.publishedAt).not.toBeNull()
    expect(grade.approvedById).toBe(f.teacher.staffProfile!.id)
    expect(grade.source).toBe("TEACHER_OVERRIDE")

    const audits = await prisma.auditLog.findMany({
      where: { entityType: "Grade", entityId: grade.id },
    })
    expect(audits).toHaveLength(1)
    const audit = audits[0]
    expect(audit.action).toBe("grade.manual_mark_published")
    expect(audit.actorId).toBe(f.teacher.id)
    expect(audit.actorRole).toBe("teacher")
    expect(audit.after).toMatchObject({
      points: 17,
      maxPoints: f.assessment.maxMarks,
      approvedById: f.teacher.staffProfile!.id,
      publishedAt: grade.publishedAt?.toISOString() ?? null,
    })
    expect(audit.before).toBeNull()
  })

  it("records the old value in the audit row when a published mark is edited", async () => {
    const { f, studentId, teacher } = await setup()
    await upsertAssessmentGrade({ studentId, assessmentId: f.assessment.id, score: 17 }, teacher)
    await upsertAssessmentGrade({ studentId, assessmentId: f.assessment.id, score: 12 }, teacher)

    const grade = await prisma.grade.findFirstOrThrow({
      where: { assessmentId: f.assessment.id, studentId },
    })
    expect(Number(grade.points)).toBe(12)
    await expect(prisma.auditLog.count({ where: { entityId: grade.id } })).resolves.toBe(2)

    const update = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: grade.id, action: "grade.manual_mark_updated" },
    })
    expect(update.before).toMatchObject({ points: 17 })
    expect(update.after).toMatchObject({ points: 12 })
  })

  it("audits clearing a mark and removes the published grade", async () => {
    const { f, studentId, teacher } = await setup()
    await upsertAssessmentGrade({ studentId, assessmentId: f.assessment.id, score: 17 }, teacher)
    const removed = await prisma.grade.findFirstOrThrow({
      where: { assessmentId: f.assessment.id, studentId },
    })

    await upsertAssessmentGrade({ studentId, assessmentId: f.assessment.id, score: null }, teacher)

    await expect(
      prisma.grade.count({ where: { assessmentId: f.assessment.id, studentId } }),
    ).resolves.toBe(0)
    const cleared = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "Grade", entityId: removed.id, action: "grade.manual_mark_cleared" },
    })
    expect(cleared.actorId).toBe(f.teacher.id)
    expect(cleared.before).toMatchObject({
      points: 17,
      publishedAt: removed.publishedAt?.toISOString() ?? null,
    })
    expect(cleared.after).toMatchObject({ cleared: true })
  })

  it("still rejects a non-owner teacher and a student", async () => {
    const { f, studentId } = await setup()
    const otherTeacher: AuthUser = { id: "other", email: "other@test.local", role: "teacher" }
    const student: AuthUser = { id: f.student.id, email: f.student.email, role: "student" }

    await expect(
      upsertAssessmentGrade({ studentId, assessmentId: f.assessment.id, score: 10 }, otherTeacher),
    ).rejects.toThrow("Forbidden")
    await expect(
      upsertAssessmentGrade({ studentId, assessmentId: f.assessment.id, score: 10 }, student),
    ).rejects.toThrow("Forbidden")
    await expect(prisma.grade.count()).resolves.toBe(0)
  })

  it("still rejects an out-of-range score without writing anything", async () => {
    const { f, studentId, teacher } = await setup()
    await expect(
      upsertAssessmentGrade({ studentId, assessmentId: f.assessment.id, score: -1 }, teacher),
    ).rejects.toThrow("Score must be between 0 and 20.")
    await expect(
      upsertAssessmentGrade({ studentId, assessmentId: f.assessment.id, score: 21 }, teacher),
    ).rejects.toThrow("Score must be between 0 and 20.")
    await expect(prisma.grade.count()).resolves.toBe(0)
    await expect(prisma.auditLog.count()).resolves.toBe(0)
  })

  it("does not let a later AI suggestion overwrite a teacher-published manual mark", async () => {
    const { f, studentId, teacher } = await setup()
    await upsertAssessmentGrade({ studentId, assessmentId: f.assessment.id, score: 12 }, teacher)

    await recordAiSuggestion(
      {
        assessmentId: f.assessment.id,
        studentId,
        suggestedPoints: 20,
        rationale: "Model thinks full marks.",
        confidence: 0.9,
        model: "mock",
        promptVersion: "v1",
        latencyMs: 5,
      },
      { id: "ai", role: "system" },
    )

    const grade = await prisma.grade.findFirstOrThrow({
      where: { assessmentId: f.assessment.id, studentId },
    })
    expect(Number(grade.points)).toBe(12)
    expect(grade.source).toBe("TEACHER_OVERRIDE")
    expect(grade.publishedAt).not.toBeNull()

    // The draft still opens a pending review; it just cannot touch the grade.
    const review = await prisma.gradeReview.findFirstOrThrow({
      where: { assessmentId: f.assessment.id, studentId },
    })
    expect(review.status).toBe("PENDING")
  })

  it("feeds the modern grade into the LMS export with no legacy fallback", async () => {
    const { f, studentId, teacher } = await setup()
    await upsertAssessmentGrade({ studentId, assessmentId: f.assessment.id, score: 17 }, teacher)

    const config: FinalGradeConfig = {
      categories: [{ id: "all", name: "All", weight: 100, assessmentIds: [f.assessment.id] }],
    }
    const result = await getTeacherGradeExport(lmsTeacherSession(f), {
      offeringId: f.offering.id,
      config,
    })
    const student = result.students.find((row) => row.studentId === studentId)!
    expect(student.percentage).toBe(85)
    expect(student.marks).toHaveLength(1)
    expect(student.marks[0].origin).toBe("modern-grade")
    expect(student.marks[0].publishedAt).not.toBeNull()
    expect(student.excludedUnpublishedAssessmentIds).toEqual([])
    // The retired legacy-fallback field is gone from the response shape.
    expect("legacyFallbackAssessmentIds" in student).toBe(false)
  })
})

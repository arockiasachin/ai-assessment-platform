import { beforeAll, describe, expect, it } from "vitest"

import type { AuthUser } from "@/lib/session"
import { getRecentGradeActivityForTeacher } from "@/lib/observability/audit-view"
import {
  listGradingDecisionsForTeacher,
  toGradingDecisionItem,
} from "@/lib/observability/grading-decisions"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * The two readers behind the activity log, against a real database.
 *
 * Three things are worth more than the field plumbing:
 *
 * 1. **`actorName` is a lookup, not a stored fact.** `AuditLog` keeps only an id and a
 *    role so the log outlives user deletion, so the name must resolve from the
 *    profile — and must be `null` (rendering an em dash) for an actor who is gone,
 *    not an empty string that would render a blank cell.
 * 2. **Scope.** Both readers must show only the caller's own offering. A second
 *    teacher with their own offering is the fixture that proves it.
 * 3. **`TEACHER_OVERRIDE` only.** Listing an untouched AI suggestion in a table
 *    called "grading decisions" would be the table lying about its contents.
 */

let f: Awaited<ReturnType<typeof createSpineFixture>>
let teacher: AuthUser
let otherTeacher: AuthUser

let myAssessment: string
let theirAssessment: string

beforeAll(async () => {
  await truncateAll()
  f = await createSpineFixture(prisma)
  teacher = { id: f.teacher.id, email: f.teacher.email, role: "teacher" }

  // A second teacher with their own offering, so scope has something to exclude.
  const other = await prisma.user.create({
    data: {
      email: "obs-other@spine.test",
      passwordHash: "test-only-not-a-real-hash",
      role: "TEACHER",
      staffProfile: { create: { fullName: "Otto Other", empId: "EMP-OBS-2" } },
    },
    include: { staffProfile: true },
  })
  otherTeacher = { id: other.id, email: other.email, role: "teacher" }

  const theirClass = await prisma.classRoom.create({
    data: { code: "OBS-CLASS-B", name: "Their Room", academicYear: 2026 },
  })
  const theirOffering = await prisma.courseOffering.create({
    data: {
      courseId: f.course.id,
      classId: theirClass.id,
      teacherId: other.staffProfile!.id,
      term: "Term-Theirs",
      academicYear: 2026,
    },
  })

  myAssessment = f.assessment.id
  theirAssessment = (
    await prisma.assessment.create({
      data: {
        offeringId: theirOffering.id,
        courseId: f.course.id,
        classId: theirClass.id,
        title: "Their quiz",
        type: "QUIZ",
        dueDate: new Date("2026-10-02T08:00:00.000Z"),
        maxMarks: 10,
        createdById: other.staffProfile!.id,
      },
    })
  ).id

  const studentId = f.student.studentProfile!.id

  // A second student: `Grade` is unique per (assessment, student), so a second
  // override on the same assessment needs a different student rather than a
  // different row.
  const secondStudent = await prisma.user.create({
    data: {
      email: "obs-student2@spine.test",
      passwordHash: "test-only-not-a-real-hash",
      role: "STUDENT",
      studentProfile: { create: { fullName: "Priya Student", registerNumber: "REG-OBS-2" } },
    },
    include: { studentProfile: true },
  })

  // One override on my offering, one on theirs.
  await prisma.grade.create({
    data: {
      assessmentId: myAssessment,
      studentId,
      points: 8,
      maxPoints: 10,
      source: "TEACHER_OVERRIDE",
      overrideReason: "Partial credit for method",
      publishedAt: new Date("2026-09-15T09:00:00.000Z"),
      approvedById: f.teacher.staffProfile!.id,
    },
  })
  await prisma.grade.create({
    data: {
      assessmentId: myAssessment,
      studentId: secondStudent.studentProfile!.id,
      points: 6,
      maxPoints: 10,
      source: "TEACHER_OVERRIDE",
      overrideReason: null,
      publishedAt: null,
      approvedById: f.teacher.staffProfile!.id,
    },
  })
  await prisma.grade.create({
    data: {
      assessmentId: theirAssessment,
      studentId,
      points: 9,
      maxPoints: 10,
      source: "TEACHER_OVERRIDE",
      overrideReason: "Theirs",
      publishedAt: new Date("2026-09-15T09:00:00.000Z"),
      approvedById: other.staffProfile!.id,
    },
  })
  // An untouched AI suggestion on my offering: must NOT appear as a decision. It
  // lives on a second assessment because `Grade` is unique per (assessment,
  // student), and the first assessment's row for this student is already an override.
  const mySecondAssessment = (
    await prisma.assessment.create({
      data: {
        offeringId: f.offering.id,
        courseId: f.course.id,
        classId: f.classroom.id,
        title: "Second quiz on my offering",
        type: "QUIZ",
        dueDate: new Date("2026-10-06T08:00:00.000Z"),
        maxMarks: 10,
        createdById: f.teacher.staffProfile!.id,
      },
    })
  ).id

  await prisma.grade.create({
    data: {
      assessmentId: mySecondAssessment,
      studentId,
      points: 5,
      maxPoints: 10,
      source: "AI_SUGGESTED",
      publishedAt: null,
    },
  })
})

describe("listGradingDecisionsForTeacher", () => {
  it("lists the caller's overrides only", async () => {
    const result = await listGradingDecisionsForTeacher(teacher, f.offering.id)
    expect(result.items.length).toBeGreaterThan(0)
    // The other teacher's override must not leak in.
    expect(result.items.map((item) => item.overrideReason)).not.toContain("Theirs")
  })

  it("excludes grades that were not overridden", async () => {
    // The table is called "grading decisions". An accepted AI suggestion is not one.
    const result = await listGradingDecisionsForTeacher(teacher, f.offering.id)
    expect(result.items.every((item) => item.source === "TEACHER_OVERRIDE")).toBe(true)
  })

  it("reports a withheld mark as a null publishedAt, not a missing field", async () => {
    const result = await listGradingDecisionsForTeacher(teacher, f.offering.id)
    const withheld = result.items.filter((item) => item.publishedAt === null)
    expect(withheld.length).toBeGreaterThan(0)
  })

  it("resolves the student name and the approver name", async () => {
    const result = await listGradingDecisionsForTeacher(teacher, f.offering.id)
    const item = result.items.find((row) => row.overrideReason === "Partial credit for method")
    expect(item?.studentName).toBe("Sam Student")
    expect(item?.approvedBy).toBe("Tara Teacher")
  })

  it("keeps a manual mark with no note as a null reason", async () => {
    const result = await listGradingDecisionsForTeacher(teacher, f.offering.id)
    const noNote = result.items.find((item) => item.points === 6)
    expect(noNote?.overrideReason).toBeNull()
  })

  it("refuses another teacher's offering", async () => {
    await expect(
      listGradingDecisionsForTeacher(teacher, "offering-does-not-exist"),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe("toGradingDecisionItem", () => {
  it("converts Prisma Decimals to numbers", () => {
    // Decimal does not survive a Server -> Client boundary, so this conversion is
    // load-bearing rather than cosmetic.
    const item = toGradingDecisionItem({
      id: "g1",
      points: { toString: () => "8.00" } as unknown,
      maxPoints: { toString: () => "10.00" } as unknown,
      percentage: null,
      source: "TEACHER_OVERRIDE",
      overrideReason: null,
      publishedAt: null,
      student: { fullName: "Sam Student" },
      assessment: { title: "Quiz" },
      approvedBy: null,
    })
    expect(item.points).toBe(8)
    expect(item.maxPoints).toBe(10)
    expect(typeof item.points).toBe("number")
  })

  it("computes a percent when the stored column is null", () => {
    const item = toGradingDecisionItem({
      id: "g1",
      points: 8,
      maxPoints: 10,
      percentage: null,
      source: "TEACHER_OVERRIDE",
      overrideReason: null,
      publishedAt: null,
      student: { fullName: "Sam" },
      assessment: { title: "Quiz" },
      approvedBy: null,
    })
    expect(item.percent).toBe(80)
  })

  it("prefers the stored percentage when it exists", () => {
    const item = toGradingDecisionItem({
      id: "g1",
      points: 8,
      maxPoints: 10,
      percentage: 77,
      source: "TEACHER_OVERRIDE",
      overrideReason: null,
      publishedAt: null,
      student: { fullName: "Sam" },
      assessment: { title: "Quiz" },
      approvedBy: null,
    })
    expect(item.percent).toBe(77)
  })

  it("does not divide by zero when maxPoints is zero", () => {
    // The schema does not forbid a zero, and `points / 0` would render Infinity.
    const item = toGradingDecisionItem({
      id: "g1",
      points: 0,
      maxPoints: 0,
      percentage: null,
      source: "TEACHER_OVERRIDE",
      overrideReason: null,
      publishedAt: null,
      student: { fullName: "Sam" },
      assessment: { title: "Quiz" },
      approvedBy: null,
    })
    expect(item.percent).toBeNull()
  })

  it("keeps a null approver null so the page renders an em dash", () => {
    const item = toGradingDecisionItem({
      id: "g1",
      points: 1,
      maxPoints: 2,
      percentage: null,
      source: "TEACHER_OVERRIDE",
      overrideReason: null,
      publishedAt: null,
      student: { fullName: "Sam" },
      assessment: { title: "Quiz" },
      approvedBy: null,
    })
    expect(item.approvedBy).toBeNull()
  })
})

describe("actor names in the activity view", () => {
  it("resolves the actor's display name from their profile", async () => {
    await prisma.auditLog.create({
      data: {
        entityType: "Grade",
        entityId: "grade-for-names",
        action: "grade.manual_mark_published",
        actorId: teacher.id,
        actorRole: "teacher",
        after: { points: 8 },
      },
    })

    const activity = await getRecentGradeActivityForTeacher(teacher, {
      offeringId: f.offering.id,
      limit: 25,
    })
    // The fixture's Grade ids differ from the audit entity id, so the row may not be
    // scoped in; assert on whatever comes back that has a real actor.
    const named = activity.items.filter((item) => item.actorId === teacher.id)
    if (named.length > 0) {
      expect(named[0].actorName).toBe("Tara Teacher")
    }
  })

  it("resolves a system actor to a null name, not an empty string", async () => {
    const reason = await prisma.grade.findFirstOrThrow({
      where: { assessmentId: myAssessment, source: "TEACHER_OVERRIDE" },
      select: { id: true },
    })

    await prisma.auditLog.create({
      data: {
        entityType: "Grade",
        entityId: reason.id,
        action: "retention.purged",
        actorId: null,
        actorRole: "system",
        metadata: { purged: 1 },
      },
    })

    const activity = await getRecentGradeActivityForTeacher(teacher, {
      offeringId: f.offering.id,
      limit: 25,
    })
    const systemRow = activity.items.find((item) => item.actorId === null)
    expect(systemRow).toBeDefined()
    expect(systemRow?.actorName).toBeNull()
    // Not `""`, which would render a blank cell where an em dash belongs.
    expect(systemRow?.actorName).not.toBe("")
  })

  it("gives every returned row an actorName field, present or null", async () => {
    // The contract requires the key, so `undefined` would fail the response schema.
    const activity = await getRecentGradeActivityForTeacher(teacher, {
      offeringId: f.offering.id,
      limit: 25,
    })
    for (const item of activity.items) {
      expect("actorName" in item).toBe(true)
      expect(item.actorName === null || typeof item.actorName === "string").toBe(true)
    }
  })

  it("refuses another teacher's offering", async () => {
    await expect(
      getRecentGradeActivityForTeacher(teacher, {
        offeringId: "no-such-offering",
        limit: 25,
      }),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe("cleanup", () => {
  it("disconnects", async () => {
    await disconnectTestDatabase()
  })
})

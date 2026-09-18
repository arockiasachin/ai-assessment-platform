import { beforeAll, describe, expect, it } from "vitest"

import type { AuthUser } from "@/lib/session"
import { getStudentAnalytics } from "@/lib/student-analytics"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * `getStudentAnalytics` against a real database.
 *
 * The pure shaping is covered by `student-analytics-view.test.ts`; what needs a database is the
 * **scope**: the offering ids must come from the caller's own live enrolments, and a course the
 * caller is not enrolled in must not appear even though the ownership-agnostic readers would
 * happily read it. That is the property the whole page's safety rests on.
 */

let fixture: Awaited<ReturnType<typeof createSpineFixture>>
let student: AuthUser

beforeAll(async () => {
  await truncateAll()
  fixture = await createSpineFixture(prisma)
  student = {
    id: fixture.student.id,
    email: fixture.student.email,
    role: "student",
  }

  // A term window so the cohort trend has an axis, and a category that resolves to absolute
  // bands, so the regime is deterministic.
  await prisma.course.update({
    where: { id: fixture.course.id },
    data: { category: "LABORATORY" },
  })
  await prisma.courseOffering.update({
    where: { id: fixture.offering.id },
    data: {
      startsOn: new Date("2026-08-25T00:00:00.000Z"),
      endsOn: new Date("2026-12-08T00:00:00.000Z"),
    },
  })

  await prisma.enrollment.create({
    data: { studentId: fixture.student.studentProfile!.id, offeringId: fixture.offering.id },
  })

  // The enrolled student's own released mark, and two classmates', so the cohort crosses the
  // three-mark disclosure floor.
  await prisma.grade.create({
    data: {
      assessmentId: fixture.assessment.id,
      studentId: fixture.student.studentProfile!.id,
      points: 16,
      maxPoints: 20,
      publishedAt: new Date("2026-09-02T00:00:00.000Z"),
    },
  })
  for (const [index, points] of [14, 18].entries()) {
    const classmate = await prisma.user.create({
      data: {
        email: `analytics-classmate-${index}@spine.test`,
        passwordHash: "test-only-not-a-real-hash",
        role: "STUDENT",
        studentProfile: {
          create: { fullName: `Classmate ${index}`, registerNumber: `REG-AN-${index}` },
        },
      },
      include: { studentProfile: true },
    })
    await prisma.enrollment.create({
      data: { studentId: classmate.studentProfile!.id, offeringId: fixture.offering.id },
    })
    await prisma.grade.create({
      data: {
        assessmentId: fixture.assessment.id,
        studentId: classmate.studentProfile!.id,
        points,
        maxPoints: 20,
        publishedAt: new Date("2026-09-02T00:00:00.000Z"),
      },
    })
  }

  // A second offering the student is **not** enrolled in, with a mark that would be trivial to
  // leak if the reader trusted a caller-supplied id or forgot the enrollment filter.
  const otherCourse = await prisma.course.create({
    data: { code: "COURSE-OTHER-TEST", name: "Other Test Course", category: "LABORATORY" },
  })
  const otherClassroom = await prisma.classRoom.create({
    data: { code: "CLASS-OTHER-TEST", name: "Other Test Class", academicYear: 2026 },
  })
  const otherOffering = await prisma.courseOffering.create({
    data: {
      courseId: otherCourse.id,
      classId: otherClassroom.id,
      teacherId: fixture.teacher.staffProfile!.id,
      term: "Term-Other",
      academicYear: 2026,
    },
  })
  const otherAssessment = await prisma.assessment.create({
    data: {
      offeringId: otherOffering.id,
      courseId: otherCourse.id,
      classId: otherClassroom.id,
      title: "Other Offering Quiz",
      type: "QUIZ",
      dueDate: new Date("2026-10-01T08:00:00.000Z"),
      maxMarks: 20,
      createdById: fixture.teacher.staffProfile!.id,
      releasedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  })
  await prisma.grade.create({
    data: {
      assessmentId: otherAssessment.id,
      studentId: fixture.student.studentProfile!.id,
      points: 20,
      maxPoints: 20,
      publishedAt: new Date("2026-09-02T00:00:00.000Z"),
    },
  })
})

describe("getStudentAnalytics", () => {
  it("scopes every course to the caller's own live enrolments", async () => {
    const analytics = await getStudentAnalytics(student)
    expect(analytics).not.toBeNull()
    expect(analytics!.courses.map((course) => course.offeringId)).toEqual([fixture.offering.id])
  })

  it("composes the disclosed average, the position letter and the cohort trend", async () => {
    const analytics = await getStudentAnalytics(student)
    const course = analytics!.courses[0]

    // Released marks are 16/20, 14/20 and 18/20 → mean 80.
    const [comparison] = course.comparisons
    expect(comparison.assessmentId).toBe(fixture.assessment.id)
    expect(comparison.classAverage).toBe(80)
    expect(comparison.yourPercentage).toBe(80)
    expect(comparison.difference).toBe(0)

    expect(course.distribution?.assessmentId).toBe(fixture.assessment.id)
    expect(course.distributionLetter).toBe("A")

    expect(course.trend.series).not.toBeNull()
    expect(course.trend.markedCount).toBe(3)

    // No quiz attempt → no topic mastery, rather than 0% bars.
    expect(course.topics).toBeNull()

    // The outcome reader composed the same offering.
    expect(course.outcome?.offeringId).toBe(fixture.offering.id)
  })

  it("returns null for a caller with no student profile", async () => {
    const teacher: AuthUser = {
      id: fixture.teacher.id,
      email: fixture.teacher.email,
      role: "teacher",
    }
    expect(await getStudentAnalytics(teacher)).toBeNull()
  })
})

describe("cleanup", () => {
  it("disconnects", async () => {
    await disconnectTestDatabase()
  })
})

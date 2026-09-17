import type { PrismaClient } from "@/lib/generated/prisma/client"

/**
 * The smallest meaningful slice of the product spine for data-layer tests:
 * an admin, a teacher, a student, a course, its offering, and an assessment.
 *
 * Kept as a factory (not a global seed) so tests control when it runs and can
 * assert against known values. `truncateAll()` between tests makes fixed
 * unique identifiers safe.
 */
export async function createSpineFixture(prisma: PrismaClient) {
  const admin = await prisma.user.create({
    data: {
      email: "admin@spine.test",
      passwordHash: "test-only-not-a-real-hash",
      role: "ADMIN",
      staffProfile: {
        create: { fullName: "Ada Admin", empId: "EMP-TEST-ADMIN" },
      },
    },
    include: { staffProfile: true },
  })

  const teacher = await prisma.user.create({
    data: {
      email: "teacher@spine.test",
      passwordHash: "test-only-not-a-real-hash",
      role: "TEACHER",
      staffProfile: {
        create: { fullName: "Tara Teacher", empId: "EMP-TEST-TEACHER" },
      },
    },
    include: { staffProfile: true },
  })

  const student = await prisma.user.create({
    data: {
      email: "student@spine.test",
      passwordHash: "test-only-not-a-real-hash",
      role: "STUDENT",
      studentProfile: {
        create: { fullName: "Sam Student", registerNumber: "REG-TEST-STUDENT" },
      },
    },
    include: { studentProfile: true },
  })

  const course = await prisma.course.create({
    data: {
      code: "COURSE-SPINE-TEST",
      name: "Spine Test Course",
      description: "Fixture course for the Phase 1 smoke test.",
      credits: 3,
    },
  })

  const classroom = await prisma.classRoom.create({
    data: { code: "CLASS-SPINE-TEST", name: "Spine Test Class", academicYear: 2026 },
  })

  const offering = await prisma.courseOffering.create({
    data: {
      courseId: course.id,
      classId: classroom.id,
      teacherId: teacher.staffProfile!.id,
      term: "Term-Test",
      academicYear: 2026,
    },
  })

  const assessment = await prisma.assessment.create({
    data: {
      offeringId: offering.id,
      courseId: course.id,
      classId: classroom.id,
      title: "Spine Test Quiz",
      type: "QUIZ",
      dueDate: new Date("2026-10-01T08:00:00.000Z"),
      maxMarks: 20,
      createdById: teacher.staffProfile!.id,
      // Released, deliberately. This fixture is used by the student write paths
      // (`startQuizAttempt`, `startPracticeAttempt`, the submission route), and those paths now
      // scope on release. Leaving it unreleased encoded the SN-5 bug and would have refused every
      // one of them; the release fact belongs in the setup, so the assertions stay untouched.
      // Tests that need the unreleased branch create their own assessment with `releasedAt: null`.
      releasedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  })

  return { admin, teacher, student, course, classroom, offering, assessment }
}

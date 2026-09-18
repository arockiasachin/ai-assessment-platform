import "server-only"

import { releasedAssessmentWhere } from "@/lib/assessment-visibility"
import { liveEnrollmentStatuses } from "@/lib/enrollment-scope"
import { ASSESSMENT_KIND_LABEL } from "@/lib/labels"
import { prisma } from "@/lib/prisma"
import type { SearchGroup, SearchGroupKey, SearchHit, SearchRole } from "@/lib/search"
import { SEARCH_LIMIT_PER_GROUP, shapeSearchGroups } from "@/lib/search"
import type { AuthUser } from "@/lib/session"
import { resolveTeacherStaffId } from "@/lib/teacher-staff"

/**
 * Role-scoped quick-search on the server.
 *
 * Every branch below answers exactly the question "which of **the caller's own**
 * entities match this text?", reusing the same enrollment/ownership predicates
 * the corresponding list pages use, so search can never surface a row a page
 * would not. There is deliberately no `Assessment.findMany` without an owner
 * filter and no `StudentProfile.findMany` without an offering scope.
 *
 * Each group is `take`-limited at the query (and capped again in
 * `shapeSearchGroups`), and no total is returned — see `lib/search.ts` for why
 * that matters for enumeration.
 */

/** Case-insensitive substring match; the repo's database is Postgres. */
function contains(query: string) {
  return { contains: query, mode: "insensitive" as const }
}

export async function searchForUser(user: AuthUser, query: string): Promise<SearchGroup[]> {
  const role: SearchRole =
    user.role === "student" ? "student" : user.role === "teacher" ? "teacher" : "admin"
  if (role === "admin") {
    // No admin search scope exists yet; an empty result is honest, a global one
    // would be a new authorization surface nobody designed.
    return shapeSearchGroups(role, query, {}).groups
  }

  const raw: Partial<Record<SearchGroupKey, SearchHit[]>> =
    role === "student" ? await searchAsStudent(user, query) : await searchAsTeacher(user, query)

  return shapeSearchGroups(role, query, raw).groups
}

async function searchAsStudent(
  user: AuthUser,
  query: string,
): Promise<Partial<Record<SearchGroupKey, SearchHit[]>>> {
  const student = await prisma.studentProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  })
  if (!student) return {}

  const [assessments, offerings, resources] = await Promise.all([
    prisma.assessment.findMany({
      where: {
        ...releasedAssessmentWhere(),
        offering: {
          enrollments: {
            some: { studentId: student.id, status: { in: liveEnrollmentStatuses() } },
          },
        },
        OR: [{ title: contains(query) }, { course: { code: contains(query) } }],
      },
      select: { id: true, title: true, type: true, course: { select: { code: true } } },
      orderBy: [{ dueDate: "desc" }],
      take: SEARCH_LIMIT_PER_GROUP,
    }),
    prisma.courseOffering.findMany({
      where: {
        enrollments: { some: { studentId: student.id, status: { in: liveEnrollmentStatuses() } } },
        course: {
          OR: [{ code: contains(query) }, { name: contains(query) }],
        },
      },
      select: { id: true, course: { select: { code: true, name: true } } },
      orderBy: [{ academicYear: "desc" }, { term: "asc" }],
      take: SEARCH_LIMIT_PER_GROUP,
    }),
    (async () => {
      const enrollments = await prisma.enrollment.findMany({
        where: { studentId: student.id, status: "active" },
        select: { offeringId: true, offering: { select: { courseId: true } } },
      })
      if (enrollments.length === 0) return []
      const offeringIds = enrollments.map((enrollment) => enrollment.offeringId)
      const courseIds = [...new Set(enrollments.map((e) => e.offering.courseId))]
      return prisma.material.findMany({
        where: {
          title: contains(query),
          // The exact scope `listMaterialsForStudent` uses, so a search hit is
          // always something the resources page would show.
          OR: [
            { offeringId: { in: offeringIds } },
            { offeringId: null, courseId: { in: courseIds } },
          ],
        },
        select: { id: true, title: true, course: { select: { code: true } } },
        orderBy: { updatedAt: "desc" },
        take: SEARCH_LIMIT_PER_GROUP,
      })
    })(),
  ])

  return {
    assessments: assessments.map((assessment) => ({
      id: assessment.id,
      label: assessment.title,
      description: `${assessment.course.code} · ${ASSESSMENT_KIND_LABEL[assessment.type]}`,
      href: "/student/assessments",
    })),
    courses: offerings.map((offering) => ({
      id: offering.id,
      label: offering.course.code,
      description: offering.course.name,
      href: "/student/courses",
    })),
    resources: resources.map((material) => ({
      id: material.id,
      label: material.title,
      description: material.course.code,
      href: "/student/resources",
    })),
  }
}

async function searchAsTeacher(
  user: AuthUser,
  query: string,
): Promise<Partial<Record<SearchGroupKey, SearchHit[]>>> {
  const staffId = await resolveTeacherStaffId(user.id)
  if (!staffId) return {}

  const [assessments, offerings, students] = await Promise.all([
    prisma.assessment.findMany({
      where: {
        offering: { teacherId: staffId },
        OR: [{ title: contains(query) }, { course: { code: contains(query) } }],
      },
      select: { id: true, title: true, type: true, course: { select: { code: true } } },
      orderBy: [{ dueDate: "desc" }],
      take: SEARCH_LIMIT_PER_GROUP,
    }),
    prisma.courseOffering.findMany({
      where: {
        teacherId: staffId,
        course: { OR: [{ code: contains(query) }, { name: contains(query) }] },
      },
      select: { id: true, course: { select: { code: true, name: true } } },
      orderBy: [{ academicYear: "desc" }, { term: "asc" }],
      take: SEARCH_LIMIT_PER_GROUP,
    }),
    prisma.studentProfile.findMany({
      where: {
        enrollments: { some: { status: "active", offering: { teacherId: staffId } } },
        OR: [
          { fullName: contains(query) },
          { registerNumber: contains(query) },
          { user: { email: contains(query) } },
        ],
      },
      select: { id: true, fullName: true, registerNumber: true },
      orderBy: { fullName: "asc" },
      take: SEARCH_LIMIT_PER_GROUP,
    }),
  ])

  return {
    assessments: assessments.map((assessment) => ({
      id: assessment.id,
      label: assessment.title,
      description: `${assessment.course.code} · ${ASSESSMENT_KIND_LABEL[assessment.type]}`,
      href: "/teacher/assignments",
    })),
    offerings: offerings.map((offering) => ({
      id: offering.id,
      label: offering.course.code,
      description: offering.course.name,
      href: "/teacher/offerings",
    })),
    students: students.map((student) => ({
      id: student.id,
      label: student.fullName,
      description: student.registerNumber,
      href: "/teacher/classes",
    })),
  }
}

import "server-only"

import { prisma } from "@/lib/prisma"

type DbAssessmentType = "QUIZ" | "ASSIGNMENT" | "DESCRIPTIVE" | "CODE" | "GROUP_PROJECT"

export type AdminOverview = {
  totals: {
    users: number
    teachers: number
    students: number
    courses: number
    offerings: number
    assessments: number
    upcomingEvents: number
  }
  roleCounts: {
    admin: number
    teacher: number
    student: number
  }
  recentAssessments: Array<{
    id: string
    title: string
    type: DbAssessmentType
    dueDate: string
    courseName: string
    teacherName: string
  }>
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const [
    users,
    staff,
    students,
    courses,
    offerings,
    assessments,
    upcomingEvents,
    roleCounts,
    recentAssessments,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.staffProfile.count(),
    prisma.studentProfile.count(),
    prisma.course.count(),
    prisma.courseOffering.count(),
    prisma.assessment.count(),
    prisma.calendarEvent.count({ where: { isUpcoming: true } }),
    prisma.user.groupBy({
      by: ["role"],
      _count: { role: true },
    }),
    prisma.assessment.findMany({
      take: 6,
      orderBy: { createdAt: "desc" },
      include: {
        course: { select: { name: true } },
        createdBy: { select: { fullName: true } },
      },
    }),
  ])

  const roleCountMap = {
    admin: 0,
    teacher: 0,
    student: 0,
  }

  for (const row of roleCounts) {
    if (row.role === "ADMIN") roleCountMap.admin = row._count.role
    if (row.role === "TEACHER") roleCountMap.teacher = row._count.role
    if (row.role === "STUDENT") roleCountMap.student = row._count.role
  }

  return {
    totals: {
      users,
      teachers: staff,
      students,
      courses,
      offerings,
      assessments,
      upcomingEvents,
    },
    roleCounts: roleCountMap,
    recentAssessments: recentAssessments.map((assessment) => ({
      id: assessment.id,
      title: assessment.title,
      type: assessment.type,
      dueDate: assessment.dueDate.toISOString(),
      courseName: assessment.course.name,
      teacherName: assessment.createdBy.fullName,
    })),
  }
}

export async function getAdminUsersList() {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      staffProfile: { select: { fullName: true, empId: true } },
      studentProfile: { select: { fullName: true, registerNumber: true } },
    },
  })

  return users.map((user) => ({
    id: user.id,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
    name: user.staffProfile?.fullName ?? user.studentProfile?.fullName ?? "-",
    identity: user.staffProfile?.empId ?? user.studentProfile?.registerNumber ?? "-",
  }))
}

export async function getAdminOfferingsList() {
  const offerings = await prisma.courseOffering.findMany({
    orderBy: [{ academicYear: "desc" }, { term: "asc" }],
    include: {
      course: { select: { code: true, name: true } },
      classRoom: { select: { code: true, name: true, section: true } },
      teacher: { select: { fullName: true, empId: true } },
      enrollments: { select: { id: true } },
      assessments: { select: { id: true } },
    },
    take: 300,
  })

  return offerings.map((offering) => ({
    id: offering.id,
    courseCode: offering.course.code,
    courseName: offering.course.name,
    classCode: offering.classRoom.code,
    className: `${offering.classRoom.name}${offering.classRoom.section ? ` ${offering.classRoom.section}` : ""}`,
    teacherName: offering.teacher.fullName,
    teacherEmpId: offering.teacher.empId,
    academicYear: offering.academicYear,
    term: offering.term,
    capacity: offering.studentLimit,
    enrolled: offering.enrollments.length,
    assessments: offering.assessments.length,
  }))
}

export function toPlainRows<T>(rows: T[]): Record<string, unknown>[] {
  return JSON.parse(
    JSON.stringify(rows, (_key, value) => {
      if (typeof value === "bigint") return value.toString()
      return value
    }),
  ) as Record<string, unknown>[]
}

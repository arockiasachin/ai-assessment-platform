import type { PrismaClient } from "@/lib/generated/prisma/client"
import type { AuthUser } from "@/lib/session"

import { createSpineFixture } from "./spine"

/**
 * Spine fixture plus a small roster and three assessments with different
 * ceilings, so the weighted-final-grade and OneRoster tests can control exactly
 * which modern/legacy rows exist and which are published.
 */

export type LmsExportStudent = {
  userId: string
  email: string
  profileId: string
  fullName: string
  registerNumber: string
}

export async function createLmsExportFixture(
  prisma: PrismaClient,
  options: { studentCount?: number } = {},
) {
  const spine = await createSpineFixture(prisma)
  const studentCount = options.studentCount ?? 3

  const assessment2 = await prisma.assessment.create({
    data: {
      offeringId: spine.offering.id,
      courseId: spine.course.id,
      classId: spine.classroom.id,
      title: "Assignment, with punctuation",
      type: "ASSIGNMENT",
      dueDate: new Date("2026-10-08T08:00:00.000Z"),
      maxMarks: 10,
      createdById: spine.teacher.staffProfile!.id,
    },
  })

  const assessment3 = await prisma.assessment.create({
    data: {
      offeringId: spine.offering.id,
      courseId: spine.course.id,
      classId: spine.classroom.id,
      title: 'Descriptive "essay"\nwith a newline',
      type: "DESCRIPTIVE",
      dueDate: new Date("2026-10-15T08:00:00.000Z"),
      maxMarks: 30,
      createdById: spine.teacher.staffProfile!.id,
    },
  })

  const students: LmsExportStudent[] = [
    {
      userId: spine.student.id,
      email: spine.student.email,
      profileId: spine.student.studentProfile!.id,
      fullName: spine.student.studentProfile!.fullName,
      registerNumber: spine.student.studentProfile!.registerNumber,
    },
  ]

  for (let index = 1; index < studentCount; index += 1) {
    const user = await prisma.user.create({
      data: {
        email: `lms-export-student-${index}@test.local`,
        passwordHash: "test-only-not-a-real-hash",
        role: "STUDENT",
        studentProfile: {
          create: {
            fullName: `LMS Student ${index}`,
            registerNumber: `REG-LMS-${index}`,
          },
        },
      },
      include: { studentProfile: true },
    })
    const profile = user.studentProfile!
    students.push({
      userId: user.id,
      email: user.email,
      profileId: profile.id,
      fullName: profile.fullName,
      registerNumber: profile.registerNumber,
    })
  }

  for (const student of students) {
    await prisma.enrollment.create({
      data: { studentId: student.profileId, offeringId: spine.offering.id, status: "active" },
    })
  }

  return {
    ...spine,
    assessments: [spine.assessment, assessment2, assessment3],
    students,
  }
}

/** A published modern `Grade` — the only kind that may influence a final grade. */
export async function publishModernGrade(
  prisma: PrismaClient,
  args: {
    assessmentId: string
    studentId: string
    points: number
    maxPoints: number
    publishedAt?: Date
  },
) {
  const publishedAt = args.publishedAt ?? new Date("2026-11-01T10:00:00.000Z")
  return prisma.grade.create({
    data: {
      assessmentId: args.assessmentId,
      studentId: args.studentId,
      points: args.points,
      maxPoints: args.maxPoints,
      percentage: args.maxPoints > 0 ? (args.points / args.maxPoints) * 100 : null,
      source: "AI_SUGGESTED",
      publishedAt,
    },
  })
}

/** An unpublished modern `Grade` — a pending AI suggestion a teacher has not approved. */
export async function createDraftModernGrade(
  prisma: PrismaClient,
  args: { assessmentId: string; studentId: string; points: number; maxPoints: number },
) {
  return prisma.grade.create({
    data: {
      assessmentId: args.assessmentId,
      studentId: args.studentId,
      points: args.points,
      maxPoints: args.maxPoints,
      percentage: args.maxPoints > 0 ? (args.points / args.maxPoints) * 100 : null,
      source: "AI_SUGGESTED",
      publishedAt: null,
    },
  })
}

/** A legacy `AssessmentGrade` mark, the fallback for pre-spine assessments. */
export async function createLegacyGrade(
  prisma: PrismaClient,
  args: { assessmentId: string; studentId: string; marksObtained: number; gradedAt?: Date },
) {
  return prisma.assessmentGrade.create({
    data: {
      assessmentId: args.assessmentId,
      studentId: args.studentId,
      marksObtained: args.marksObtained,
      gradedAt: args.gradedAt ?? new Date("2026-09-15T10:00:00.000Z"),
    },
  })
}

export function lmsTeacherSession(spine: { teacher: { id: string; email: string } }): AuthUser {
  return { id: spine.teacher.id, email: spine.teacher.email, role: "teacher" }
}

export function lmsStudentSession(student: LmsExportStudent): AuthUser {
  return { id: student.userId, email: student.email, role: "student" }
}

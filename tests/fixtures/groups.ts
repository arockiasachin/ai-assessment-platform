import type { PrismaClient } from "@/lib/generated/prisma/client"
import type { AuthUser } from "@/lib/session"

import { createSpineFixture } from "./spine"

/**
 * Spine fixture plus N actively enrolled students, for the groups pod. Kept as a
 * factory so each test controls its own roster and `truncateAll()` keeps fixed
 * unique identifiers safe.
 */

export type GroupsStudent = {
  userId: string
  email: string
  profileId: string
  fullName: string
  registerNumber: string
}

export async function createGroupsFixture(
  prisma: PrismaClient,
  options: { studentCount?: number } = {},
) {
  const spine = await createSpineFixture(prisma)
  const studentCount = options.studentCount ?? 4
  const students: GroupsStudent[] = []

  for (let index = 0; index < studentCount; index += 1) {
    const user = await prisma.user.create({
      data: {
        email: `group-student-${index}@test.local`,
        passwordHash: "test-only-not-a-real-hash",
        role: "STUDENT",
        studentProfile: {
          create: {
            fullName: `Group Student ${index}`,
            registerNumber: `REG-GROUP-${index}`,
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
    await prisma.enrollment.create({
      data: { studentId: profile.id, offeringId: spine.offering.id, status: "active" },
    })
  }

  return { ...spine, students }
}

export function teacherSession(spine: { teacher: { id: string; email: string } }): AuthUser {
  return { id: spine.teacher.id, email: spine.teacher.email, role: "teacher" }
}

export function studentSession(student: GroupsStudent): AuthUser {
  return { id: student.userId, email: student.email, role: "student" }
}

export async function createGroupWithMembers(
  prisma: PrismaClient,
  offeringId: string,
  name: string,
  studentIds: string[],
) {
  const group = await prisma.group.create({ data: { offeringId, name } })
  await prisma.groupMember.createMany({
    data: studentIds.map((studentId) => ({ groupId: group.id, studentId })),
  })
  return group
}

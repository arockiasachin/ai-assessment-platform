import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"

import { GroupError } from "./errors"

/**
 * Object-level authorization for the groups / peer-evaluation pod.
 *
 * Route handlers enforce `requireRole`. These helpers add the second half: a
 * teacher only ever touches an offering (and therefore a group) they teach, and a
 * student only ever touches their own profile and their own groups. Ownership is
 * always read from the signed session, never from the request body.
 */

export async function resolveTeacherStaffId(user: AuthUser): Promise<string> {
  if (user.role !== "teacher") throw new GroupError(403, "Forbidden")
  const staff = await prisma.staffProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  })
  if (!staff) throw new GroupError(403, "Teacher profile not found.")
  return staff.id
}

export type OwnedOffering = {
  id: string
  teacherId: string
  courseId: string
  courseCode: string
  courseName: string
  className: string
}

export async function loadOwnedOffering(
  user: AuthUser,
  offeringId: string,
): Promise<OwnedOffering> {
  const staffId = await resolveTeacherStaffId(user)
  const offering = await prisma.courseOffering.findUnique({
    where: { id: offeringId },
    select: {
      id: true,
      teacherId: true,
      courseId: true,
      course: { select: { code: true, name: true } },
      classRoom: { select: { name: true, section: true } },
    },
  })
  if (!offering) throw new GroupError(404, "Course offering not found.")
  if (offering.teacherId !== staffId) throw new GroupError(403, "Forbidden")
  const section = offering.classRoom.section
  return {
    id: offering.id,
    teacherId: offering.teacherId,
    courseId: offering.courseId,
    courseCode: offering.course.code,
    courseName: offering.course.name,
    className: `${offering.classRoom.name}${section ? ` ${section}` : ""}`,
  }
}

export async function assertTeacherOwnsOffering(
  user: AuthUser,
  offeringId: string,
): Promise<string> {
  const offering = await loadOwnedOffering(user, offeringId)
  return offering.id
}

/** The group id after confirming the signed-in teacher owns its offering. */
export async function assertTeacherOwnsGroup(user: AuthUser, groupId: string): Promise<void> {
  const staffId = await resolveTeacherStaffId(user)
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { id: true, offering: { select: { teacherId: true } } },
  })
  if (!group) throw new GroupError(404, "Group not found.")
  if (group.offering.teacherId !== staffId) throw new GroupError(403, "Forbidden")
}

export type StudentIdentity = {
  studentId: string
  userId: string
  fullName: string
  registerNumber: string
}

export async function resolveStudentProfile(user: AuthUser): Promise<StudentIdentity> {
  if (user.role !== "student") throw new GroupError(403, "Forbidden")
  const profile = await prisma.studentProfile.findUnique({
    where: { userId: user.id },
    select: { id: true, userId: true, fullName: true, registerNumber: true },
  })
  if (!profile) throw new GroupError(403, "Student profile not found.")
  return {
    studentId: profile.id,
    userId: profile.userId,
    fullName: profile.fullName,
    registerNumber: profile.registerNumber,
  }
}

export type ActiveGroupMembership = {
  groupId: string
  offeringId: string
  groupName: string
  projectTitle: string | null
  courseCode: string
  courseName: string
  status: string
}

/**
 * Every group the student is (or was) an active member of. A student's peer
 * evaluation routes are scoped to exactly this list.
 */
export async function listStudentGroupMemberships(
  studentId: string,
): Promise<ActiveGroupMembership[]> {
  const memberships = await prisma.groupMember.findMany({
    where: { studentId, leftAt: null },
    select: {
      group: {
        select: {
          id: true,
          offeringId: true,
          name: true,
          projectTitle: true,
          status: true,
          offering: {
            select: { course: { select: { code: true, name: true } } },
          },
        },
      },
    },
    orderBy: { joinedAt: "asc" },
  })
  return memberships.map((membership) => ({
    groupId: membership.group.id,
    offeringId: membership.group.offeringId,
    groupName: membership.group.name,
    projectTitle: membership.group.projectTitle,
    courseCode: membership.group.offering.course.code,
    courseName: membership.group.offering.course.name,
    status: membership.group.status,
  }))
}

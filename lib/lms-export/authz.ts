import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"

import { LmsExportError } from "./errors"

/**
 * Object-level authorization for the LMS-export pod.
 *
 * Route handlers enforce `requireRole`; these helpers add the second half. A
 * teacher only exports grades for an offering they teach, and a student only
 * ever sees their own rows. Ownership is always resolved from the signed
 * session, never from the request body.
 */

export async function resolveTeacherStaffId(user: AuthUser): Promise<string> {
  if (user.role !== "teacher") throw new LmsExportError(403, "Forbidden")
  const staff = await prisma.staffProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  })
  if (!staff) throw new LmsExportError(403, "Teacher profile not found.")
  return staff.id
}

export type OwnedOffering = {
  id: string
  courseId: string
  classId: string
  teacherId: string
  term: string
  academicYear: number
  courseCode: string
  courseName: string
  className: string
}

/** Load offering metadata without an ownership check (callers must authorize). */
export async function loadOfferingMeta(offeringId: string): Promise<OwnedOffering> {
  const offering = await prisma.courseOffering.findUnique({
    where: { id: offeringId },
    select: {
      id: true,
      courseId: true,
      classId: true,
      teacherId: true,
      term: true,
      academicYear: true,
      course: { select: { code: true, name: true } },
      classRoom: { select: { name: true, section: true } },
    },
  })
  if (!offering) throw new LmsExportError(404, "Course offering not found.")
  return {
    id: offering.id,
    courseId: offering.courseId,
    classId: offering.classId,
    teacherId: offering.teacherId,
    term: offering.term,
    academicYear: offering.academicYear,
    courseCode: offering.course.code,
    courseName: offering.course.name,
    className: offering.classRoom.section
      ? `${offering.classRoom.name} ${offering.classRoom.section}`
      : offering.classRoom.name,
  }
}

/** Load an offering and confirm the signed-in teacher owns it. */
export async function loadOwnedOffering(
  user: AuthUser,
  offeringId: string,
): Promise<OwnedOffering> {
  const staffId = await resolveTeacherStaffId(user)
  const offering = await loadOfferingMeta(offeringId)
  if (offering.teacherId !== staffId) throw new LmsExportError(403, "Forbidden")
  return offering
}

export type StudentIdentity = {
  studentId: string
  userId: string
  fullName: string
  registerNumber: string
}

export async function resolveStudentProfile(user: AuthUser): Promise<StudentIdentity> {
  if (user.role !== "student") throw new LmsExportError(403, "Forbidden")
  const profile = await prisma.studentProfile.findUnique({
    where: { userId: user.id },
    select: { id: true, userId: true, fullName: true, registerNumber: true },
  })
  if (!profile) throw new LmsExportError(403, "Student profile not found.")
  return {
    studentId: profile.id,
    userId: profile.userId,
    fullName: profile.fullName,
    registerNumber: profile.registerNumber,
  }
}

/**
 * Confirm the signed-in student has an active enrollment in the offering. A
 * non-enrolled student is refused (403), so a guessed offering id leaks nothing.
 */
export async function assertActiveEnrollment(studentId: string, offeringId: string): Promise<void> {
  const enrollment = await prisma.enrollment.findUnique({
    where: { studentId_offeringId: { studentId, offeringId } },
    select: { status: true },
  })
  if (!enrollment || enrollment.status !== "active") {
    throw new LmsExportError(403, "You are not enrolled in this course offering.")
  }
}

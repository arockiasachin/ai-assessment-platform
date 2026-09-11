import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"

import type { AnalyticsOfferingSummary } from "@/lib/contracts/analytics"

import { AnalyticsError } from "./errors"

/**
 * Object-level authorization for the analytics pod.
 *
 * Route handlers enforce `requireRole`; these helpers add the second half. A
 * teacher only ever reads analytics for an assessment they created or that
 * belongs to an offering they teach, and a student only ever reads their own
 * attempts. Ownership is always resolved from the signed session, never from
 * the request body.
 */

export async function resolveTeacherStaffId(user: AuthUser): Promise<string> {
  if (user.role !== "teacher") throw new AnalyticsError(403, "Forbidden")
  const staff = await prisma.staffProfile.findUnique({
    where: { userId: user.id },
    select: { id: true },
  })
  if (!staff) throw new AnalyticsError(403, "Teacher profile not found.")
  return staff.id
}

function offeringLabel(name: string, section: string | null): string {
  return section ? `${name} ${section}` : name
}

export async function loadOwnedOffering(
  user: AuthUser,
  offeringId: string,
): Promise<AnalyticsOfferingSummary> {
  const staffId = await resolveTeacherStaffId(user)
  const offering = await prisma.courseOffering.findUnique({
    where: { id: offeringId },
    select: {
      id: true,
      teacherId: true,
      term: true,
      academicYear: true,
      course: { select: { code: true, name: true } },
      classRoom: { select: { name: true, section: true } },
    },
  })
  if (!offering) throw new AnalyticsError(404, "Course offering not found.")
  if (offering.teacherId !== staffId) throw new AnalyticsError(403, "Forbidden")
  return {
    id: offering.id,
    courseCode: offering.course.code,
    courseName: offering.course.name,
    className: offeringLabel(offering.classRoom.name, offering.classRoom.section),
    term: offering.term,
    academicYear: offering.academicYear,
  }
}

export type OwnedAssessment = {
  id: string
  title: string
  type: string
  offeringId: string
  maxMarks: number
  createdById: string
  offeringTeacherId: string
}

/**
 * Load an assessment and confirm the signed-in teacher owns it: either they
 * created it, or they teach its offering. Anything else is a 403, so a teacher
 * can never read another teacher's item analysis by guessing an id.
 */
export async function loadOwnedAssessment(
  user: AuthUser,
  assessmentId: string,
): Promise<OwnedAssessment> {
  const staffId = await resolveTeacherStaffId(user)
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: {
      id: true,
      title: true,
      type: true,
      offeringId: true,
      maxMarks: true,
      createdById: true,
      offering: { select: { teacherId: true } },
    },
  })
  if (!assessment) throw new AnalyticsError(404, "Assessment not found.")
  const ownsIt = assessment.createdById === staffId || assessment.offering.teacherId === staffId
  if (!ownsIt) throw new AnalyticsError(403, "Forbidden")
  return {
    id: assessment.id,
    title: assessment.title,
    type: assessment.type,
    offeringId: assessment.offeringId,
    maxMarks: assessment.maxMarks,
    createdById: assessment.createdById,
    offeringTeacherId: assessment.offering.teacherId,
  }
}

export type StudentIdentity = {
  studentId: string
  userId: string
  fullName: string
  registerNumber: string
}

export async function resolveStudentProfile(user: AuthUser): Promise<StudentIdentity> {
  if (user.role !== "student") throw new AnalyticsError(403, "Forbidden")
  const profile = await prisma.studentProfile.findUnique({
    where: { userId: user.id },
    select: { id: true, userId: true, fullName: true, registerNumber: true },
  })
  if (!profile) throw new AnalyticsError(403, "Student profile not found.")
  return {
    studentId: profile.id,
    userId: profile.userId,
    fullName: profile.fullName,
    registerNumber: profile.registerNumber,
  }
}

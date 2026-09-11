import { NextResponse } from "next/server"

import { requireRole } from "@/lib/authz"
import { prisma } from "@/lib/prisma"

type RebalanceResult = {
  offeringId: string
  courseCode: string
  classCode: string
  previousTeacherId: string
  nextTeacherId: string
  status: "updated" | "unchanged" | "skipped"
  reason?: string
}

export async function POST() {
  const auth = await requireRole("admin")
  if (!auth.authorized) return auth.response

  const [samuel, aisha] = await Promise.all([
    prisma.staffProfile.findUnique({ where: { empId: "EMP-T-3002" }, select: { id: true } }),
    prisma.staffProfile.findUnique({ where: { empId: "EMP-T-3003" }, select: { id: true } }),
  ])

  if (!samuel || !aisha) {
    return NextResponse.json(
      {
        success: false,
        message: "Required dev teacher profiles not found. Run POST /api/auth/seed as admin first.",
      },
      { status: 400 },
    )
  }

  const teacherByOfferingKey: Record<string, string> = {
    "COURSE-ALG-11:CLASS-10-CEDAR": samuel.id,
    "COURSE-CSI-11:CLASS-11-MAPLE": aisha.id,
    "COURSE-STA-12:CLASS-12-OAK": samuel.id,
    "COURSE-LIT-11:CLASS-11-ASH": aisha.id,
    "COURSE-CMP-12:CLASS-12-BIRCH": samuel.id,
    "COURSE-MATH:CLASS-11-C": samuel.id,
    "COURSE-SCI:CLASS-11-C": samuel.id,
  }

  const offerings = await prisma.courseOffering.findMany({
    include: {
      course: {
        select: {
          code: true,
        },
      },
      classRoom: {
        select: {
          code: true,
        },
      },
    },
  })

  const results: RebalanceResult[] = []

  for (const offering of offerings) {
    const offeringKey = `${offering.course.code}:${offering.classRoom.code}`
    const targetTeacherId = teacherByOfferingKey[offeringKey]
    if (!targetTeacherId) {
      continue
    }

    if (offering.teacherId === targetTeacherId) {
      results.push({
        offeringId: offering.id,
        courseCode: offering.course.code,
        classCode: offering.classRoom.code,
        previousTeacherId: offering.teacherId,
        nextTeacherId: targetTeacherId,
        status: "unchanged",
      })
      continue
    }

    const conflicting = await prisma.courseOffering.findFirst({
      where: {
        id: { not: offering.id },
        courseId: offering.courseId,
        classId: offering.classId,
        teacherId: targetTeacherId,
        term: offering.term,
        academicYear: offering.academicYear,
      },
      select: { id: true },
    })

    if (conflicting) {
      results.push({
        offeringId: offering.id,
        courseCode: offering.course.code,
        classCode: offering.classRoom.code,
        previousTeacherId: offering.teacherId,
        nextTeacherId: targetTeacherId,
        status: "skipped",
        reason: `Conflict: matching offering already exists (${conflicting.id}).`,
      })
      continue
    }

    await prisma.courseOffering.update({
      where: { id: offering.id },
      data: { teacherId: targetTeacherId },
    })

    results.push({
      offeringId: offering.id,
      courseCode: offering.course.code,
      classCode: offering.classRoom.code,
      previousTeacherId: offering.teacherId,
      nextTeacherId: targetTeacherId,
      status: "updated",
    })
  }

  return NextResponse.json({
    success: true,
    summary: {
      updated: results.filter((r) => r.status === "updated").length,
      unchanged: results.filter((r) => r.status === "unchanged").length,
      skipped: results.filter((r) => r.status === "skipped").length,
    },
    results,
  })
}

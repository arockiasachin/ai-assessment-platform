import "server-only"

import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"
import { resolveTeacherStaffId } from "@/lib/teacher-staff"

/**
 * The teacher's class roster.
 *
 * This is the half of the old `/teacher/classes` page that the mockup design
 * actually shows: the students in the teacher's offerings. The page previously
 * administered offerings instead, and the two were split — see
 * `docs/plans/wave-1.md` §D1. Offering administration lives at
 * `/teacher/offerings`.
 *
 * Two of the mockup roster's six columns are **not served**, because nothing can
 * derive them honestly:
 *  - "Last active": no activity or login timestamp exists on any model.
 *  - "Standing": the real intervention alerts are offering-level
 *    (`lib/analytics/alerts.ts`), with no per-student flag and no column.
 * They are omitted rather than faked, per the plan's rule that no page renders a
 * number nothing derives.
 */

export type TeacherRosterRow = {
  offeringId: string
  offeringLabel: string
  studentId: string
  studentName: string
  registerNumber: string | null
  email: string
  /** The student's group in this offering, or `null` when not placed. */
  groupName: string | null
  /**
   * Mean of this student's **published** marks in the offering, as a percentage.
   * `null` means nothing is marked yet — never `0`, which would read as a fail.
   */
  avgPercent: number | null
  /**
   * Assessments the student has actually handed in (a saved draft does not
   * count), out of the offering's assessment count.
   */
  submittedCount: number
  assessmentCount: number
}

/**
 * The subset the projection reads. Declared structurally so the mapper is a
 * **pure function** and can be tested without a database.
 */
export type RosterQueryRow = {
  offeringId: string
  offeringLabel: string
  studentId: string
  studentName: string
  registerNumber: string | null
  email: string
  groupName: string | null
  /** Published grades only — the caller filters. */
  marks: Array<{ points: unknown; maxPoints: unknown }>
  submittedCount: number
  assessmentCount: number
}

/** "MATH-101 · Algebra Foundations — Main Hall A · 2026 Odd" from the parts we have. */
export function offeringLabel(offering: {
  course: { code: string; name: string }
  classRoom: { name: string; section: string | null }
  term: string
  /** `CourseOffering.academicYear` is an `Int` in the schema. */
  academicYear: number | string
}): string {
  const room = offering.classRoom.section
    ? `${offering.classRoom.name} ${offering.classRoom.section}`
    : offering.classRoom.name
  return `${offering.course.code} · ${offering.course.name} — ${room} · ${offering.academicYear} ${offering.term}`
}

/**
 * Pure projection, so the read path has a test that needs no database.
 *
 * The invariant that matters most: **no marks yields `null`, never `0`** — a
 * student who has not been marked yet is not a student who scored nothing. A
 * mark with a non-positive or non-finite ceiling is discarded for the same
 * reason a non-finite mark is in `lib/teacher-submissions.ts`: Postgres `numeric`
 * can hold `NaN`, and averaging it would poison the mean.
 */
export function toTeacherRosterRow(row: RosterQueryRow): TeacherRosterRow {
  const percents = row.marks
    .map((mark) => ({ points: Number(mark.points), maxPoints: Number(mark.maxPoints) }))
    .filter(
      (mark) =>
        Number.isFinite(mark.points) && Number.isFinite(mark.maxPoints) && mark.maxPoints > 0,
    )
    .map((mark) => (mark.points / mark.maxPoints) * 100)

  const avgPercent =
    percents.length === 0
      ? null
      : Math.round((percents.reduce((sum, value) => sum + value, 0) / percents.length) * 10) / 10

  return {
    offeringId: row.offeringId,
    offeringLabel: row.offeringLabel,
    studentId: row.studentId,
    studentName: row.studentName,
    registerNumber: row.registerNumber,
    email: row.email,
    groupName: row.groupName,
    avgPercent,
    submittedCount: row.submittedCount,
    assessmentCount: row.assessmentCount,
  }
}

/**
 * Every actively-enrolled student across the offerings this teacher owns, with
 * their group, published-mark average and hand-in count.
 *
 * Published marks only: an unreleased mark is not a student-facing fact, and it
 * is not a teacher-facing fact either — the review queue is where a pending mark
 * belongs, not a roster average.
 */
export async function listRosterForTeacher(user: AuthUser): Promise<TeacherRosterRow[]> {
  const staffId = await resolveTeacherStaffId(user.id)
  if (!staffId) return []

  const offerings = await prisma.courseOffering.findMany({
    where: { teacherId: staffId },
    select: {
      id: true,
      term: true,
      academicYear: true,
      course: { select: { code: true, name: true } },
      classRoom: { select: { name: true, section: true } },
      assessments: { select: { id: true } },
      enrollments: {
        where: { status: "active" },
        select: {
          student: {
            select: {
              id: true,
              fullName: true,
              registerNumber: true,
              user: { select: { email: true } },
              groupMemberships: {
                select: { group: { select: { name: true, offeringId: true } } },
              },
            },
          },
        },
      },
    },
    orderBy: [{ academicYear: "desc" }, { term: "asc" }],
  })

  const assessmentIds = offerings.flatMap((offering) => offering.assessments.map((a) => a.id))
  if (assessmentIds.length === 0) {
    return offerings.flatMap((offering) =>
      offering.enrollments.map((enrollment) =>
        toTeacherRosterRow({
          offeringId: offering.id,
          offeringLabel: offeringLabel(offering),
          studentId: enrollment.student.id,
          studentName: enrollment.student.fullName,
          registerNumber: enrollment.student.registerNumber,
          email: enrollment.student.user.email,
          groupName:
            enrollment.student.groupMemberships.find((m) => m.group.offeringId === offering.id)
              ?.group.name ?? null,
          marks: [],
          submittedCount: 0,
          assessmentCount: 0,
        }),
      ),
    )
  }

  const [grades, submissions] = await Promise.all([
    prisma.grade.findMany({
      where: { assessmentId: { in: assessmentIds }, publishedAt: { not: null } },
      select: { assessmentId: true, studentId: true, points: true, maxPoints: true },
    }),
    prisma.submission.findMany({
      // A saved draft is not a hand-in, so it is excluded here for the same
      // reason the submissions queue excludes it from its "Submitted" tile.
      where: { assessmentId: { in: assessmentIds }, status: { not: "DRAFT" } },
      select: { assessmentId: true, studentId: true },
    }),
  ])

  const offeringOfAssessment = new Map<string, string>()
  for (const offering of offerings) {
    for (const assessment of offering.assessments) {
      offeringOfAssessment.set(assessment.id, offering.id)
    }
  }

  const marksByKey = new Map<string, Array<{ points: unknown; maxPoints: unknown }>>()
  for (const grade of grades) {
    const offeringId = offeringOfAssessment.get(grade.assessmentId)
    if (!offeringId) continue
    const key = `${offeringId}:${grade.studentId}`
    const list = marksByKey.get(key)
    if (list) list.push({ points: grade.points, maxPoints: grade.maxPoints })
    else marksByKey.set(key, [{ points: grade.points, maxPoints: grade.maxPoints }])
  }

  const submittedByKey = new Map<string, number>()
  for (const submission of submissions) {
    const offeringId = offeringOfAssessment.get(submission.assessmentId)
    if (!offeringId) continue
    const key = `${offeringId}:${submission.studentId}`
    submittedByKey.set(key, (submittedByKey.get(key) ?? 0) + 1)
  }

  return offerings.flatMap((offering) =>
    offering.enrollments.map((enrollment) => {
      const key = `${offering.id}:${enrollment.student.id}`
      return toTeacherRosterRow({
        offeringId: offering.id,
        offeringLabel: offeringLabel(offering),
        studentId: enrollment.student.id,
        studentName: enrollment.student.fullName,
        registerNumber: enrollment.student.registerNumber,
        email: enrollment.student.user.email,
        groupName:
          enrollment.student.groupMemberships.find((m) => m.group.offeringId === offering.id)?.group
            .name ?? null,
        marks: marksByKey.get(key) ?? [],
        submittedCount: submittedByKey.get(key) ?? 0,
        assessmentCount: offering.assessments.length,
      })
    }),
  )
}

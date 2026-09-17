import "server-only"

import { writeAuditLog } from "@/lib/grading/audit"
import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"
import { resolveTeacherStaffId } from "@/lib/teacher-staff"

/**
 * The status a teacher removal writes.
 *
 * A plain string column (there is no enum), and deliberately **not** a delete: the
 * `@@unique([studentId, offeringId])` row is what lets the student re-enrol and lets a
 * teacher re-add them, and keeping it preserves who was in the class and when. Every other
 * read already filters `status: "active"`, so a dropped enrolment is invisible to the roster,
 * the gradebook and the capacity count.
 */
export const DROPPED_ENROLLMENT_STATUS = "dropped"

/** A write-path failure carrying the HTTP status the route should return. */
export class RosterError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    message: string,
  ) {
    super(message)
    this.name = "RosterError"
  }
}

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
  academicYear: number
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
                select: { leftAt: true, group: { select: { name: true, offeringId: true } } },
              },
            },
          },
        },
      },
    },
    orderBy: [{ academicYear: "desc" }, { term: "asc" }],
  })

  const assessmentIds = offerings.flatMap((offering) => offering.assessments.map((a) => a.id))

  // Skip the bulk reads when the teacher has no assessments at all, rather than
  // duplicating the row-building below. Empty maps produce the same result.
  const [grades, submissions] =
    assessmentIds.length === 0
      ? [[], []]
      : await Promise.all([
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
        // `leftAt === null` is required: a soft-removed membership keeps its row
        // (`lib/groups/service.ts` sets `leftAt` rather than deleting), and every
        // other read in the repo filters it. Without it a student the teacher
        // removed still shows as placed, and is missing from "Not placed".
        // `find` is safe because `@@unique([groupId, studentId])` plus the
        // active-membership rule leaves at most one per offering.
        groupName:
          enrollment.student.groupMemberships.find(
            (m) => m.leftAt === null && m.group.offeringId === offering.id,
          )?.group.name ?? null,
        marks: marksByKey.get(key) ?? [],
        submittedCount: submittedByKey.get(key) ?? 0,
        assessmentCount: offering.assessments.length,
      })
    }),
  )
}

// ---------------------------------------------------------------------------
// Enrolment write path (TN-9)
//
// The roster used to be read-only, and the only enrolment route in the repo was the
// student-facing `POST /api/student/courses/enroll`. A teacher could therefore not fix a
// misplaced or dropped enrolment at all. These three operations are the teacher's half:
// add a student to an offering, remove them from one, or move them between two.
//
// The candidate pool is deliberately **only students who already have an enrolment row in
// one of this teacher's offerings** (any status). There is no teacher-facing student
// directory in this app, and reading the whole `StudentProfile` table would let a teacher
// enumerate students they do not teach. A student who has never enrolled anywhere is a
// registration/admin concern, not a roster edit.
// ---------------------------------------------------------------------------

export type RosterOfferingOption = {
  id: string
  label: string
}

export type RosterStudentOption = {
  id: string
  name: string
  registerNumber: string | null
  email: string
  /** This teacher's offerings in which the student is currently active. */
  activeOfferingIds: string[]
  /** Every one of this teacher's offerings the student has an enrolment row in. */
  knownOfferingIds: string[]
}

export type TeacherRosterContext = {
  students: RosterStudentOption[]
  offerings: RosterOfferingOption[]
}

/**
 * The pickers the roster's write path needs: the teacher's offerings, and the students who
 * exist in any of them. Includes dropped and waitlisted rows so a removed student can be
 * added back — reading only `active` rows would make the add action unable to undo a removal.
 */
export async function getRosterContextForTeacher(user: AuthUser): Promise<TeacherRosterContext> {
  const staffId = await resolveTeacherStaffId(user.id)
  if (!staffId) return { students: [], offerings: [] }

  const offerings = await prisma.courseOffering.findMany({
    where: { teacherId: staffId },
    select: {
      id: true,
      term: true,
      academicYear: true,
      course: { select: { code: true, name: true } },
      classRoom: { select: { name: true, section: true } },
      enrollments: {
        select: {
          status: true,
          student: {
            select: {
              id: true,
              fullName: true,
              registerNumber: true,
              user: { select: { email: true } },
            },
          },
        },
      },
    },
    orderBy: [{ academicYear: "desc" }, { term: "asc" }],
  })

  const studentsById = new Map<string, RosterStudentOption>()
  for (const offering of offerings) {
    for (const enrollment of offering.enrollments) {
      const student = enrollment.student
      let option = studentsById.get(student.id)
      if (!option) {
        option = {
          id: student.id,
          name: student.fullName,
          registerNumber: student.registerNumber,
          email: student.user.email,
          activeOfferingIds: [],
          knownOfferingIds: [],
        }
        studentsById.set(student.id, option)
      }
      option.knownOfferingIds.push(offering.id)
      if (enrollment.status === "active") option.activeOfferingIds.push(offering.id)
    }
  }

  return {
    offerings: offerings.map((offering) => ({
      id: offering.id,
      label: offeringLabel(offering),
    })),
    students: [...studentsById.values()].sort((a, b) => a.name.localeCompare(b.name)),
  }
}

export type EnrollmentMutation = {
  studentId: string
  studentName: string
  offeringId: string
  offeringLabel: string
  status: "active" | typeof DROPPED_ENROLLMENT_STATUS
  /** False when the request asked for a state the row was already in (idempotent repeat). */
  changed: boolean
}

type OwnedOffering = {
  id: string
  studentLimit: number
  term: string
  academicYear: number
  course: { code: string; name: string }
  classRoom: { name: string; section: string | null }
}

/** Resolve the caller's staff id and confirm they teach the offering, or throw. */
async function loadOwnedOfferingForRoster(
  user: AuthUser,
  offeringId: string,
): Promise<{ staffId: string; offering: OwnedOffering }> {
  if (user.role !== "teacher") throw new RosterError(403, "Forbidden")
  const staffId = await resolveTeacherStaffId(user.id)
  if (!staffId) throw new RosterError(403, "Teacher profile not found.")
  const offering = await prisma.courseOffering.findFirst({
    where: { id: offeringId, teacherId: staffId },
    select: {
      id: true,
      studentLimit: true,
      term: true,
      academicYear: true,
      course: { select: { code: true, name: true } },
      classRoom: { select: { name: true, section: true } },
    },
  })
  if (!offering) throw new RosterError(404, "Offering not found or not taught by you.")
  return { staffId, offering }
}

async function loadStudentForRoster(studentId: string): Promise<{ id: string; fullName: string }> {
  const student = await prisma.studentProfile.findUnique({
    where: { id: studentId },
    select: { id: true, fullName: true },
  })
  if (!student) throw new RosterError(404, "Student not found.")
  return student
}

/**
 * Add (or re-activate) a student in one owned offering.
 *
 * The capacity decision is check-then-act, so it holds a row lock on the offering — the same
 * serialization the student-facing route uses, so a teacher adding a student and a student
 * self-enrolling cannot both take the last seat.
 */
export async function addStudentToOffering(
  user: AuthUser,
  input: { offeringId: string; studentId: string },
): Promise<EnrollmentMutation> {
  const { offering } = await loadOwnedOfferingForRoster(user, input.offeringId)
  const student = await loadStudentForRoster(input.studentId)

  const changed = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "CourseOffering" WHERE "id" = ${offering.id} FOR UPDATE`
    const existing = await tx.enrollment.findUnique({
      where: { studentId_offeringId: { studentId: student.id, offeringId: offering.id } },
      select: { status: true },
    })
    if (existing?.status === "active") return false

    const activeCount = await tx.enrollment.count({
      where: { offeringId: offering.id, status: "active" },
    })
    if (activeCount >= offering.studentLimit) {
      throw new RosterError(
        409,
        "This offering is full. Raise its student limit on the Offerings page first.",
      )
    }

    await tx.enrollment.upsert({
      where: { studentId_offeringId: { studentId: student.id, offeringId: offering.id } },
      create: { studentId: student.id, offeringId: offering.id, status: "active" },
      update: { status: "active" },
    })
    await writeAuditLog(tx, {
      entityType: "Enrollment",
      entityId: `${offering.id}:${student.id}`,
      action: "enrollment.added",
      actor: { id: user.id, role: user.role },
      ...(existing ? { before: { status: existing.status } } : {}),
      after: { status: "active" },
    })
    return true
  })

  return {
    studentId: student.id,
    studentName: student.fullName,
    offeringId: offering.id,
    offeringLabel: offeringLabel(offering),
    status: "active",
    changed,
  }
}

/**
 * Remove a student from one owned offering.
 *
 * Writes `status: "dropped"` rather than deleting: the row (and its `enrolledAt`) is the
 * record of the enrolment, every reader already filters `active`, and the student can
 * re-enrol or be re-added afterwards. An already-dropped row is a no-op, not an error.
 */
export async function removeStudentFromOffering(
  user: AuthUser,
  input: { offeringId: string; studentId: string },
): Promise<EnrollmentMutation> {
  const { offering } = await loadOwnedOfferingForRoster(user, input.offeringId)
  const student = await loadStudentForRoster(input.studentId)

  const changed = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "CourseOffering" WHERE "id" = ${offering.id} FOR UPDATE`
    const existing = await tx.enrollment.findUnique({
      where: { studentId_offeringId: { studentId: student.id, offeringId: offering.id } },
      select: { status: true },
    })
    if (!existing) {
      throw new RosterError(404, "This student has no enrolment in that offering.")
    }
    if (existing.status !== "active") return false

    await tx.enrollment.update({
      where: { studentId_offeringId: { studentId: student.id, offeringId: offering.id } },
      data: { status: DROPPED_ENROLLMENT_STATUS },
    })
    await writeAuditLog(tx, {
      entityType: "Enrollment",
      entityId: `${offering.id}:${student.id}`,
      action: "enrollment.removed",
      actor: { id: user.id, role: user.role },
      before: { status: existing.status },
      after: { status: DROPPED_ENROLLMENT_STATUS },
    })
    return true
  })

  return {
    studentId: student.id,
    studentName: student.fullName,
    offeringId: offering.id,
    offeringLabel: offeringLabel(offering),
    status: DROPPED_ENROLLMENT_STATUS,
    changed,
  }
}

/**
 * Move a student from one owned offering to another.
 *
 * One transaction: drop the source and activate the target, or neither. Both offerings must be
 * the caller's, the target must have a seat, and the two offerings are row-locked in id order
 * so two opposite moves cannot deadlock.
 */
export async function moveStudentBetweenOfferings(
  user: AuthUser,
  input: { studentId: string; fromOfferingId: string; toOfferingId: string },
): Promise<EnrollmentMutation> {
  if (input.fromOfferingId === input.toOfferingId) {
    throw new RosterError(400, "The source and target offering are the same.")
  }
  const { offering: from } = await loadOwnedOfferingForRoster(user, input.fromOfferingId)
  const { offering: to } = await loadOwnedOfferingForRoster(user, input.toOfferingId)
  const student = await loadStudentForRoster(input.studentId)

  const [lockedFirst, lockedSecond] = [from, to].sort((a, b) => a.id.localeCompare(b.id))

  const changed = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "CourseOffering" WHERE "id" = ${lockedFirst.id} FOR UPDATE`
    await tx.$queryRaw`SELECT "id" FROM "CourseOffering" WHERE "id" = ${lockedSecond.id} FOR UPDATE`

    const source = await tx.enrollment.findUnique({
      where: { studentId_offeringId: { studentId: student.id, offeringId: from.id } },
      select: { status: true },
    })
    if (!source || source.status !== "active") {
      throw new RosterError(404, "That student is not actively enrolled in the source offering.")
    }

    const target = await tx.enrollment.findUnique({
      where: { studentId_offeringId: { studentId: student.id, offeringId: to.id } },
      select: { status: true },
    })
    if (target?.status !== "active") {
      const activeCount = await tx.enrollment.count({
        where: { offeringId: to.id, status: "active" },
      })
      if (activeCount >= to.studentLimit) {
        throw new RosterError(
          409,
          "The target offering is full. Raise its student limit on the Offerings page first.",
        )
      }
    }

    await tx.enrollment.update({
      where: { studentId_offeringId: { studentId: student.id, offeringId: from.id } },
      data: { status: DROPPED_ENROLLMENT_STATUS },
    })
    await tx.enrollment.upsert({
      where: { studentId_offeringId: { studentId: student.id, offeringId: to.id } },
      create: { studentId: student.id, offeringId: to.id, status: "active" },
      update: { status: "active" },
    })
    await writeAuditLog(tx, {
      entityType: "Enrollment",
      entityId: `${to.id}:${student.id}`,
      action: "enrollment.moved",
      actor: { id: user.id, role: user.role },
      before: { offeringId: from.id, status: source.status },
      after: { offeringId: to.id, status: "active" },
    })
    return true
  })

  return {
    studentId: student.id,
    studentName: student.fullName,
    offeringId: to.id,
    offeringLabel: offeringLabel(to),
    status: "active",
    changed,
  }
}

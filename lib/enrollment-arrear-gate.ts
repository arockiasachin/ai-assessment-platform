import "server-only"

import type { ArrearReason } from "@/lib/arrears"
import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"
import { listStudentCourseOutcomes, type StudentCourseOutcome } from "@/lib/student-course-outcome"

/**
 * The enrolment gate: an outstanding arrear refuses a **new** course registration.
 *
 * ## Why this exists, and why it is not a second outcome rule
 *
 * Nothing used to look at a student's prior results when they registered again, so a student
 * with a failed FAT could simply register for a new course and the arrear was never mentioned.
 * The outcome reader (`lib/student-course-outcome.ts`) and the arrear rule (`lib/arrears.ts`)
 * already answer *whether* an arrear stands; this module is only the policy of what the
 * registration surface does with that answer, and it reads `outcome.arrear` rather than
 * re-deriving anything. One definition of an arrear, reused.
 *
 * ## The four ways this must never block
 *
 * - **`not-judged` is not an arrear.** It means the evidence is incomplete, not that the
 *   student failed, and `lib/arrears.ts` returns `null` for it. Nothing here needs a special
 *   case — that is the point of reading `arrear` instead of `outcome.status`.
 * - **An arrear's own course is never blocked.** A new term is a new `CourseOffering`, so a
 *   re-offering of the failed course has a different `offeringId`; `Enrollment` carries no
 *   `courseId`, so an id comparison would miss it. Re-registering is how a student *clears* the
 *   arrear, so the comparison is on `courseId` and it is load-bearing.
 * - **A course the student has already passed is never blocked.** An arrear is about what is
 *   outstanding, and a passed course is not. This is what stops a failed theory paper holding a
 *   lab the student already cleared — a passed course does not need repeating.
 * - **An acknowledged arrear no longer blocks.** The block is mandatory but must not strand
 *   anyone, so the student can acknowledge it once (see `ArrearAcknowledgement`) and continue.
 *
 * ## Where the arrear is read from, and the one caveat
 *
 * The arrear is *derived* from published grades, so a missing FAT mark that is not an absence
 * can produce a block that the student believes is wrong. The design answers that twice: the
 * refusal names the reason (`arrearRefusalMessage`), and the acknowledgement is a record rather
 * than a confirmation dialog, so a wrongly-gated student is delayed, not locked out.
 */

/** The arrear-bearing offering that would refuse registering for some other course. */
export type ArrearHold = {
  /** The offering the arrear is in — what an acknowledgement is keyed to. */
  offeringId: string
  /** The arrear's course. A registration for this same course is always exempt. */
  courseId: string
  courseCode: string
  courseName: string
  term: string
  academicYear: number
  reason: ArrearReason
}

function toHold(outcome: StudentCourseOutcome, reason: ArrearReason): ArrearHold {
  return {
    offeringId: outcome.offeringId,
    courseId: outcome.courseId,
    courseCode: outcome.courseCode,
    courseName: outcome.courseName,
    term: outcome.term,
    academicYear: outcome.academicYear,
    reason,
  }
}

/**
 * The outstanding, unacknowledged arrear that refuses a registration for `targetCourseId`.
 *
 * Pure: every fact is passed in, so the exemption and acknowledgement rules are testable without
 * a database. Returns the first such arrear in the caller's order; the outcome reader sorts its
 * list most-recent-first, so the named arrear is the latest one.
 */
export function selectBlockingArrear(
  outcomes: readonly StudentCourseOutcome[],
  targetCourseId: string,
  acknowledgedOfferingIds: ReadonlySet<string> = new Set(),
): ArrearHold | null {
  /*
   * A course the student has **already passed** is not outstanding work, so an arrear in some
   * other course must not hold it.
   *
   * Without this, an arrear is scoped to the *programme* rather than the thing that is actually
   * outstanding: a failed theory paper held the lab as well, so a student who had passed the lab
   * could not register for it again. A passed course never needs repeating, and it is the one
   * target the arrear cannot be said to be about.
   *
   * Reads the verdict rather than the raw mark, so a `not-judged` course (incomplete evidence) is
   * not mistaken for a pass and is still gated normally.
   */
  const alreadyPassed = outcomes.some(
    (outcome) => outcome.courseId === targetCourseId && outcome.outcome.status === "pass",
  )
  if (alreadyPassed) return null

  for (const outcome of outcomes) {
    if (outcome.arrear === null) continue
    // Re-registering for the arrear's own course is how it is cleared; never block it.
    if (outcome.courseId === targetCourseId) continue
    // An arrear the student has explicitly acknowledged no longer refuses registration.
    if (acknowledgedOfferingIds.has(outcome.offeringId)) continue
    return toHold(outcome, outcome.arrear)
  }
  return null
}

/**
 * The acknowledgements a student has already given, narrowed to their arrear-bearing offerings.
 *
 * One query, scoped to the offerings that actually carry an arrear, so the gate does not fan out
 * per course and does not load rows for arrears that have since been retired.
 */
async function acknowledgedOfferingIds(
  studentId: string,
  outcomes: readonly StudentCourseOutcome[],
): Promise<Set<string>> {
  const offeringIds = outcomes
    .filter((outcome) => outcome.arrear !== null)
    .map((outcome) => outcome.offeringId)
  if (offeringIds.length === 0) return new Set()

  const rows = await prisma.arrearAcknowledgement.findMany({
    where: { studentId, offeringId: { in: offeringIds } },
    select: { offeringId: true },
  })
  return new Set(rows.map((row) => row.offeringId))
}

/**
 * The arrear that would refuse this student's registration for `targetCourseId`, or `null`.
 *
 * The enrolment route calls this inside its lock-holding transaction, next to the window and
 * capacity checks. The reads use the shared client rather than the transaction: the arrear and
 * its acknowledgement are committed facts the transaction does not modify, and the enrollment
 * read that matters — the same-offering check — is already scoped to `tx`.
 */
export async function findEnrollmentBlockingArrear(input: {
  user: AuthUser
  studentId: string
  targetCourseId: string
}): Promise<ArrearHold | null> {
  const outcomes = await listStudentCourseOutcomes(input.user)
  const acknowledged = await acknowledgedOfferingIds(input.studentId, outcomes)
  return selectBlockingArrear(outcomes, input.targetCourseId, acknowledged)
}

/**
 * The hold per course, for the catalog's register control.
 *
 * A `Map` keyed by `courseId` rather than a call per row: the catalogue asks about every offering
 * at once, and the outcome reader is the expensive part. Courses with no hold are simply absent.
 */
export async function listBlockingArrears(input: {
  user: AuthUser
  studentId: string
  targetCourseIds: readonly string[]
}): Promise<Map<string, ArrearHold>> {
  const outcomes = await listStudentCourseOutcomes(input.user)
  const acknowledged = await acknowledgedOfferingIds(input.studentId, outcomes)

  const holds = new Map<string, ArrearHold>()
  for (const courseId of new Set(input.targetCourseIds)) {
    const hold = selectBlockingArrear(outcomes, courseId, acknowledged)
    if (hold) holds.set(courseId, hold)
  }
  return holds
}

export type AcknowledgeArrearResult =
  { kind: "acknowledged"; hold: ArrearHold } | { kind: "no-arrear" }

/**
 * Record that a student has seen an outstanding arrear, so it stops refusing registration.
 *
 * The requested offering must **already carry an arrear** for this student: the reason is derived
 * here, not accepted from the client, so a forged request cannot create an acknowledgement that
 * silences a real block or fabricate one for a healthy course. Re-acknowledging is idempotent —
 * the unique key is `(studentId, offeringId)` and the row is updated in place.
 */
export async function acknowledgeArrearForStudent(input: {
  user: AuthUser
  studentId: string
  offeringId: string
}): Promise<AcknowledgeArrearResult> {
  const outcomes = await listStudentCourseOutcomes(input.user)
  const outcome = outcomes.find(
    (candidate) => candidate.offeringId === input.offeringId && candidate.arrear !== null,
  )
  if (!outcome || outcome.arrear === null) return { kind: "no-arrear" }

  const hold = toHold(outcome, outcome.arrear)
  await prisma.arrearAcknowledgement.upsert({
    where: {
      studentId_offeringId: { studentId: input.studentId, offeringId: outcome.offeringId },
    },
    create: { studentId: input.studentId, offeringId: outcome.offeringId, reason: hold.reason },
    update: { reason: hold.reason },
  })
  return { kind: "acknowledged", hold }
}

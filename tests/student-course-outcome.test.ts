import { afterAll, describe, expect, it } from "vitest"

import type { AuthUser } from "@/lib/session"
import { listStudentCourseOutcomes } from "@/lib/student-course-outcome"
import { COURSES_ACCOUNTS, COURSES_IDS, seedCourses } from "@/prisma/seed-courses"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"

/**
 * The student outcome reader, against a real database.
 *
 * These cases exist because the reader's whole job is to *distinguish* facts that look
 * alike in a row count: a pass from a fail, an absence from a zero, a mid-term gap from
 * an arrear. So every assertion names the distinction, and the "absent" case asserts
 * `null` explicitly — an implementation that rendered a missing FAT as `0` would satisfy
 * a naive `fail` test while lying to the student.
 *
 * Scope is asserted from the enrolment side: an offering the caller is not in never
 * appears, so the read cannot be turned into a probe of another cohort.
 */

const NOW = new Date("2026-06-01T00:00:00.000Z")

const COURSE_ID = "outcome-course"
const CLASS_ID = "outcome-class"
const ENDED_OFFERING_ID = "outcome-offering-ended"
const ACTIVE_OFFERING_ID = "outcome-offering-active"
const SINGLE_OFFERING_ID = "outcome-offering-single"
const PEER_OFFERING_ID = "outcome-offering-peer"

const ENDED = {
  cat1: "outcome-ended-cat1",
  cat2: "outcome-ended-cat2",
  fat: "outcome-ended-fat",
} as const
const ACTIVE = {
  cat1: "outcome-active-cat1",
  cat2: "outcome-active-cat2",
  fat: "outcome-active-fat",
} as const
const SINGLE = { only: "outcome-single-only" } as const
const PEER = { fat: "outcome-peer-fat" } as const

function storedPolicy(fatAssessmentId: string) {
  return {
    catWeight: 40,
    fatWeight: 60,
    finalAssessmentId: fatAssessmentId,
    minimumCatPercent: 30,
  }
}

type Fixture = {
  studentUser: AuthUser
  studentProfileId: string
  peerUser: AuthUser
}

async function createFixture(): Promise<Fixture> {
  await truncateAll()

  const teacher = await prisma.user.create({
    data: {
      email: "outcome-teacher@spine.test",
      passwordHash: "test-only-not-a-real-hash",
      role: "TEACHER",
      staffProfile: { create: { fullName: "Outcome Teacher", empId: "EMP-OUTCOME-T" } },
    },
    include: { staffProfile: true },
  })

  const student = await prisma.user.create({
    data: {
      email: "outcome-student@spine.test",
      passwordHash: "test-only-not-a-real-hash",
      role: "STUDENT",
      studentProfile: {
        create: { fullName: "Outcome Student", registerNumber: "REG-OUTCOME-1" },
      },
    },
    include: { studentProfile: true },
  })

  const peer = await prisma.user.create({
    data: {
      email: "outcome-peer@spine.test",
      passwordHash: "test-only-not-a-real-hash",
      role: "STUDENT",
      studentProfile: {
        create: { fullName: "Outcome Peer", registerNumber: "REG-OUTCOME-2" },
      },
    },
    include: { studentProfile: true },
  })

  await prisma.course.create({
    data: { id: COURSE_ID, code: "OUTCOME-101", name: "Outcome Course", credits: 3 },
  })
  await prisma.classRoom.create({
    data: { id: CLASS_ID, code: "OUTCOME-CLASS", name: "Outcome Class", academicYear: 2026 },
  })

  await prisma.courseOffering.create({
    data: {
      id: ENDED_OFFERING_ID,
      courseId: COURSE_ID,
      classId: CLASS_ID,
      teacherId: teacher.staffProfile!.id,
      term: "Semester-1",
      academicYear: 2025,
      startsOn: new Date("2025-01-06T00:00:00.000Z"),
      endsOn: new Date("2025-06-06T00:00:00.000Z"),
      gradingConfig: storedPolicy(ENDED.fat),
    },
  })
  await prisma.courseOffering.create({
    data: {
      id: ACTIVE_OFFERING_ID,
      courseId: COURSE_ID,
      classId: CLASS_ID,
      teacherId: teacher.staffProfile!.id,
      term: "Semester-1",
      academicYear: 2026,
      startsOn: new Date("2026-01-06T00:00:00.000Z"),
      endsOn: new Date("2026-12-18T00:00:00.000Z"),
      gradingConfig: storedPolicy(ACTIVE.fat),
    },
  })
  await prisma.courseOffering.create({
    data: {
      id: SINGLE_OFFERING_ID,
      courseId: COURSE_ID,
      classId: CLASS_ID,
      teacherId: teacher.staffProfile!.id,
      term: "Semester-2",
      academicYear: 2025,
      startsOn: new Date("2025-01-06T00:00:00.000Z"),
      endsOn: new Date("2025-06-06T00:00:00.000Z"),
      gradingConfig: storedPolicy(SINGLE.only),
    },
  })
  await prisma.courseOffering.create({
    data: {
      id: PEER_OFFERING_ID,
      courseId: COURSE_ID,
      classId: CLASS_ID,
      teacherId: teacher.staffProfile!.id,
      term: "Semester-3",
      academicYear: 2025,
      endsOn: new Date("2025-06-06T00:00:00.000Z"),
      gradingConfig: storedPolicy(PEER.fat),
    },
  })

  const assessmentRows = [
    { id: ENDED.cat1, offeringId: ENDED_OFFERING_ID, maxMarks: 20, dueDate: "2025-02-14" },
    { id: ENDED.cat2, offeringId: ENDED_OFFERING_ID, maxMarks: 30, dueDate: "2025-03-14" },
    { id: ENDED.fat, offeringId: ENDED_OFFERING_ID, maxMarks: 100, dueDate: "2025-04-25" },
    { id: ACTIVE.cat1, offeringId: ACTIVE_OFFERING_ID, maxMarks: 20, dueDate: "2026-02-14" },
    { id: ACTIVE.cat2, offeringId: ACTIVE_OFFERING_ID, maxMarks: 30, dueDate: "2026-03-14" },
    { id: ACTIVE.fat, offeringId: ACTIVE_OFFERING_ID, maxMarks: 100, dueDate: "2026-05-20" },
    { id: SINGLE.only, offeringId: SINGLE_OFFERING_ID, maxMarks: 100, dueDate: "2025-04-25" },
    { id: PEER.fat, offeringId: PEER_OFFERING_ID, maxMarks: 100, dueDate: "2025-04-25" },
  ]
  await prisma.assessment.createMany({
    data: assessmentRows.map((row) => ({
      id: row.id,
      offeringId: row.offeringId,
      courseId: COURSE_ID,
      classId: CLASS_ID,
      title: row.id,
      type: "QUIZ" as const,
      dueDate: new Date(`${row.dueDate}T08:00:00.000Z`),
      maxMarks: row.maxMarks,
      releasedAt: new Date(`${row.dueDate}T08:00:00.000Z`),
      createdById: teacher.staffProfile!.id,
    })),
  })

  await prisma.enrollment.createMany({
    data: [
      { studentId: student.studentProfile!.id, offeringId: ENDED_OFFERING_ID, status: "active" },
      { studentId: student.studentProfile!.id, offeringId: ACTIVE_OFFERING_ID, status: "active" },
      { studentId: student.studentProfile!.id, offeringId: SINGLE_OFFERING_ID, status: "active" },
      { studentId: peer.studentProfile!.id, offeringId: PEER_OFFERING_ID, status: "active" },
    ],
  })

  return {
    studentUser: { id: student.id, email: student.email, role: "student" },
    studentProfileId: student.studentProfile!.id,
    peerUser: { id: peer.id, email: peer.email, role: "student" },
  }
}

type MarkSeed = {
  assessmentId: string
  points: number
  maxPoints: number
  publishedAt?: Date | null
}

/** Replace the caller's marks wholesale, so each case starts from a known state. */
async function setMarks(studentProfileId: string, marks: MarkSeed[]): Promise<void> {
  await prisma.grade.deleteMany({ where: { studentId: studentProfileId } })
  await prisma.grade.createMany({
    data: marks.map((mark) => ({
      assessmentId: mark.assessmentId,
      studentId: studentProfileId,
      points: mark.points,
      maxPoints: mark.maxPoints,
      percentage: (mark.points / mark.maxPoints) * 100,
      source: "TEACHER_OVERRIDE" as const,
      publishedAt: mark.publishedAt === undefined ? NOW : mark.publishedAt,
    })),
  })
}

/** The ended-offering marks that clear the CAT gate at 80% and pass overall at 74. */
const PASSING_MARKS: MarkSeed[] = [
  { assessmentId: ENDED.cat1, points: 16, maxPoints: 20 },
  { assessmentId: ENDED.cat2, points: 24, maxPoints: 30 },
  { assessmentId: ENDED.fat, points: 70, maxPoints: 100 },
]

describe("listStudentCourseOutcomes (fixture)", () => {
  it("returns nothing for a user with no student profile", async () => {
    const f = await createFixture()
    const teacher = await prisma.user.findUniqueOrThrow({
      where: { email: "outcome-teacher@spine.test" },
    })
    expect(
      await listStudentCourseOutcomes(
        { id: teacher.id, email: teacher.email, role: "teacher" },
        { now: NOW },
      ),
    ).toEqual([])
    expect(f.studentProfileId).toBeTruthy()
  })

  it("judges a completed course as a pass with the weighted grand total", async () => {
    const f = await createFixture()
    await setMarks(f.studentProfileId, PASSING_MARKS)

    const outcomes = await listStudentCourseOutcomes(f.studentUser, { now: NOW })
    const ended = outcomes.find((outcome) => outcome.offeringId === ENDED_OFFERING_ID)!

    expect(ended.ended).toBe(true)
    expect(ended.finalAssessment).toMatchObject({
      assessmentId: ENDED.fat,
      published: true,
      percentage: 70,
    })
    expect(ended.cat).toMatchObject({ percent: 80, status: "eligible" })
    expect(ended.grandTotal).toBe(74)
    expect(ended.outcome).toEqual({ status: "pass", grandTotal: 74 })
    expect(ended.arrear).toBeNull()
  })

  it("reports a failed FAT as a 'failed' arrear using the course verdict, not a second threshold", async () => {
    const f = await createFixture()
    await setMarks(f.studentProfileId, [
      { assessmentId: ENDED.cat1, points: 12, maxPoints: 20 },
      { assessmentId: ENDED.cat2, points: 18, maxPoints: 30 },
      { assessmentId: ENDED.fat, points: 20, maxPoints: 100 },
    ])

    const outcomes = await listStudentCourseOutcomes(f.studentUser, { now: NOW })
    const ended = outcomes.find((outcome) => outcome.offeringId === ENDED_OFFERING_ID)!

    expect(ended.grandTotal).toBe(36)
    expect(ended.outcome).toMatchObject({ status: "fail", reason: "below-pass-mark" })
    expect(ended.arrear).toBe("failed")
  })

  it("reports an ended course with no FAT mark as an absence, and never as zero", async () => {
    const f = await createFixture()
    await setMarks(f.studentProfileId, [
      { assessmentId: ENDED.cat1, points: 14, maxPoints: 20 },
      { assessmentId: ENDED.cat2, points: 21, maxPoints: 30 },
    ])

    const outcomes = await listStudentCourseOutcomes(f.studentUser, { now: NOW })
    const ended = outcomes.find((outcome) => outcome.offeringId === ENDED_OFFERING_ID)!

    expect(ended.finalAssessment).toMatchObject({ assessmentId: ENDED.fat, published: false })
    expect(ended.finalAssessment!.percentage).toBeNull()
    // The distinction the reader exists for: incomplete, not zero.
    expect(ended.grandTotal).toBeNull()
    expect(ended.grandTotal).not.toBe(0)
    expect(ended.outcome).toMatchObject({ status: "not-judged", reason: "no-grand-total" })
    expect(ended.arrear).toBe("did-not-appear")
  })

  it("does not treat an unpublished FAT grade as a published mark", async () => {
    const f = await createFixture()
    await setMarks(f.studentProfileId, [
      { assessmentId: ENDED.cat1, points: 16, maxPoints: 20 },
      { assessmentId: ENDED.cat2, points: 24, maxPoints: 30 },
      { assessmentId: ENDED.fat, points: 70, maxPoints: 100, publishedAt: null },
    ])

    const outcomes = await listStudentCourseOutcomes(f.studentUser, { now: NOW })
    const ended = outcomes.find((outcome) => outcome.offeringId === ENDED_OFFERING_ID)!

    expect(ended.finalAssessment!.published).toBe(false)
    expect(ended.grandTotal).toBeNull()
    expect(ended.arrear).toBe("did-not-appear")
  })

  it("does not mark a course that has not ended in arrears", async () => {
    const f = await createFixture()
    await setMarks(f.studentProfileId, [
      { assessmentId: ACTIVE.cat1, points: 14, maxPoints: 20 },
      { assessmentId: ACTIVE.cat2, points: 21, maxPoints: 30 },
    ])

    const outcomes = await listStudentCourseOutcomes(f.studentUser, { now: NOW })
    const active = outcomes.find((outcome) => outcome.offeringId === ACTIVE_OFFERING_ID)!

    expect(active.ended).toBe(false)
    expect(active.grandTotal).toBeNull()
    expect(active.outcome).toMatchObject({ status: "not-judged" })
    expect(active.arrear).toBeNull()
  })

  it("flattens the CAT gate when it is not cleared", async () => {
    const f = await createFixture()
    await setMarks(f.studentProfileId, [
      { assessmentId: ENDED.cat1, points: 2, maxPoints: 20 },
      { assessmentId: ENDED.cat2, points: 3, maxPoints: 30 },
      { assessmentId: ENDED.fat, points: 80, maxPoints: 100 },
    ])

    const outcomes = await listStudentCourseOutcomes(f.studentUser, { now: NOW })
    const ended = outcomes.find((outcome) => outcome.offeringId === ENDED_OFFERING_ID)!

    expect(ended.cat).toMatchObject({ percent: 10, status: "below-cat-minimum" })
    expect(ended.outcome).toMatchObject({ status: "fail", reason: "fat-ineligible" })
    expect(ended.arrear).toBe("failed")
  })

  it("has no final assessment when the policy resolves to no CAT/FAT split", async () => {
    const f = await createFixture()
    await setMarks(f.studentProfileId, [{ assessmentId: SINGLE.only, points: 60, maxPoints: 100 }])

    const outcomes = await listStudentCourseOutcomes(f.studentUser, { now: NOW })
    const single = outcomes.find((outcome) => outcome.offeringId === SINGLE_OFFERING_ID)!

    expect(single.finalAssessment).toBeNull()
    expect(single.cat.status).toBe("no-cat-gate")
    // No FAT exists to miss, even though the offering has ended.
    expect(single.arrear).toBeNull()
    expect(single.outcome).toEqual({ status: "pass", grandTotal: 60 })
  })

  it("never includes another student's offering, marks or verdicts", async () => {
    const f = await createFixture()
    await setMarks(f.studentProfileId, PASSING_MARKS)

    const peerProfile = await prisma.studentProfile.findFirstOrThrow({
      where: { user: { email: "outcome-peer@spine.test" } },
    })
    await setMarks(peerProfile.id, [{ assessmentId: PEER.fat, points: 95, maxPoints: 100 }])

    const outcomes = await listStudentCourseOutcomes(f.studentUser, { now: NOW })
    const offeringIds = outcomes.map((outcome) => outcome.offeringId)

    expect(offeringIds).toContain(ENDED_OFFERING_ID)
    expect(offeringIds).not.toContain(PEER_OFFERING_ID)
    expect(JSON.stringify(outcomes)).not.toContain(PEER.fat)
  })
})

/**
 * The same reader against the **committed course seed**, which is the data later waves
 * will look at. The fixture above proves the rule; this proves the seed actually produces
 * the three states the Grades and Arrears pages need.
 */
describe("listStudentCourseOutcomes against the course seed", () => {
  const studentUser = (index: number): AuthUser => ({
    id: COURSES_IDS.studentUserIds[index],
    email: COURSES_ACCOUNTS.students[index].email,
    role: "student",
  })

  it("finds a pass, a failure and an absence in the completed offering", async () => {
    await truncateAll()
    await seedCourses()

    const pastOfferingId = COURSES_IDS.offeringIds.pastDsaTheoryA

    const passing = (await listStudentCourseOutcomes(studentUser(0), { now: NOW })).find(
      (outcome) => outcome.offeringId === pastOfferingId,
    )!
    expect(passing.outcome.status).toBe("pass")
    expect(passing.grandTotal).toBeGreaterThanOrEqual(50)
    expect(passing.finalAssessment!.published).toBe(true)
    expect(passing.arrear).toBeNull()

    const failing = (await listStudentCourseOutcomes(studentUser(1), { now: NOW })).find(
      (outcome) => outcome.offeringId === pastOfferingId,
    )!
    expect(failing.outcome.status).toBe("fail")
    expect(failing.grandTotal).toBeLessThan(50)
    expect(failing.finalAssessment!.published).toBe(true)
    expect(failing.arrear).toBe("failed")

    const absent = (await listStudentCourseOutcomes(studentUser(2), { now: NOW })).find(
      (outcome) => outcome.offeringId === pastOfferingId,
    )!
    expect(absent.ended).toBe(true)
    expect(absent.finalAssessment!.published).toBe(false)
    expect(absent.grandTotal).toBeNull()
    expect(absent.arrear).toBe("did-not-appear")
  })
})

afterAll(async () => {
  await disconnectTestDatabase()
})

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The enrolment arrear gate, end to end.
 *
 * Two layers, because the rule is pure but its consequences are not:
 *
 * - `selectBlockingArrear` is exercised with hand-built outcomes, so the four non-blocking
 *   cases — the arrear's own course, an acknowledged arrear, and an outcome whose `arrear` is
 *   `null` (a `not-judged` course) — are pinned without a database.
 * - The real route handlers are driven with a real student session against a real database, so
 *   the gate's *placement* is proved too: that it refuses before capacity (a waitlist is not a
 *   way around it), that the arrear's own re-offering still enrols, and that acknowledging is
 *   what re-opens the rest.
 */
const mocks = vi.hoisted(() => ({ getCookies: vi.fn() }))

vi.mock("next/headers", () => ({
  cookies: () => mocks.getCookies(),
}))

import { POST as acknowledgePost } from "@/app/api/student/courses/enroll/acknowledge/route"
import { POST as enrollPost } from "@/app/api/student/courses/enroll/route"
import { selectBlockingArrear } from "@/lib/enrollment-arrear-gate"
import { signSessionValue } from "@/lib/session"
import { listStudentCourses } from "@/lib/student-courses"
import { arrearReasonLabel, arrearRefusalMessage } from "@/lib/student-courses-view"
import type { StudentCourseOutcome } from "@/lib/student-course-outcome"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"

// ---------------------------------------------------------------------------
// Pure: the selection rule
// ---------------------------------------------------------------------------

function outcome(
  overrides: Partial<StudentCourseOutcome> & Pick<StudentCourseOutcome, "offeringId" | "courseId">,
): StudentCourseOutcome {
  return {
    courseCode: "CODE-100",
    courseName: "Course",
    term: "Semester-1",
    academicYear: 2026,
    startsOn: null,
    endsOn: null,
    ended: true,
    finalAssessment: null,
    cat: {
      markedCount: 0,
      totalCount: 0,
      completionRatio: 0,
      percent: null,
      status: "no-cat-gate",
    },
    grandTotal: null,
    completedWeight: 0,
    totalWeight: 0,
    incomplete: true,
    outcome: { status: "not-judged", reason: "no-grand-total" },
    arrear: null,
    ...overrides,
  }
}

describe("selectBlockingArrear", () => {
  const failed = outcome({
    offeringId: "offering-failed",
    courseId: "course-arrear",
    courseCode: "MCSE501L",
    courseName: "Data Structures and Algorithms",
    arrear: "failed",
    outcome: { status: "fail", grandTotal: 36, reason: "below-pass-mark" },
  })

  it("returns null when no outcome carries an arrear", () => {
    expect(selectBlockingArrear([outcome({ offeringId: "o", courseId: "c" })], "other")).toBeNull()
  })

  it("blocks a different course with the failed arrear and its identity", () => {
    expect(selectBlockingArrear([failed], "course-new")).toEqual({
      offeringId: "offering-failed",
      courseId: "course-arrear",
      courseCode: "MCSE501L",
      courseName: "Data Structures and Algorithms",
      term: "Semester-1",
      academicYear: 2026,
      reason: "failed",
    })
  })

  it("blocks for a did-not-appear arrear as well", () => {
    const absent = outcome({
      offeringId: "offering-absent",
      courseId: "course-absent",
      arrear: "did-not-appear",
    })
    expect(selectBlockingArrear([absent], "course-new")?.reason).toBe("did-not-appear")
  })

  it("never blocks the arrear's own course, so a re-offering can be registered for", () => {
    // A new term is a new offering id, so this is a courseId comparison, not an id match.
    expect(selectBlockingArrear([failed], "course-arrear")).toBeNull()
  })

  it("does not block an arrear the student has acknowledged", () => {
    expect(selectBlockingArrear([failed], "course-new", new Set(["offering-failed"]))).toBeNull()
  })

  it("does not block a not-judged outcome, whose arrear is null", () => {
    const notJudged = outcome({
      offeringId: "offering-open",
      courseId: "course-open",
      ended: false,
      outcome: { status: "not-judged", reason: "no-grand-total" },
    })
    expect(selectBlockingArrear([notJudged], "course-new")).toBeNull()
  })

  it("does not block a course the student has already passed", () => {
    // The arrear is scoped to what is outstanding, not to the whole programme: a failed theory
    // paper must not hold the lab the student already cleared. A passed course does not need
    // repeating.
    const passedLab = outcome({
      offeringId: "offering-lab-past",
      courseId: "course-lab",
      courseCode: "MCSE501P",
      courseName: "Data Structures and Algorithms LAB",
      outcome: { status: "pass", grandTotal: 68 },
    })
    expect(selectBlockingArrear([failed, passedLab], "course-lab")).toBeNull()
  })

  it("reads the verdict, so an unjudged target course is still gated", () => {
    // The pass exemption must not swallow incomplete evidence: `not-judged` is not a pass, so a
    // course whose outcome cannot be stated is held like any other new course.
    const unjudgedLab = outcome({
      offeringId: "offering-lab-open",
      courseId: "course-lab",
      outcome: { status: "not-judged", reason: "no-grand-total" },
    })
    expect(selectBlockingArrear([failed, unjudgedLab], "course-lab")?.reason).toBe("failed")
  })
})

describe("arrear copy", () => {
  it("names the reason in the student's terms", () => {
    expect(arrearReasonLabel("failed")).toBe("you did not pass the final assessment")
    expect(arrearReasonLabel("did-not-appear")).toBe(
      "no final assessment mark was recorded for you",
    )
  })

  it("names the course, the reason, and both ways out", () => {
    const message = arrearRefusalMessage({
      courseName: "Data Structures and Algorithms",
      courseCode: "MCSE501L",
      term: "Semester-2",
      academicYear: 2025,
      reason: "failed",
    })
    expect(message).toBe(
      "You have an outstanding arrear in Data Structures and Algorithms (MCSE501L, " +
        "Semester-2 2025): you did not pass the final assessment. Acknowledge it to register " +
        "for other courses, or re-register for MCSE501L to clear it.",
    )
  })
})

// ---------------------------------------------------------------------------
// Database-backed: the route
// ---------------------------------------------------------------------------

const COURSE_A = "gate-course-a"
const COURSE_B = "gate-course-b"
const COURSE_D = "gate-course-d"
const OFFERING_A_ENDED = "gate-offering-a-ended"
const OFFERING_A_REOPEN = "gate-offering-a-reopen"
const OFFERING_B_OPEN = "gate-offering-b-open"
const OFFERING_D_ACTIVE = "gate-offering-d-active"
const FAT_A = "gate-a-fat"
const FAT_D = "gate-d-fat"

function policy(fatAssessmentId: string) {
  return { catWeight: 40, fatWeight: 60, finalAssessmentId: fatAssessmentId, minimumCatPercent: 30 }
}

type GateStudent = { userId: string; email: string; profileId: string }

type GateFixture = {
  failing: GateStudent
  absent: GateStudent
  passing: GateStudent
  midterm: GateStudent
}

async function createStudent(key: string, registerNumber: string): Promise<GateStudent> {
  const email = `gate-${key}@spine.test`
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: "test-only-not-a-real-hash",
      role: "STUDENT",
      studentProfile: {
        create: { fullName: `Gate ${key}`, registerNumber },
      },
    },
    include: { studentProfile: true },
  })
  return { userId: user.id, email, profileId: user.studentProfile!.id }
}

async function createFixture(): Promise<GateFixture> {
  await truncateAll()

  const teacher = await prisma.user.create({
    data: {
      email: "gate-teacher@spine.test",
      passwordHash: "test-only-not-a-real-hash",
      role: "TEACHER",
      staffProfile: { create: { fullName: "Gate Teacher", empId: "EMP-GATE-T" } },
    },
    include: { staffProfile: true },
  })
  const staffId = teacher.staffProfile!.id

  await prisma.course.createMany({
    data: [
      { id: COURSE_A, code: "GATE-A", name: "Arrear Course" },
      { id: COURSE_B, code: "GATE-B", name: "New Course" },
      { id: COURSE_D, code: "GATE-D", name: "Mid-Term Course" },
    ],
  })
  await prisma.classRoom.createMany({
    data: [
      { id: "gate-class-a", code: "GATE-A-2025", name: "Gate A 2025", academicYear: 2025 },
      { id: "gate-class-a2", code: "GATE-A-2026", name: "Gate A 2026", academicYear: 2026 },
      { id: "gate-class-b", code: "GATE-B-2026", name: "Gate B 2026", academicYear: 2026 },
      { id: "gate-class-d", code: "GATE-D-2026", name: "Gate D 2026", academicYear: 2026 },
    ],
  })

  await prisma.courseOffering.createMany({
    data: [
      {
        id: OFFERING_A_ENDED,
        courseId: COURSE_A,
        classId: "gate-class-a",
        teacherId: staffId,
        term: "Semester-2",
        academicYear: 2025,
        startsOn: new Date("2025-01-06T00:00:00.000Z"),
        endsOn: new Date("2025-06-06T00:00:00.000Z"),
        gradingConfig: policy(FAT_A),
      },
      {
        id: OFFERING_A_REOPEN,
        courseId: COURSE_A,
        classId: "gate-class-a2",
        teacherId: staffId,
        term: "Semester-1",
        academicYear: 2026,
        endsOn: new Date("2099-06-06T00:00:00.000Z"),
        gradingConfig: policy("gate-a2-fat"),
      },
      {
        id: OFFERING_B_OPEN,
        courseId: COURSE_B,
        classId: "gate-class-b",
        teacherId: staffId,
        term: "Semester-1",
        academicYear: 2026,
        endsOn: new Date("2099-06-06T00:00:00.000Z"),
      },
      {
        id: OFFERING_D_ACTIVE,
        courseId: COURSE_D,
        classId: "gate-class-d",
        teacherId: staffId,
        term: "Semester-1",
        academicYear: 2026,
        endsOn: new Date("2099-06-06T00:00:00.000Z"),
        gradingConfig: policy(FAT_D),
      },
    ],
  })

  const assessment = (
    id: string,
    offeringId: string,
    courseId: string,
    classId: string,
    title: string,
    maxMarks: number,
  ) => ({
    id,
    offeringId,
    courseId,
    classId,
    title,
    type: "QUIZ" as const,
    dueDate: new Date("2025-04-25T08:00:00.000Z"),
    maxMarks,
    releasedAt: new Date("2025-04-01T08:00:00.000Z"),
    createdById: staffId,
  })

  await prisma.assessment.createMany({
    data: [
      assessment("gate-a-cat1", OFFERING_A_ENDED, COURSE_A, "gate-class-a", "A CAT1", 20),
      assessment("gate-a-cat2", OFFERING_A_ENDED, COURSE_A, "gate-class-a", "A CAT2", 30),
      assessment(FAT_A, OFFERING_A_ENDED, COURSE_A, "gate-class-a", "A FAT", 100),
      assessment("gate-a2-fat", OFFERING_A_REOPEN, COURSE_A, "gate-class-a2", "A2 FAT", 100),
      assessment("gate-d-cat1", OFFERING_D_ACTIVE, COURSE_D, "gate-class-d", "D CAT1", 20),
      assessment("gate-d-cat2", OFFERING_D_ACTIVE, COURSE_D, "gate-class-d", "D CAT2", 30),
      assessment(FAT_D, OFFERING_D_ACTIVE, COURSE_D, "gate-class-d", "D FAT", 100),
    ],
  })

  const failing = await createStudent("failing", "REG-GATE-1")
  const absent = await createStudent("absent", "REG-GATE-2")
  const passing = await createStudent("passing", "REG-GATE-3")
  const midterm = await createStudent("midterm", "REG-GATE-4")

  await prisma.enrollment.createMany({
    data: [
      { studentId: failing.profileId, offeringId: OFFERING_A_ENDED, status: "active" },
      { studentId: absent.profileId, offeringId: OFFERING_A_ENDED, status: "active" },
      { studentId: passing.profileId, offeringId: OFFERING_A_ENDED, status: "active" },
      { studentId: midterm.profileId, offeringId: OFFERING_D_ACTIVE, status: "active" },
    ],
  })

  const NOW = new Date("2026-06-01T00:00:00.000Z")
  await prisma.grade.createMany({
    data: [
      // Failed FAT: 0.4·60 + 0.6·20 = 36, below the pass mark.
      {
        id: "gate-g-f1",
        studentId: failing.profileId,
        assessmentId: "gate-a-cat1",
        points: 12,
        maxPoints: 20,
        percentage: 60,
        source: "TEACHER_OVERRIDE",
        publishedAt: NOW,
      },
      {
        id: "gate-g-f2",
        studentId: failing.profileId,
        assessmentId: "gate-a-cat2",
        points: 18,
        maxPoints: 30,
        percentage: 60,
        source: "TEACHER_OVERRIDE",
        publishedAt: NOW,
      },
      {
        id: "gate-g-f3",
        studentId: failing.profileId,
        assessmentId: FAT_A,
        points: 20,
        maxPoints: 100,
        percentage: 20,
        source: "TEACHER_OVERRIDE",
        publishedAt: NOW,
      },
      // Absent: CATs marked, no FAT row at all.
      {
        id: "gate-g-a1",
        studentId: absent.profileId,
        assessmentId: "gate-a-cat1",
        points: 14,
        maxPoints: 20,
        percentage: 70,
        source: "TEACHER_OVERRIDE",
        publishedAt: NOW,
      },
      {
        id: "gate-g-a2",
        studentId: absent.profileId,
        assessmentId: "gate-a-cat2",
        points: 21,
        maxPoints: 30,
        percentage: 70,
        source: "TEACHER_OVERRIDE",
        publishedAt: NOW,
      },
      // Passing: 0.4·80 + 0.6·70 = 74.
      {
        id: "gate-g-p1",
        studentId: passing.profileId,
        assessmentId: "gate-a-cat1",
        points: 16,
        maxPoints: 20,
        percentage: 80,
        source: "TEACHER_OVERRIDE",
        publishedAt: NOW,
      },
      {
        id: "gate-g-p2",
        studentId: passing.profileId,
        assessmentId: "gate-a-cat2",
        points: 24,
        maxPoints: 30,
        percentage: 80,
        source: "TEACHER_OVERRIDE",
        publishedAt: NOW,
      },
      {
        id: "gate-g-p3",
        studentId: passing.profileId,
        assessmentId: FAT_A,
        points: 70,
        maxPoints: 100,
        percentage: 70,
        source: "TEACHER_OVERRIDE",
        publishedAt: NOW,
      },
    ],
  })

  return { failing, absent, passing, midterm }
}

function signIn(student: GateStudent): void {
  const value = signSessionValue({ id: student.userId, email: student.email, role: "student" })
  mocks.getCookies.mockImplementation(() =>
    Promise.resolve({ get: () => ({ name: "auth-user", value }) }),
  )
}

function post(path: string, offeringId: string): Promise<Response> {
  const request = new Request(`https://app.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ offeringId }),
  })
  return path.endsWith("/acknowledge") ? acknowledgePost(request) : enrollPost(request)
}

describe("enrolment arrear gate (route)", () => {
  beforeEach(async () => {
    await truncateAll()
    mocks.getCookies.mockReset()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("blocks a new course for a failed FAT arrear, naming the course and the reason", async () => {
    const f = await createFixture()
    signIn(f.failing)

    const response = await post("/api/student/courses/enroll", OFFERING_B_OPEN)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body).toMatchObject({
      success: false,
      kind: "arrear-blocked",
      arrear: { offeringId: OFFERING_A_ENDED, courseCode: "GATE-A", reason: "failed" },
    })
    expect(body.message).toContain("Arrear Course")
    expect(body.message).toContain("did not pass the final assessment")
    expect(body.message).toContain("re-register for GATE-A")

    // Refused before capacity: no enrollment row, not even a waitlist one.
    expect(
      await prisma.enrollment.count({
        where: { studentId: f.failing.profileId, offeringId: OFFERING_B_OPEN },
      }),
    ).toBe(0)
  })

  it("blocks a new course for a did-not-appear arrear and says why", async () => {
    const f = await createFixture()
    signIn(f.absent)

    const response = await post("/api/student/courses/enroll", OFFERING_B_OPEN)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.arrear.reason).toBe("did-not-appear")
    expect(body.message).toContain("no final assessment mark was recorded for you")
  })

  it("never blocks the arrear's own course, so the re-offering still enrols", async () => {
    const f = await createFixture()
    signIn(f.failing)

    const response = await post("/api/student/courses/enroll", OFFERING_A_REOPEN)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(
      await prisma.enrollment.findUnique({
        where: {
          studentId_offeringId: { studentId: f.failing.profileId, offeringId: OFFERING_A_REOPEN },
        },
      }),
    ).toMatchObject({ status: "active" })
  })

  it("does not block a not-judged mid-term course", async () => {
    const f = await createFixture()
    signIn(f.midterm)

    const response = await post("/api/student/courses/enroll", OFFERING_B_OPEN)

    expect(response.status).toBe(200)
    expect(
      await prisma.enrollment.count({
        where: { studentId: f.midterm.profileId, offeringId: OFFERING_B_OPEN },
      }),
    ).toBe(1)
  })

  it("does not block a student who passed", async () => {
    const f = await createFixture()
    signIn(f.passing)

    const response = await post("/api/student/courses/enroll", OFFERING_B_OPEN)

    expect(response.status).toBe(200)
  })

  it("re-opens registration once the arrear is acknowledged, and records it", async () => {
    const f = await createFixture()
    signIn(f.failing)

    const ack = await post("/api/student/courses/enroll/acknowledge", OFFERING_A_ENDED)
    expect(ack.status).toBe(200)

    const recorded = await prisma.arrearAcknowledgement.findUnique({
      where: {
        studentId_offeringId: { studentId: f.failing.profileId, offeringId: OFFERING_A_ENDED },
      },
    })
    expect(recorded).toMatchObject({ reason: "failed" })

    const retry = await post("/api/student/courses/enroll", OFFERING_B_OPEN)
    expect(retry.status).toBe(200)
  })

  it("refuses to acknowledge an offering that carries no arrear for the student", async () => {
    const f = await createFixture()
    signIn(f.failing)

    const response = await post("/api/student/courses/enroll/acknowledge", OFFERING_B_OPEN)

    expect(response.status).toBe(409)
    expect(
      await prisma.arrearAcknowledgement.count({ where: { studentId: f.failing.profileId } }),
    ).toBe(0)
  })

  it("exposes the hold on the catalog for other courses, but not for the arrear's own", async () => {
    const f = await createFixture()
    const user = { id: f.failing.userId, email: f.failing.email, role: "student" as const }

    const payload = await listStudentCourses(user)
    const byCourse = new Map(payload!.offeredCourses.map((course) => [course.courseId, course]))

    expect(byCourse.get(COURSE_B)!.arrearHold).toMatchObject({
      courseCode: "GATE-A",
      reason: "failed",
    })
    // The arrear's own course is registerable again — no hold on it.
    expect(byCourse.get(COURSE_A)!.arrearHold).toBeNull()
  })

  it("clears the catalog hold after acknowledgement", async () => {
    const f = await createFixture()
    const user = { id: f.failing.userId, email: f.failing.email, role: "student" as const }
    signIn(f.failing)

    await post("/api/student/courses/enroll/acknowledge", OFFERING_A_ENDED)
    const payload = await listStudentCourses(user)
    const courseB = payload!.offeredCourses.find((course) => course.courseId === COURSE_B)!

    expect(courseB.arrearHold).toBeNull()
  })
})

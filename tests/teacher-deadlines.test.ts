import { beforeAll, describe, expect, it } from "vitest"

import type { AuthUser } from "@/lib/session"
import { listAssessmentDeadlinesForTeacher } from "@/lib/teacher-planner"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * The planner's assessment-deadline query, against a real database.
 *
 * The scope is the risky part, and it is the same rule the release action uses —
 * "created it, or teach its offering" — so a teacher sees exactly the deadlines they
 * can act on. The fixture therefore builds an assessment on someone else's offering
 * that this teacher must *not* see, and the mirror case: this teacher's own
 * assessment sitting on a colleague's offering, which they must.
 *
 * Counts are asserted against real rows rather than assumed: `submitted` comes from
 * `Submission` and `graded` from `Grade`, and `Grade` rows only exist once a human
 * publishes. A test that only checked the field existed would pass with a hard-coded
 * zero.
 */

let f: Awaited<ReturnType<typeof createSpineFixture>>
let teacher: AuthUser
let otherTeacher: AuthUser
let noProfile: AuthUser

let mineOnMyOffering: string
let mineOnTheirOffering: string
let theirsOnTheirOffering: string

beforeAll(async () => {
  await truncateAll()
  f = await createSpineFixture(prisma)
  teacher = { id: f.teacher.id, email: f.teacher.email, role: "teacher" }

  const other = await prisma.user.create({
    data: {
      email: "planner-other@spine.test",
      passwordHash: "test-only-not-a-real-hash",
      role: "TEACHER",
      staffProfile: { create: { fullName: "Otto Other", empId: "EMP-PLAN-2" } },
    },
    include: { staffProfile: true },
  })
  otherTeacher = { id: other.id, email: other.email, role: "teacher" }

  const bare = await prisma.user.create({
    data: {
      email: "planner-nostaff@spine.test",
      passwordHash: "test-only-not-a-real-hash",
      role: "TEACHER",
    },
    select: { id: true, email: true },
  })
  noProfile = { id: bare.id, email: bare.email, role: "teacher" }

  const otherClass = await prisma.classRoom.create({
    data: { code: "PLAN-CLASS-B", name: "Room 99", academicYear: 2026 },
  })
  // A second offering of the SAME course, taught by the OTHER teacher.
  const otherOffering = await prisma.courseOffering.create({
    data: {
      courseId: f.course.id,
      classId: otherClass.id,
      teacherId: other.staffProfile!.id,
      term: "Term-Other",
      academicYear: 2026,
    },
  })

  const base = {
    courseId: f.course.id,
    maxMarks: 10,
    type: "ASSIGNMENT" as const,
  }

  // On the teacher's own offering, created by them. Due date chosen so it does not
  // collide with the spine fixture's assessment (2026-10-01), which this teacher
  // also owns -- otherwise the ordering assertion would be ambiguous.
  mineOnMyOffering = (
    await prisma.assessment.create({
      data: {
        ...base,
        offeringId: f.offering.id,
        classId: f.classroom.id,
        title: "My assignment",
        dueDate: new Date("2026-10-05T08:00:00.000Z"),
        createdById: f.teacher.staffProfile!.id,
      },
    })
  ).id

  // Created by them, but on the other teacher's offering.
  mineOnTheirOffering = (
    await prisma.assessment.create({
      data: {
        ...base,
        offeringId: otherOffering.id,
        classId: otherClass.id,
        title: "My assessment on a colleague's offering",
        dueDate: new Date("2026-09-20T08:00:00.000Z"),
        createdById: f.teacher.staffProfile!.id,
      },
    })
  ).id

  // The other teacher's, on their own offering.
  theirsOnTheirOffering = (
    await prisma.assessment.create({
      data: {
        ...base,
        offeringId: otherOffering.id,
        classId: otherClass.id,
        title: "Someone else's assignment",
        dueDate: new Date("2026-09-25T08:00:00.000Z"),
        createdById: other.staffProfile!.id,
      },
    })
  ).id
})

const ids = (items: { id: string }[]) => items.map((item) => item.id)

describe("listAssessmentDeadlinesForTeacher", () => {
  it("includes an assessment on an offering they teach", async () => {
    expect(ids(await listAssessmentDeadlinesForTeacher(teacher))).toContain(mineOnMyOffering)
  })

  it("includes their own assessment even on a colleague's offering", async () => {
    // Ownership is "created it or teach its offering", so this must appear.
    expect(ids(await listAssessmentDeadlinesForTeacher(teacher))).toContain(mineOnTheirOffering)
  })

  it("excludes a colleague's assessment on a colleague's offering", async () => {
    expect(ids(await listAssessmentDeadlinesForTeacher(teacher))).not.toContain(
      theirsOnTheirOffering,
    )
  })

  it("returns exactly the three they own", async () => {
    // Pins the whole set, so neither an over- nor an under-permissive change slips
    // through as "still contains the ones I expected". Three, not two: the spine
    // fixture creates an assessment on this teacher's offering too, and it is
    // legitimately theirs.
    expect(ids(await listAssessmentDeadlinesForTeacher(teacher)).sort()).toEqual(
      [f.assessment.id, mineOnMyOffering, mineOnTheirOffering].sort(),
    )
  })

  it("orders by due date, soonest first", async () => {
    // A planner is read forwards, unlike the student's newest-first materials list.
    // The spine fixture's assessment is due between these two.
    const deadlines = await listAssessmentDeadlinesForTeacher(teacher)
    const mine = deadlines.filter((d) =>
      [mineOnMyOffering, mineOnTheirOffering, f.assessment.id].includes(d.id),
    )
    expect(mine.map((d) => d.dueDate)).toEqual([
      "2026-09-20T08:00:00.000Z",
      "2026-10-01T08:00:00.000Z",
      "2026-10-05T08:00:00.000Z",
    ])
  })

  it("reports both release states without a separate flag", async () => {
    await prisma.assessment.update({
      where: { id: mineOnMyOffering },
      data: { releasedAt: new Date("2026-09-25T08:00:00.000Z") },
    })

    const deadlines = await listAssessmentDeadlinesForTeacher(teacher)
    const released = deadlines.find((d) => d.id === mineOnMyOffering)
    const unreleased = deadlines.find((d) => d.id === mineOnTheirOffering)

    expect(released?.released).toBe(true)
    expect(released?.releasedAt).toBe("2026-09-25T08:00:00.000Z")
    // The unreleased one is still listed for its teacher -- that asymmetry with the
    // student reader is the point of the release concept.
    expect(unreleased?.released).toBe(false)
    expect(unreleased?.releasedAt).toBeNull()
  })

  it("counts real submissions and real published grades", async () => {
    const studentId = f.student.studentProfile!.id

    // One submission: `Submission` is unique per (assessment, student), so counting
    // more than one would need a second student rather than a second row.
    await prisma.submission.create({
      data: { assessmentId: mineOnMyOffering, studentId, submittedAt: new Date() },
    })

    const beforeGrading = await listAssessmentDeadlinesForTeacher(teacher)
    const ungraded = beforeGrading.find((d) => d.id === mineOnMyOffering)
    expect(ungraded?.submitted).toBe(1)
    // No Grade rows yet: submitted is not the same fact as graded, and reporting
    // one number for both would be the bug this asserts against.
    expect(ungraded?.graded).toBe(0)

    await prisma.grade.create({
      data: {
        assessmentId: mineOnMyOffering,
        studentId,
        points: 8,
        maxPoints: 10,
        source: "TEACHER_OVERRIDE",
        publishedAt: new Date(),
        approvedById: f.teacher.staffProfile!.id,
      },
    })

    const afterGrading = await listAssessmentDeadlinesForTeacher(teacher)
    const graded = afterGrading.find((d) => d.id === mineOnMyOffering)
    expect(graded?.submitted).toBe(1)
    expect(graded?.graded).toBe(1)
  })

  it("returns nothing for a teacher-shaped user with no staff profile", async () => {
    expect(await listAssessmentDeadlinesForTeacher(noProfile)).toEqual([])
  })
})

describe("cleanup", () => {
  it("disconnects", async () => {
    await disconnectTestDatabase()
  })
})

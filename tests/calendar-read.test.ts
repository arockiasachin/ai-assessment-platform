import { beforeAll, describe, expect, it } from "vitest"

import { listStudentCalendar, listTeacherCalendar } from "@/lib/calendar"
import type { AuthUser } from "@/lib/session"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"

/**
 * The calendar reader's scope, against a real database.
 *
 * The scope is the risky part of this module — three visibility tiers on the
 * student side, three on the teacher side, plus the release rule that differs
 * between the two. So the fixture deliberately builds **both** an offering the
 * reader should see and one it must not, and the same for the release state.
 *
 * The pair that matters most is #5: the identical event must be **absent for the
 * student and present for its teacher**. An unreleased assessment that leaks to
 * students is the bug the release concept exists to prevent, and a filter that
 * never filters anything would still pass a test that only checked the teacher's
 * view.
 */

const OTHER = {
  courseCode: "OTHER-COURSE-TEST",
  className: "Other Room",
} as const

let student: AuthUser
let teacher: AuthUser
let otherTeacher: AuthUser
let outsider: AuthUser

// Event ids, so assertions read as "which events are visible" rather than
// "how many rows came back".
let eOffering: string
let eClassOnly: string
let eInstitutionWide: string
let eDanglingAssessment: string
let eReleasedAssessment: string
let eUnreleasedAssessment: string
let eOtherOffering: string
let eOtherOfferingAssessmentOfMine: string

beforeAll(async () => {
  await truncateAll()

  // --- People -------------------------------------------------------------
  const teacherUser = await prisma.user.create({
    data: {
      email: "cal-teacher@spine.test",
      passwordHash: "test-only-not-a-real-hash",
      role: "TEACHER",
      staffProfile: { create: { fullName: "Tara Teacher", empId: "EMP-CAL-1" } },
    },
    include: { staffProfile: true },
  })
  teacher = { id: teacherUser.id, email: teacherUser.email, role: "teacher" }

  const otherTeacherUser = await prisma.user.create({
    data: {
      email: "cal-other@spine.test",
      passwordHash: "test-only-not-a-real-hash",
      role: "TEACHER",
      staffProfile: { create: { fullName: "Otto Other", empId: "EMP-CAL-2" } },
    },
    include: { staffProfile: true },
  })
  otherTeacher = { id: otherTeacherUser.id, email: otherTeacherUser.email, role: "teacher" }

  const studentUser = await prisma.user.create({
    data: {
      email: "cal-student@spine.test",
      passwordHash: "test-only-not-a-real-hash",
      role: "STUDENT",
      studentProfile: { create: { fullName: "Sam Student", registerNumber: "REG-CAL-1" } },
    },
    include: { studentProfile: true },
  })
  student = { id: studentUser.id, email: studentUser.email, role: "student" }

  // A student enrolled in nothing at all.
  const outsiderUser = await prisma.user.create({
    data: {
      email: "cal-outsider@spine.test",
      passwordHash: "test-only-not-a-real-hash",
      role: "STUDENT",
      studentProfile: { create: { fullName: "Olive Outsider", registerNumber: "REG-CAL-2" } },
    },
    include: { studentProfile: true },
  })
  outsider = { id: outsiderUser.id, email: outsiderUser.email, role: "student" }

  // --- Course structures --------------------------------------------------
  const course = await prisma.course.create({
    data: { code: "CAL-COURSE-TEST", name: "Calendar Test Course", credits: 3 },
  })
  const classA = await prisma.classRoom.create({
    data: { code: "CAL-CLASS-A", name: "Room 12", academicYear: 2026 },
  })
  const offering = await prisma.courseOffering.create({
    data: {
      courseId: course.id,
      classId: classA.id,
      teacherId: teacherUser.staffProfile!.id,
      term: "Term-Cal",
      academicYear: 2026,
    },
  })

  const otherCourse = await prisma.course.create({
    data: { code: OTHER.courseCode, name: "Other Course", credits: 3 },
  })
  const otherClass = await prisma.classRoom.create({
    data: { code: "CAL-CLASS-B", name: OTHER.className, academicYear: 2026 },
  })
  // Taught by the OTHER teacher, so it is neither the student's nor our teacher's.
  const otherOffering = await prisma.courseOffering.create({
    data: {
      courseId: otherCourse.id,
      classId: otherClass.id,
      teacherId: otherTeacherUser.staffProfile!.id,
      term: "Term-Cal",
      academicYear: 2026,
    },
  })

  // The student is enrolled in the first offering only.
  await prisma.enrollment.create({
    data: { studentId: studentUser.studentProfile!.id, offeringId: offering.id, status: "active" },
  })

  // --- Assessments --------------------------------------------------------
  const released = await prisma.assessment.create({
    data: {
      offeringId: offering.id,
      courseId: course.id,
      classId: classA.id,
      title: "Released check-in",
      type: "QUIZ",
      dueDate: new Date("2026-11-30T08:00:00.000Z"),
      maxMarks: 20,
      releasedAt: new Date("2026-11-16T08:00:00.000Z"),
      createdById: teacherUser.staffProfile!.id,
    },
  })

  const unreleased = await prisma.assessment.create({
    data: {
      offeringId: offering.id,
      courseId: course.id,
      classId: classA.id,
      title: "Unreleased check-in",
      type: "QUIZ",
      dueDate: new Date("2026-12-10T08:00:00.000Z"),
      maxMarks: 20,
      releasedAt: null,
      createdById: teacherUser.staffProfile!.id,
    },
  })

  // Our teacher's own assessment, but on the OTHER teacher's offering. This is
  // the case the "assessments I created" clause exists for.
  const mineOnTheirOffering = await prisma.assessment.create({
    data: {
      offeringId: otherOffering.id,
      courseId: otherCourse.id,
      classId: otherClass.id,
      title: "My assessment on a colleague's offering",
      type: "ASSIGNMENT",
      dueDate: new Date("2026-12-15T08:00:00.000Z"),
      maxMarks: 10,
      releasedAt: new Date("2026-12-01T08:00:00.000Z"),
      createdById: teacherUser.staffProfile!.id,
    },
  })

  // --- Events -------------------------------------------------------------
  const base = { startAt: new Date("2026-09-19T09:00:00.000Z"), isUpcoming: true }

  eOffering = (
    await prisma.calendarEvent.create({
      data: {
        ...base,
        classId: classA.id,
        offeringId: offering.id,
        title: "Lecture — graphing linear functions",
        description: "Bring the practice set.",
        eventType: "CLASS",
      },
    })
  ).id

  // Class-scoped but with no offering: the third tier of the student scope.
  eClassOnly = (
    await prisma.calendarEvent.create({
      data: {
        ...base,
        classId: classA.id,
        offeringId: null,
        title: "Class-only event",
        eventType: "CLASS",
      },
    })
  ).id

  // Unscoped: a holiday for the whole institution.
  eInstitutionWide = (
    await prisma.calendarEvent.create({
      data: {
        ...base,
        classId: null,
        offeringId: null,
        title: "Mid-term break",
        description: "No classes this week.",
        eventType: "HOLIDAY",
      },
    })
  ).id

  // A deleted assessment (or offering) nulls every scope column by `SetNull`. Without the guard
  // this event matched the unscoped tier and was served to every student in every institution,
  // and nulling `assessmentId` also exempted it from the release filter (TN-70).
  eDanglingAssessment = (
    await prisma.calendarEvent.create({
      data: {
        ...base,
        classId: null,
        offeringId: null,
        assessmentId: null,
        title: "Due: deleted assessment",
        eventType: "ASSESSMENT",
      },
    })
  ).id

  eReleasedAssessment = (
    await prisma.calendarEvent.create({
      data: {
        ...base,
        classId: classA.id,
        offeringId: offering.id,
        assessmentId: released.id,
        title: "Due: Released check-in",
        eventType: "ASSESSMENT",
      },
    })
  ).id

  // THE pair: same offering as the student's, but its assessment is unreleased.
  eUnreleasedAssessment = (
    await prisma.calendarEvent.create({
      data: {
        ...base,
        classId: classA.id,
        offeringId: offering.id,
        assessmentId: unreleased.id,
        title: "Due: Unreleased check-in",
        eventType: "ASSESSMENT",
      },
    })
  ).id

  // Another teacher's offering: must be invisible to both readers.
  eOtherOffering = (
    await prisma.calendarEvent.create({
      data: {
        ...base,
        classId: otherClass.id,
        offeringId: otherOffering.id,
        title: "Someone else's lecture",
        eventType: "CLASS",
      },
    })
  ).id

  eOtherOfferingAssessmentOfMine = (
    await prisma.calendarEvent.create({
      data: {
        ...base,
        classId: otherClass.id,
        offeringId: otherOffering.id,
        assessmentId: mineOnTheirOffering.id,
        title: "Due: My assessment on a colleague's offering",
        eventType: "ASSESSMENT",
      },
    })
  ).id
})

const ids = (items: { id: string }[]) => items.map((item) => item.id)

describe("listStudentCalendar", () => {
  it("sees events on an offering they are enrolled in", async () => {
    expect(ids(await listStudentCalendar(student))).toContain(eOffering)
  })

  it("sees an event scoped to a class of an offering they are in", async () => {
    // Third tier: classId set, offeringId null. Reachable only through the class.
    expect(ids(await listStudentCalendar(student))).toContain(eClassOnly)
  })

  it("sees an institution-wide event with no offering and no class", async () => {
    // A holiday belongs to everyone; without this tier it would be invisible to
    // every student, which reads as a reader bug rather than a scope rule.
    expect(ids(await listStudentCalendar(student))).toContain(eInstitutionWide)
  })

  it("sees an event for a released assessment", async () => {
    expect(ids(await listStudentCalendar(student))).toContain(eReleasedAssessment)
  })

  it("does NOT see an event for an unreleased assessment", async () => {
    // The security-relevant half of the release concept.
    expect(ids(await listStudentCalendar(student))).not.toContain(eUnreleasedAssessment)
  })

  it("does not see another offering's events", async () => {
    const visible = ids(await listStudentCalendar(student))
    expect(visible).not.toContain(eOtherOffering)
    expect(visible).not.toContain(eOtherOfferingAssessmentOfMine)
  })

  it("does NOT see a dangling assessment event with no scope (TN-70)", async () => {
    // Both readers must exclude it: it is an orphan, not an institution-wide notice.
    expect(ids(await listStudentCalendar(student))).not.toContain(eDanglingAssessment)
  })

  it("returns exactly the four events it should", async () => {
    // Pins the whole set, so neither an over-permissive nor an under-permissive
    // change slips through as "still contains the ones I expected".
    expect(ids(await listStudentCalendar(student)).sort()).toEqual(
      [eOffering, eClassOnly, eInstitutionWide, eReleasedAssessment].sort(),
    )
  })

  it("still shows an institution-wide event to a student enrolled in nothing", async () => {
    // Consistency with the rule that an unscoped event belongs to everyone. An
    // early return for "no enrolments" would be simpler and wrong: a student
    // between registrations would stop seeing the mid-term break.
    expect(ids(await listStudentCalendar(outsider))).toEqual([eInstitutionWide])
  })

  it("orders events by start time ascending", async () => {
    const events = await listStudentCalendar(student)
    const starts = events.map((event) => event.startAt)
    expect([...starts].sort()).toEqual(starts)
  })
})

describe("listTeacherCalendar", () => {
  it("sees events on an offering they teach", async () => {
    expect(ids(await listTeacherCalendar(teacher))).toContain(eOffering)
  })

  it("sees an unreleased assessment's event — the asymmetry with students", async () => {
    // Same event, opposite verdicts. This is the assertion that proves the release
    // filter is doing something: a filter that never filtered would fail the
    // student test above, and one applied to both readers would fail this one.
    expect(ids(await listTeacherCalendar(teacher))).toContain(eUnreleasedAssessment)
    expect(ids(await listStudentCalendar(student))).not.toContain(eUnreleasedAssessment)
  })

  it("sees their own assessment even on a colleague's offering", async () => {
    // Ownership is "created it or teach its offering", so this event carries the
    // colleague's offeringId. Filtering on offering alone would hide it.
    expect(ids(await listTeacherCalendar(teacher))).toContain(eOtherOfferingAssessmentOfMine)
  })

  it("does not see a colleague's event on a colleague's offering", async () => {
    expect(ids(await listTeacherCalendar(teacher))).not.toContain(eOtherOffering)
  })

  it("does not see the other teacher's own assessment event", async () => {
    // The mirror: the other teacher sees their own events, not ours.
    const theirs = ids(await listTeacherCalendar(otherTeacher))
    expect(theirs).toContain(eOtherOffering)
    expect(theirs).not.toContain(eUnreleasedAssessment)
  })

  it("sees institution-wide events", async () => {
    expect(ids(await listTeacherCalendar(teacher))).toContain(eInstitutionWide)
  })

  it("returns nothing for a teacher-shaped user with no staff profile", async () => {
    const bare = await prisma.user.create({
      data: {
        email: "cal-nostaff@spine.test",
        passwordHash: "test-only-not-a-real-hash",
        role: "TEACHER",
      },
    })
    expect(await listTeacherCalendar({ id: bare.id, email: bare.email, role: "teacher" })).toEqual(
      [],
    )
  })
})

describe("projection through the reader", () => {
  it("derives location from the class room and course code from the offering", async () => {
    const events = await listStudentCalendar(student)
    const lecture = events.find((event) => event.id === eOffering)
    expect(lecture?.location).toBe("Room 12")
    expect(lecture?.courseCode).toBe("CAL-COURSE-TEST")
    expect(lecture?.detail).toBe("Bring the practice set.")
  })

  it("leaves location null for the holiday, so the page can render an em dash", async () => {
    const events = await listStudentCalendar(student)
    const holiday = events.find((event) => event.id === eInstitutionWide)
    expect(holiday?.location).toBeNull()
    expect(holiday?.courseCode).toBeNull()
    expect(holiday?.kind).toBe("HOLIDAY")
  })
})

describe("cleanup", () => {
  it("disconnects", async () => {
    await disconnectTestDatabase()
  })
})

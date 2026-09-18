import { afterAll, beforeEach, describe, expect, it } from "vitest"

import type { AuthUser } from "@/lib/session"
import { listStudentAssessments } from "@/lib/student-assessments"
import { listStudentCourses } from "@/lib/student-courses"
import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * The classroom label on the two student reads.
 *
 * `classroomLabel` exists because the courses seed writes `ClassRoom.name` values that
 * already end in their section (`M.Tech (CSE) BDA — DSA — Section A`) while `section`
 * holds `A` too. A blind "name section" append therefore rendered `Section A A`. That
 * was consolidated for the teacher surfaces (TN-24 / TL-6), but the two student
 * payloads kept their own copies of the append, so the defect stayed live for
 * students and **invisible**, because no seeded student is enrolled in a
 * section-carrying classroom. These tests pin the wiring so it cannot drift back.
 */
function studentActor(user: { id: string; email: string }): AuthUser {
  return { id: user.id, email: user.email, role: "student" }
}

/** A classroom whose name already carries its section, mirroring the courses seed. */
const SECTION_CARRYING_NAME = "M.Tech (CSE) BDA — DSA — Section A"

describe("classroom labels on the student reads", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  async function seedEnrolled() {
    const f = await createSpineFixture(prisma)
    await prisma.classRoom.update({
      where: { id: f.classroom.id },
      data: { name: SECTION_CARRYING_NAME, section: "A" },
    })
    await prisma.enrollment.create({
      data: {
        studentId: f.student.studentProfile!.id,
        offeringId: f.offering.id,
        status: "active",
      },
    })
    return f
  }

  it("does not repeat the section on an assessment's class label", async () => {
    const f = await seedEnrolled()

    const payload = await listStudentAssessments(studentActor(f.student))
    const item = payload?.assessments.find((a) => a.id === f.assessment.id)

    expect(item?.className).toBe(SECTION_CARRYING_NAME)
    // The failure this guards against: "…Section A A".
    expect(item?.className).not.toContain("Section A A")
  })

  it("does not repeat the section on an enrolled course's class label", async () => {
    const f = await seedEnrolled()

    const payload = await listStudentCourses(studentActor(f.student))
    const item = payload?.enrolledCourses.find((c) => c.offeringId === f.offering.id)

    expect(item?.className).toBe(SECTION_CARRYING_NAME)
    expect(item?.className).not.toContain("Section A A")
  })

  it("still appends a section the name does not already carry", async () => {
    // The other half of the rule: the consolidation must not have dropped the append
    // for names that legitimately need it (the demo seed's "Grade 10" + "A").
    const f = await createSpineFixture(prisma)
    await prisma.classRoom.update({
      where: { id: f.classroom.id },
      data: { name: "Grade 10", section: "A" },
    })
    await prisma.enrollment.create({
      data: {
        studentId: f.student.studentProfile!.id,
        offeringId: f.offering.id,
        status: "active",
      },
    })

    const payload = await listStudentAssessments(studentActor(f.student))
    const item = payload?.assessments.find((a) => a.id === f.assessment.id)

    expect(item?.className).toBe("Grade 10 A")
  })
})

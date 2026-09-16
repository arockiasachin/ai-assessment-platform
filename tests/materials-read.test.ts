import { beforeAll, describe, expect, it } from "vitest"

import { listMaterialsForStudent } from "@/lib/materials"
import type { AuthUser } from "@/lib/session"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * The materials read path.
 *
 * The scope has two tiers, and both are easy to get subtly wrong: material attached
 * to an offering the student is in, **or** course-wide material (`offeringId: null`)
 * for a course they are in. The retriever reads the same two tiers, so if these
 * diverge a student could be quizzed on material their own page does not show.
 *
 * Fixture shape, deliberately:
 *
 * - the student is enrolled in offering A of course X, and in nothing else;
 * - an unrelated course Y exists with its own offering;
 * - materials are created to hit each branch, including the two that must NOT be
 *   visible.
 */

let enrolledUserId: string
let outsiderUserId: string

let visibleOfferingMaterial: string
let visibleCourseWideMaterial: string
let otherCourseWideMaterial: string
let otherOfferingMaterial: string

beforeAll(async () => {
  await truncateAll()

  const fixture = await createSpineFixture(prisma)
  const studentId = fixture.student.studentProfile!.id
  enrolledUserId = fixture.student.id
  const teacherId = fixture.teacher.staffProfile!.id

  // Enrol the student in the spine offering only.
  await prisma.enrollment.create({
    data: { studentId, offeringId: fixture.offering.id, status: "active" },
  })

  // A second course and offering the student is NOT enrolled in.
  const otherCourse = await prisma.course.create({
    data: { code: "OTHER-SPINE-TEST", name: "Other Spine Course", credits: 3 },
  })
  const otherClassroom = await prisma.classRoom.create({
    data: { code: "OTHER-CLASS-TEST", name: "Other Test Class", academicYear: 2026 },
  })
  const otherOffering = await prisma.courseOffering.create({
    data: {
      courseId: otherCourse.id,
      classId: otherClassroom.id,
      teacherId,
      term: "Term-Test",
      academicYear: 2026,
    },
  })

  // 1. Attached to the enrolled offering — visible.
  const offeringMaterial = await prisma.material.create({
    data: {
      courseId: fixture.course.id,
      offeringId: fixture.offering.id,
      createdById: teacherId,
      title: "Linear equations — lecture notes",
      kind: "DOCUMENT",
      mimeType: "text/plain",
      contentText: "Isolate the variable using inverse operations.",
    },
  })
  visibleOfferingMaterial = offeringMaterial.id
  await prisma.materialChunk.createMany({
    data: [0, 1, 2].map((index) => ({
      materialId: offeringMaterial.id,
      chunkIndex: index,
      content: `chunk ${index}`,
    })),
  })

  // 2. Course-wide in the enrolled course — visible, and unindexed.
  const courseWide = await prisma.material.create({
    data: {
      courseId: fixture.course.id,
      offeringId: null,
      createdById: teacherId,
      title: "Course syllabus",
      kind: "DOCUMENT",
      sourceUrl: "https://example.test/syllabus.pdf",
    },
  })
  visibleCourseWideMaterial = courseWide.id

  // 3. Course-wide in a course the student is NOT in — must NOT be visible.
  const otherWide = await prisma.material.create({
    data: {
      courseId: otherCourse.id,
      offeringId: null,
      createdById: teacherId,
      title: "Other course handout",
      kind: "LINK",
    },
  })
  otherCourseWideMaterial = otherWide.id

  // 4. Attached to an offering the student is NOT in — must NOT be visible.
  const otherOfferingMaterialRow = await prisma.material.create({
    data: {
      courseId: otherCourse.id,
      offeringId: otherOffering.id,
      createdById: teacherId,
      title: "Other offering slides",
      kind: "SLIDE_DECK",
    },
  })
  otherOfferingMaterial = otherOfferingMaterialRow.id

  // 5. A student with no enrolments at all.
  const outsider = await prisma.user.create({
    data: {
      email: "materials-outsider@spine.test",
      passwordHash: "test-only-not-a-real-hash",
      role: "STUDENT",
      studentProfile: { create: { fullName: "Outsider Student", registerNumber: "REG-OUT" } },
    },
    select: { id: true },
  })
  outsiderUserId = outsider.id
})

function asUser(id: string): AuthUser {
  return { id, email: "", role: "student" }
}

describe("listMaterialsForStudent", () => {
  it("sees material attached to an offering they are enrolled in", async () => {
    const views = await listMaterialsForStudent(asUser(enrolledUserId))
    expect(views.map((view) => view.id)).toContain(visibleOfferingMaterial)
  })

  it("sees course-wide material for a course they are enrolled in", async () => {
    // The second tier. Without it, a student would see only offering-attached
    // material while the retriever could still quiz them on the course-wide kind.
    const views = await listMaterialsForStudent(asUser(enrolledUserId))
    expect(views.map((view) => view.id)).toContain(visibleCourseWideMaterial)
  })

  it("does not see another course's course-wide material", async () => {
    const views = await listMaterialsForStudent(asUser(enrolledUserId))
    expect(views.map((view) => view.id)).not.toContain(otherCourseWideMaterial)
  })

  it("does not see another offering's material", async () => {
    const views = await listMaterialsForStudent(asUser(enrolledUserId))
    expect(views.map((view) => view.id)).not.toContain(otherOfferingMaterial)
  })

  it("returns exactly the two visible materials", async () => {
    const views = await listMaterialsForStudent(asUser(enrolledUserId))
    expect(views.map((view) => view.id).sort()).toEqual(
      [visibleOfferingMaterial, visibleCourseWideMaterial].sort(),
    )
  })

  it("counts chunks and derives indexed from the real rows", async () => {
    const views = await listMaterialsForStudent(asUser(enrolledUserId))
    const indexed = views.find((view) => view.id === visibleOfferingMaterial)
    const unindexed = views.find((view) => view.id === visibleCourseWideMaterial)

    expect(indexed?.chunks).toBe(3)
    expect(indexed?.indexed).toBe(true)

    // A zero-chunk material still appears, and is not indexed.
    expect(unindexed?.chunks).toBe(0)
    expect(unindexed?.indexed).toBe(false)
  })

  it("carries the course code and keeps a null sourceUrl null", async () => {
    const views = await listMaterialsForStudent(asUser(enrolledUserId))
    const indexed = views.find((view) => view.id === visibleOfferingMaterial)
    const linked = views.find((view) => view.id === visibleCourseWideMaterial)

    expect(indexed?.courseCode).toBe("COURSE-SPINE-TEST")
    expect(indexed?.sourceUrl).toBeNull()
    expect(linked?.sourceUrl).toBe("https://example.test/syllabus.pdf")
  })

  it("returns newest first", async () => {
    const views = await listMaterialsForStudent(asUser(enrolledUserId))
    const dates = views.map((view) => view.updatedAt)
    // Compare the order against its own sorted copy, so ties cannot make this flaky.
    expect([...dates].sort().reverse()).toEqual(dates)
  })

  it("returns nothing for a student with no enrolments", async () => {
    expect(await listMaterialsForStudent(asUser(outsiderUserId))).toEqual([])
  })
})

describe("cleanup", () => {
  it("disconnects", async () => {
    await disconnectTestDatabase()
  })
})

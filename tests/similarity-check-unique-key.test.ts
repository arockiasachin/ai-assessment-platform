import { afterAll, beforeEach, describe, expect, it } from "vitest"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * `SimilarityCheck` uniqueness is unconditional.
 *
 * ## The defect these pin
 *
 * The key was `[assessmentId, codeTaskId, studentId, comparedStudentId]` with a **nullable**
 * `assessmentId`. Postgres treats NULLs as distinct in a unique index, so two rows for the same
 * student pair could both be inserted whenever `assessmentId` was null. That was reproduced
 * against a real database before the constraint changed, and it matters because every reader
 * counts or ranks pairs — a duplicated pair is double-counted in the similarity view, and a
 * flagged pair could appear twice in a teacher's queue.
 *
 * The key is now `[codeTaskId, studentId, comparedStudentId]` with `codeTaskId` **required**, so no
 * nullable column remains in it and uniqueness holds without case-by-case argument.
 *
 * The tests are written against the database rather than the schema text: a `@@unique` in
 * `schema.prisma` only proves something once Postgres agrees, and the whole point of this defect is
 * that the two can disagree.
 */

async function createCodeTaskFixture() {
  const fixture = await createSpineFixture(prisma)

  const assessment2 = await prisma.assessment.create({
    data: {
      title: "Second code assessment",
      type: "CODE",
      dueDate: new Date("2026-11-01T08:00:00.000Z"),
      maxMarks: 20,
      offeringId: fixture.offering.id,
      courseId: fixture.course.id,
      classId: fixture.classroom.id,
      createdById: fixture.teacher.staffProfile!.id,
    },
  })

  const codeTask = await prisma.codeTask.create({
    data: { assessmentId: assessment2.id, language: "python" },
  })

  const secondStudent = await prisma.studentProfile.create({
    data: {
      userId: (
        await prisma.user.create({
          data: {
            email: "similarity-second@test.local",
            passwordHash: "test-only-not-a-real-hash",
            role: "STUDENT",
          },
        })
      ).id,
      fullName: "Second Student",
      registerNumber: "SIM-0002",
    },
  })

  return { fixture, codeTask, secondStudent }
}

const PAIR = (codeTaskId: string, studentId: string, comparedStudentId: string) => ({
  codeTaskId,
  studentId,
  comparedStudentId,
  similarity: 0.9,
})

describe("SimilarityCheck unique key", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("rejects a duplicate pair even when assessmentId is null", async () => {
    // The exact case the old key could not constrain: a null `assessmentId` made the row unique
    // against nothing, because NULL is distinct from NULL in a unique index.
    const { fixture, codeTask, secondStudent } = await createCodeTaskFixture()
    const row = PAIR(codeTask.id, fixture.student.studentProfile!.id, secondStudent.id)

    await prisma.similarityCheck.create({ data: { ...row, assessmentId: null } })

    await expect(
      prisma.similarityCheck.create({ data: { ...row, assessmentId: null } }),
    ).rejects.toMatchObject({ code: "P2002" })
  })

  it("rejects a duplicate pair when assessmentId is set too", async () => {
    const { fixture, codeTask, secondStudent } = await createCodeTaskFixture()
    const row = PAIR(codeTask.id, fixture.student.studentProfile!.id, secondStudent.id)
    const assessmentId = codeTask.assessmentId

    await prisma.similarityCheck.create({ data: { ...row, assessmentId } })

    await expect(
      prisma.similarityCheck.create({ data: { ...row, assessmentId } }),
    ).rejects.toMatchObject({ code: "P2002" })
  })

  it("allows the same pair on a different code task", async () => {
    // The key must still permit the legitimate case: the same two students compared on two
    // different tasks are two different comparisons, not a duplicate.
    const { fixture, codeTask, secondStudent } = await createCodeTaskFixture()
    const otherTask = await prisma.codeTask.create({
      data: { language: "python" },
    })
    const studentId = fixture.student.studentProfile!.id

    await prisma.similarityCheck.create({
      data: {
        ...PAIR(codeTask.id, studentId, secondStudent.id),
        assessmentId: codeTask.assessmentId,
      },
    })
    await prisma.similarityCheck.create({
      data: { ...PAIR(otherTask.id, studentId, secondStudent.id), assessmentId: null },
    })

    expect(await prisma.similarityCheck.count()).toBe(2)
  })

  it("allows the reverse pair, which is a different comparison", async () => {
    // The writer normalizes pair order, but the key must not silently merge A-B with B-A: they are
    // separate rows if anything ever writes them.
    const { fixture, codeTask, secondStudent } = await createCodeTaskFixture()
    const studentId = fixture.student.studentProfile!.id

    await prisma.similarityCheck.create({
      data: PAIR(codeTask.id, studentId, secondStudent.id),
    })
    await prisma.similarityCheck.create({
      data: PAIR(codeTask.id, secondStudent.id, studentId),
    })

    expect(await prisma.similarityCheck.count()).toBe(2)
  })

  it("requires a code task", async () => {
    // `codeTaskId` is required so that no nullable column remains in the key. This asserts the
    // column really is NOT NULL, rather than trusting the schema text.
    const { fixture, secondStudent } = await createCodeTaskFixture()

    await expect(
      prisma.similarityCheck.create({
        data: {
          codeTaskId: null as unknown as string,
          studentId: fixture.student.studentProfile!.id,
          comparedStudentId: secondStudent.id,
          similarity: 0.5,
        },
      }),
    ).rejects.toThrow()
  })

  it("no longer has the null-unsafe index it replaced", async () => {
    // Ties these tests to the constraint swap rather than to uniqueness in general: the four
    // tests above would also pass if uniqueness were enforced some other way, and this asserts the
    // specific index that permitted the duplicate is gone.
    const indexes = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'SimilarityCheck'
    `
    const names = indexes.map((row) => row.indexname)

    expect(names).toContain("SimilarityCheck_codeTaskId_studentId_comparedStudentId_key")
    expect(names.some((name) => name.includes("assessmentId_codeTaskId"))).toBe(false)
  })
})

import { beforeAll, describe, expect, it } from "vitest"

import { listAssessmentSubtopics, listSubtopicBreakdowns } from "@/lib/analytics/subtopics"
import type { AuthUser } from "@/lib/session"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * The subtopic readers against a real database.
 *
 * The batched variant is what the quiz-generation page uses, so the assertion that matters most is
 * that it **agrees with the single-assessment reader** — a page showing different topic counts from
 * the one-off call would be a bug nobody notices.
 */

let f: Awaited<ReturnType<typeof createSpineFixture>>
let teacher: AuthUser

beforeAll(async () => {
  await truncateAll()
  f = await createSpineFixture(prisma)
  teacher = { id: f.teacher.id, email: f.teacher.email, role: "teacher" }

  // Four questions: two tagged "slope", one "intercepts", one untagged.
  const tags: (string | null)[] = ["slope", "slope", "intercepts", null]
  for (const [index, subtopic] of tags.entries()) {
    await prisma.question.create({
      data: {
        assessmentId: f.assessment.id,
        order: index + 1,
        prompt: `Question ${index + 1}`,
        subtopic,
        points: index + 1,
        options: {
          create: [
            { order: 0, text: "A", isCorrect: true },
            { order: 1, text: "B", isCorrect: false },
          ],
        },
      },
    })
  }
})

describe("listAssessmentSubtopics", () => {
  it("groups by tag, counts questions and marks, and counts untagged separately", async () => {
    const breakdown = await listAssessmentSubtopics(teacher, f.assessment.id)
    expect(breakdown.distinctTags).toBe(2)
    expect(breakdown.tokens.map((token) => token.subtopic).sort()).toEqual(["intercepts", "slope"])

    const slope = breakdown.tokens.find((token) => token.subtopic === "slope")!
    expect(slope.questionCount).toBe(2)
    // 1 + 2 marks from the two "slope" questions.
    expect(slope.totalMarks).toBe(3)

    expect(breakdown.untagged.questionCount).toBe(1)
    expect(breakdown.tokens.map((token) => token.subtopic)).not.toContain("Uncategorised")
  })

  it("refuses an assessment the teacher does not own", async () => {
    const outsider = await prisma.user.create({
      data: {
        email: "subtopic-outsider@spine.test",
        passwordHash: "test-only-not-a-real-hash",
        role: "TEACHER",
        staffProfile: { create: { fullName: "Ola Outsider", empId: "EMP-SUB-9" } },
      },
    })
    await expect(
      listAssessmentSubtopics(
        { id: outsider.id, email: outsider.email, role: "teacher" },
        f.assessment.id,
      ),
    ).rejects.toMatchObject({ status: 403 })
  })
})

describe("listSubtopicBreakdowns", () => {
  it("returns the same breakdown as the single-assessment reader", async () => {
    // The property that makes the batched version safe to use on a page.
    const batched = await listSubtopicBreakdowns([f.assessment.id])
    const single = await listAssessmentSubtopics(teacher, f.assessment.id)

    const fromBatched = batched.get(f.assessment.id)!
    expect(fromBatched.distinctTags).toBe(single.distinctTags)
    expect(fromBatched.tokens).toEqual(single.tokens)
    expect(fromBatched.untagged).toEqual(single.untagged)
    expect(fromBatched.assessmentTitle).toBe(single.assessmentTitle)
  })

  it("returns an empty map for no ids, rather than querying", async () => {
    expect((await listSubtopicBreakdowns([])).size).toBe(0)
  })

  it("returns an entry for every requested id, including one with no questions", async () => {
    const empty = await prisma.assessment.create({
      data: {
        offeringId: f.offering.id,
        courseId: f.course.id,
        classId: f.classroom.id,
        title: "No questions yet",
        type: "QUIZ",
        dueDate: new Date("2026-10-01T00:00:00.000Z"),
        maxMarks: 10,
        createdById: f.teacher.staffProfile!.id,
      },
    })
    const batched = await listSubtopicBreakdowns([f.assessment.id, empty.id])

    // Both present. Omitting the empty one looked tidier and caused a real bug: the page defaults
    // to the *first* assessment, so an untagged-empty first assessment made the panel fall back to
    // its "select an assessment" state while one was selected.
    expect(batched.has(f.assessment.id)).toBe(true)
    expect(batched.has(empty.id)).toBe(true)
    expect(batched.get(empty.id)!.tokens).toEqual([])
    expect(batched.get(empty.id)!.distinctTags).toBe(0)
  })
})

describe("cleanup", () => {
  it("disconnects", async () => {
    await disconnectTestDatabase()
  })
})

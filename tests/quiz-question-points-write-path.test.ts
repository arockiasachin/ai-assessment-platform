import { afterAll, beforeEach, describe, expect, it } from "vitest"

import {
  deleteGeneratedQuestionForTeacher,
  editGeneratedQuestionForTeacher,
} from "@/lib/quiz-generation"
import type { AuthUser } from "@/lib/session"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * Per-question marks and draft removal (TN-42).
 *
 * The finding: per-question marks were neither visible nor writable, published questions were
 * permanently immutable, and there was no way to discard a bad generation. The decision taken is
 * that weights are authored **before** publish — a published question's prompt or weight must not
 * change under attempts already scored against it — and a **draft** can be deleted. These tests
 * pin both halves of that rule.
 */

function teacherSession(user: { id: string; email: string }): AuthUser {
  return { id: user.id, email: user.email, role: "teacher" }
}

async function createGeneratedQuestion(
  fixture: Awaited<ReturnType<typeof createSpineFixture>>,
  status: "draft" | "published",
): Promise<string> {
  const question = await prisma.question.create({
    data: {
      assessmentId: fixture.assessment.id,
      order: 0,
      prompt: "What is 2 + 2?",
      type: "MULTIPLE_CHOICE",
      points: 2,
      status,
      publishedAt: status === "published" ? new Date() : null,
      publishedById: status === "published" ? fixture.teacher.staffProfile!.id : null,
      options: {
        create: [
          { order: 0, text: "4", isCorrect: true },
          { order: 1, text: "5", isCorrect: false },
        ],
      },
    },
  })
  return question.id
}

describe("quiz question marks and draft deletion", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("writes a draft question's marks and audits the edit", async () => {
    const f = await createSpineFixture(prisma)
    const actor = teacherSession(f.teacher)
    const questionId = await createGeneratedQuestion(f, "draft")

    const updated = await editGeneratedQuestionForTeacher(actor, questionId, { points: 7 })
    expect(updated.points).toBe(7)

    const stored = await prisma.question.findUniqueOrThrow({ where: { id: questionId } })
    expect(Number(stored.points)).toBe(7)
    expect(await prisma.auditLog.count({ where: { action: "quiz_question.edited" } })).toBe(1)
  })

  it("deletes a draft question and its options, with an audit row", async () => {
    const f = await createSpineFixture(prisma)
    const actor = teacherSession(f.teacher)
    const questionId = await createGeneratedQuestion(f, "draft")

    await deleteGeneratedQuestionForTeacher(actor, questionId)

    expect(await prisma.question.findUnique({ where: { id: questionId } })).toBeNull()
    expect(await prisma.questionOption.count({ where: { questionId } })).toBe(0)
    expect(await prisma.auditLog.count({ where: { action: "quiz_question.deleted" } })).toBe(1)
  })

  it("refuses to delete a published question, and keeps it", async () => {
    const f = await createSpineFixture(prisma)
    const actor = teacherSession(f.teacher)
    const questionId = await createGeneratedQuestion(f, "published")

    await expect(deleteGeneratedQuestionForTeacher(actor, questionId)).rejects.toThrow(
      "Published questions cannot be deleted",
    )
    expect(await prisma.question.findUnique({ where: { id: questionId } })).not.toBeNull()
  })

  it("refuses to re-weight a published question, and keeps its stored marks", async () => {
    const f = await createSpineFixture(prisma)
    const actor = teacherSession(f.teacher)
    const questionId = await createGeneratedQuestion(f, "published")

    await expect(
      editGeneratedQuestionForTeacher(actor, questionId, { points: 99 }),
    ).rejects.toThrow("Published questions cannot be edited")
    const stored = await prisma.question.findUniqueOrThrow({ where: { id: questionId } })
    expect(Number(stored.points)).toBe(2)
  })
})

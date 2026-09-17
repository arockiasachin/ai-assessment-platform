import { afterAll, beforeEach, describe, expect, it } from "vitest"

import { listStudentAssessments } from "@/lib/student-assessments"
import type { AuthUser } from "@/lib/session"
import { listStudentQuizzes, quizDeliveryStatus, startQuizAttempt } from "@/lib/quiz-attempts"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * TN-41, the owner's decision: **deliver the published subset**.
 *
 * One unpublished draft used to make the whole quiz invisible — the assessment
 * list reported `quizQuestionCount: 0` and starting returned 409 — while the
 * quiz-attempts list still counted all five. The fix gives the draft/published
 * predicate one definition, and every count and every delivery path reads the
 * subset it returns, so a count of 5 can never sit beside a delivery of 3 again.
 *
 * A quiz with **zero** published questions is a different case from one with no
 * questions at all: it is authored but unpublished, so it stays undeliverable
 * (there is no content to serve) but says so in its own words.
 */

function studentSession(user: { id: string; email: string }): AuthUser {
  return { id: user.id, email: user.email, role: "student" }
}

async function seedQuizWithQuestions(options: { published: number; drafts: number }) {
  const fixture = await createSpineFixture(prisma)
  const studentId = fixture.student.studentProfile!.id
  await prisma.enrollment.create({
    data: { studentId, offeringId: fixture.offering.id, status: "active" },
  })

  const questions = []
  for (let index = 0; index < options.published + options.drafts; index += 1) {
    const status = index < options.published ? "published" : "draft"
    const question = await prisma.question.create({
      data: {
        assessmentId: fixture.assessment.id,
        order: index + 1,
        prompt: `Question ${index + 1}`,
        status,
        options: {
          create: [
            { order: 0, text: "Option A", isCorrect: true },
            { order: 1, text: "Option B", isCorrect: false },
          ],
        },
      },
      include: { options: true },
    })
    questions.push(question)
  }

  return { fixture, questions, studentId, studentUser: studentSession(fixture.student) }
}

describe("quizDeliveryStatus — the published subset is the delivery", () => {
  it("holds back drafts instead of making the whole quiz undeliverable", () => {
    const published = [
      {
        type: "MULTIPLE_CHOICE",
        status: "published",
        metadata: null,
        options: [{ isCorrect: true }, { isCorrect: false }],
      },
      {
        type: "MULTIPLE_CHOICE",
        status: "published",
        metadata: null,
        options: [{ isCorrect: true }, { isCorrect: false }],
      },
      {
        type: "MULTIPLE_CHOICE",
        status: null,
        metadata: null,
        options: [{ isCorrect: true }, { isCorrect: false }],
      },
    ]
    const drafts = [
      {
        type: "MULTIPLE_CHOICE",
        status: "draft",
        metadata: null,
        options: [{ isCorrect: true }, { isCorrect: false }],
      },
      {
        type: "MULTIPLE_CHOICE",
        status: "draft",
        metadata: null,
        options: [{ isCorrect: true }, { isCorrect: false }],
      },
    ]

    const delivery = quizDeliveryStatus([...published, ...drafts])
    expect(delivery.deliverable).toBe(true)
    expect(delivery.questions).toHaveLength(3)
    expect(delivery.draftCount).toBe(2)
  })

  it("is not deliverable with zero published questions, and names that case", () => {
    const delivery = quizDeliveryStatus([
      {
        type: "MULTIPLE_CHOICE",
        status: "draft",
        metadata: null,
        options: [{ isCorrect: true }, { isCorrect: false }],
      },
    ])
    expect(delivery.deliverable).toBe(false)
    expect(delivery.questions).toHaveLength(0)
    expect(delivery.reason).toBe("This quiz has no published questions yet.")
  })

  it("keeps 'no questions yet' distinct from 'nothing published yet'", () => {
    expect(quizDeliveryStatus([]).reason).toBe("This quiz has no questions yet.")
  })
})

describe("TN-41 — a partly-published quiz is deliverable and serves only its published questions", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("reports the published count and serves exactly those questions", async () => {
    const { fixture, questions, studentUser } = await seedQuizWithQuestions({
      published: 3,
      drafts: 2,
    })

    // The assessment card the student sees counts the published subset.
    const payload = await listStudentAssessments(studentUser)
    const card = payload?.assessments.find((assessment) => assessment.id === fixture.assessment.id)
    expect(card?.quizQuestionCount).toBe(3)

    // The quiz list agrees, and offers a real Start.
    const quizzes = await listStudentQuizzes(studentUser)
    const quiz = quizzes.find((entry) => entry.assessmentId === fixture.assessment.id)
    expect(quiz?.questionCount).toBe(3)
    expect(quiz?.canStart).toBe(true)

    // The sitting itself contains only the published questions.
    const view = await startQuizAttempt(studentUser, { assessmentId: fixture.assessment.id })
    expect(view.questions).toHaveLength(3)
    const servedIds = new Set(view.questions.map((question) => question.id))
    for (const published of questions.slice(0, 3)) {
      expect(servedIds.has(published.id)).toBe(true)
    }
    for (const draft of questions.slice(3)) {
      expect(servedIds.has(draft.id)).toBe(false)
    }
  })

  it("stays undeliverable, and reports zero, when nothing is published", async () => {
    const { fixture, studentUser } = await seedQuizWithQuestions({ published: 0, drafts: 2 })

    const payload = await listStudentAssessments(studentUser)
    const card = payload?.assessments.find((assessment) => assessment.id === fixture.assessment.id)
    expect(card?.quizQuestionCount).toBe(0)

    await expect(
      startQuizAttempt(studentUser, { assessmentId: fixture.assessment.id }),
    ).rejects.toMatchObject({ status: 409 })
  })
})

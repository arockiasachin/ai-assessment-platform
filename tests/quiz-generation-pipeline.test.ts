import { afterAll, beforeEach, describe, expect, it } from "vitest"

import type { LlmGenerateResult, LlmProvider } from "@/lib/llm"
import { createMockProvider } from "@/lib/llm"
import type { AuthUser } from "@/lib/session"
import { indexMaterial } from "@/lib/vector"
import {
  generateQuizDraftsForTeacher,
  gradeGeneratedQuiz,
  listGeneratedQuestionsForTeacher,
  listPublishedQuizForLearner,
  publishGeneratedQuestionsForTeacher,
  updateDraftQuestionForTeacher,
} from "@/lib/quiz-generation"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * End-to-end coverage for the quiz-generation pod against the real database.
 *
 * Retrieval runs through `lib/vector` with the deterministic mock embeddings, and
 * generation is driven by a fake provider that still embeds (so one injected
 * provider serves both halves of the pipeline). The tests pin the three
 * invariants of the pod: drafts stay unpublished, only the owner can generate/
 * publish, and the answer key never reaches a learner until they submit answers.
 */

const MATERIAL_TEXT =
  "Force equals mass times acceleration, so doubling the mass halves the acceleration. " +
  "A satellite in orbit is held by gravity, which provides the centripetal force."

type OptionShape = { text: string; isCorrect: boolean; rationale: string }
type QuestionShape = {
  prompt: string
  subtopic: string
  difficulty: number
  explanation: string
  options: OptionShape[]
}

function makeQuestion(index: number): QuestionShape {
  return {
    prompt: `Question ${index}: which force holds a satellite in orbit?`,
    subtopic: `Orbital mechanics ${index}`,
    difficulty: 2,
    explanation: "Gravity provides the centripetal force.",
    options: [
      { text: "Gravity.", isCorrect: true, rationale: "Correct: gravity is centripetal." },
      {
        text: "Friction.",
        isCorrect: false,
        rationale: "Misconception: assumes friction acts in vacuum.",
      },
      {
        text: "Magnetism.",
        isCorrect: false,
        rationale: "Misconception: confuses gravity with magnetism.",
      },
      {
        text: "Air resistance.",
        isCorrect: false,
        rationale: "Misconception: assumes the satellite is in atmosphere.",
      },
    ],
  }
}

function payload(count: number): { questions: QuestionShape[] } {
  return { questions: Array.from({ length: count }, (_value, index) => makeQuestion(index + 1)) }
}

/** A fake provider that embeds via the deterministic mock but returns fixed JSON. */
function quizProvider(response: unknown): LlmProvider {
  const base = createMockProvider()
  return {
    name: "mock",
    defaultModel: "fake-quiz-llm",
    defaultEmbeddingModel: base.defaultEmbeddingModel,
    supportsEmbeddings: true,
    async generate(): Promise<LlmGenerateResult> {
      return {
        text: JSON.stringify(response),
        model: "fake-quiz-llm",
        provider: "mock",
        usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
        latencyMs: 7,
        finishReason: "stop",
        raw: {},
      }
    },
    embed: (request) => base.embed(request),
  }
}

function teacherSession(user: { id: string; email: string }): AuthUser {
  return { id: user.id, email: user.email, role: "teacher" }
}

function studentSession(user: { id: string; email: string }): AuthUser {
  return { id: user.id, email: user.email, role: "student" }
}

async function createOtherTeacher(): Promise<AuthUser> {
  const user = await prisma.user.create({
    data: {
      email: "other-teacher@quizgen.test",
      passwordHash: "test-only-not-a-real-hash",
      role: "TEACHER",
      staffProfile: { create: { fullName: "Olive Other", empId: "EMP-QUIZGEN-OTHER" } },
    },
  })
  return teacherSession(user)
}

async function seedCourseWithMaterial() {
  const f = await createSpineFixture(prisma)
  await prisma.enrollment.create({
    data: {
      studentId: f.student.studentProfile!.id,
      offeringId: f.offering.id,
      status: "active",
    },
  })
  const material = await prisma.material.create({
    data: {
      courseId: f.course.id,
      offeringId: f.offering.id,
      title: "Mechanics notes",
      contentText: MATERIAL_TEXT,
    },
  })
  await indexMaterial(material.id, { provider: createMockProvider() })
  return { f, material }
}

describe("quiz generation pipeline", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("drafts unpublished questions and discloses the key only after grading", async () => {
    const { f } = await seedCourseWithMaterial()
    const teacher = teacherSession(f.teacher)
    const student = studentSession(f.student)

    const summary = await generateQuizDraftsForTeacher(
      teacher,
      { assessmentId: f.assessment.id, topic: "forces and orbits", questionCount: 2 },
      { provider: quizProvider(payload(2)) },
    )

    expect(summary.created).toHaveLength(2)
    expect(summary.promptVersion).toBe("quiz-generation-v1")
    expect(summary.model).toBe("fake-quiz-llm")
    for (const created of summary.created) {
      expect(created.state).toBe("DRAFT")
      expect(created.options).toHaveLength(4)
      expect(created.options.filter((option) => option.isCorrect)).toHaveLength(1)
      expect(created.subtopic).toBeTruthy()
      expect(created.difficulty).toBe(2)
    }

    const list = await listGeneratedQuestionsForTeacher(teacher, f.assessment.id)
    expect(list.counts).toEqual({ draft: 2, published: 0 })

    // Drafts are invisible to a learner.
    const beforePublish = await listPublishedQuizForLearner(student, f.assessment.id)
    expect(beforePublish.questions).toHaveLength(0)

    const published = await publishGeneratedQuestionsForTeacher(teacher, {
      assessmentId: f.assessment.id,
      questionIds: summary.created.map((question) => question.id),
    })
    expect(published.published).toHaveLength(2)
    expect(published.alreadyPublished).toBe(0)

    const afterPublish = await listPublishedQuizForLearner(student, f.assessment.id)
    expect(afterPublish.questions).toHaveLength(2)
    const studentPayload = JSON.stringify(afterPublish)
    expect(studentPayload).not.toContain("isCorrect")
    expect(studentPayload).not.toContain("rationale")
    expect(studentPayload).not.toContain("explanation")

    const first = summary.created[0]
    const correctIndex = first.options.findIndex((option) => option.isCorrect)
    const graded = await gradeGeneratedQuiz(student, {
      assessmentId: f.assessment.id,
      answers: afterPublish.questions.map((question) => ({
        questionId: question.id,
        selectedIndex: correctIndex,
      })),
    })
    expect(graded.totalQuestions).toBe(2)
    expect(graded.score).toBe(f.assessment.maxMarks)
    expect(graded.results[0].correctIndex).toBe(correctIndex)
    expect(graded.results[0].correctText).toBe(first.options[correctIndex].text)
    expect(JSON.stringify(graded)).toContain("correctIndex")
  })

  it("keeps a question a draft until an explicit publish", async () => {
    const { f } = await seedCourseWithMaterial()
    const teacher = teacherSession(f.teacher)

    const summary = await generateQuizDraftsForTeacher(
      teacher,
      { assessmentId: f.assessment.id, topic: "forces", questionCount: 1 },
      { provider: quizProvider(payload(1)) },
    )
    const row = await prisma.question.findUniqueOrThrow({ where: { id: summary.created[0].id } })
    expect(JSON.stringify(row.metadata)).toContain('"DRAFT"')

    await publishGeneratedQuestionsForTeacher(teacher, {
      assessmentId: f.assessment.id,
      questionIds: [summary.created[0].id],
    })
    const publishedRow = await prisma.question.findUniqueOrThrow({
      where: { id: summary.created[0].id },
    })
    expect(JSON.stringify(publishedRow.metadata)).toContain('"PUBLISHED"')

    // Publishing again is idempotent and does not re-audit.
    const second = await publishGeneratedQuestionsForTeacher(teacher, {
      assessmentId: f.assessment.id,
      questionIds: [summary.created[0].id],
    })
    expect(second.published).toHaveLength(0)
    expect(second.alreadyPublished).toBe(1)
  })

  it("lets the owner edit a draft and freezes it once published", async () => {
    const { f } = await seedCourseWithMaterial()
    const teacher = teacherSession(f.teacher)

    const summary = await generateQuizDraftsForTeacher(
      teacher,
      { assessmentId: f.assessment.id, topic: "forces", questionCount: 1 },
      { provider: quizProvider(payload(1)) },
    )
    const questionId = summary.created[0].id

    const edited = await updateDraftQuestionForTeacher(teacher, questionId, {
      prompt: "Edited: what keeps a satellite in orbit?",
      subtopic: "Edited subtopic",
      difficulty: 5,
    })
    expect(edited.prompt).toBe("Edited: what keeps a satellite in orbit?")
    expect(edited.subtopic).toBe("Edited subtopic")
    expect(edited.difficulty).toBe(5)
    expect(edited.state).toBe("DRAFT")

    await publishGeneratedQuestionsForTeacher(teacher, {
      assessmentId: f.assessment.id,
      questionIds: [questionId],
    })
    await expect(
      updateDraftQuestionForTeacher(teacher, questionId, { prompt: "Too late." }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it("denies generation, listing, editing, and publishing to a non-owner teacher", async () => {
    const { f } = await seedCourseWithMaterial()
    const owner = teacherSession(f.teacher)
    const other = await createOtherTeacher()

    const summary = await generateQuizDraftsForTeacher(
      owner,
      { assessmentId: f.assessment.id, topic: "forces", questionCount: 1 },
      { provider: quizProvider(payload(1)) },
    )
    const questionId = summary.created[0].id

    await expect(
      generateQuizDraftsForTeacher(
        other,
        { assessmentId: f.assessment.id, topic: "forces", questionCount: 1 },
        { provider: quizProvider(payload(1)) },
      ),
    ).rejects.toMatchObject({ status: 403 })

    await expect(listGeneratedQuestionsForTeacher(other, f.assessment.id)).rejects.toMatchObject({
      status: 403,
    })
    await expect(
      updateDraftQuestionForTeacher(other, questionId, { prompt: "Hijacked." }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      publishGeneratedQuestionsForTeacher(other, {
        assessmentId: f.assessment.id,
        questionIds: [questionId],
      }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it("denies generation to a student even before any ownership check", async () => {
    const { f } = await seedCourseWithMaterial()
    const student = studentSession(f.student)

    await expect(
      generateQuizDraftsForTeacher(
        student,
        { assessmentId: f.assessment.id, topic: "forces", questionCount: 1 },
        { provider: quizProvider(payload(1)) },
      ),
    ).rejects.toMatchObject({ status: 403 })
  })

  it("refuses to generate when the course has no indexed material", async () => {
    const f = await createSpineFixture(prisma)
    const teacher = teacherSession(f.teacher)

    await expect(
      generateQuizDraftsForTeacher(
        teacher,
        { assessmentId: f.assessment.id, topic: "forces", questionCount: 1 },
        { provider: quizProvider(payload(1)) },
      ),
    ).rejects.toMatchObject({ status: 409 })
  })

  it("fails closed when publishing a malformed draft", async () => {
    const { f } = await seedCourseWithMaterial()
    const teacher = teacherSession(f.teacher)
    const summary = await generateQuizDraftsForTeacher(
      teacher,
      { assessmentId: f.assessment.id, topic: "forces", questionCount: 1 },
      { provider: quizProvider(payload(1)) },
    )

    await prisma.questionOption.delete({
      where: { questionId_order: { questionId: summary.created[0].id, order: 0 } },
    })

    await expect(
      publishGeneratedQuestionsForTeacher(teacher, {
        assessmentId: f.assessment.id,
        questionIds: [summary.created[0].id],
      }),
    ).rejects.toMatchObject({ status: 400 })

    const row = await prisma.question.findUniqueOrThrow({ where: { id: summary.created[0].id } })
    expect(JSON.stringify(row.metadata)).toContain('"DRAFT"')
  })
})

import { afterAll, beforeEach, describe, expect, it } from "vitest"

import type { LlmGenerateResult, LlmProvider } from "@/lib/llm"
import { createMockProvider } from "@/lib/llm"
import type { AuthUser } from "@/lib/session"
import {
  QUIZ_GENERATION_PROMPT_VERSION,
  editGeneratedQuestionForTeacher,
  generateQuizDraftsForTeacher,
  getGeneratedQuestionForTeacher,
  listGeneratedQuestionsForTeacher,
  listGenerationAssessmentsForTeacher,
  publishGeneratedQuestionsForTeacher,
  readGenerationMetadata,
  serializeQuestionForStudent,
} from "@/lib/quiz-generation"
import { indexMaterial } from "@/lib/vector"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * End-to-end coverage for LLM quiz generation against the real database and the
 * deterministic offline mock provider.
 *
 * The invariants under test:
 *  1. Retrieval is scoped to the teacher's own course/offering.
 *  2. Generated questions persist as UNPUBLISHED drafts; only an explicit
 *     publish action flips the state.
 *  3. A non-owner teacher (and a student) is denied everywhere.
 *  4. The answer key never appears in the student-facing serialization.
 */

const MATERIAL_TEXT =
  "Photosynthesis has two stages. The light-dependent reactions occur in the thylakoid " +
  "membrane and produce ATP and NADPH. The Calvin cycle occurs in the stroma and fixes " +
  "carbon dioxide into glucose using ATP and NADPH."

function teacherSession(user: { id: string; email: string }): AuthUser {
  return { id: user.id, email: user.email, role: "teacher" }
}

function fakeProvider(text: string): LlmProvider {
  const base = createMockProvider()
  return {
    name: "mock",
    defaultModel: "fake-llm",
    defaultEmbeddingModel: base.defaultEmbeddingModel,
    supportsEmbeddings: true,
    async generate(): Promise<LlmGenerateResult> {
      return {
        text,
        model: "fake-llm",
        provider: "mock",
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        latencyMs: 1,
        finishReason: "stop",
        raw: {},
      }
    },
    embed: (request) => base.embed(request),
  }
}

async function createOtherTeacher(): Promise<AuthUser> {
  const user = await prisma.user.create({
    data: {
      email: "other-quiz-teacher@test.local",
      passwordHash: "test-only-not-a-real-hash",
      role: "TEACHER",
      staffProfile: { create: { fullName: "Olive Other", empId: "EMP-QUIZ-OTHER" } },
    },
  })
  return teacherSession(user)
}

async function seed() {
  const fixture = await createSpineFixture(prisma)
  const provider = createMockProvider()
  const material = await prisma.material.create({
    data: {
      courseId: fixture.course.id,
      offeringId: fixture.offering.id,
      createdById: fixture.teacher.staffProfile!.id,
      title: "Photosynthesis notes",
      kind: "DOCUMENT",
      contentText: MATERIAL_TEXT,
    },
  })
  await indexMaterial(material.id, { provider })

  return {
    fixture,
    material,
    provider,
    teacherUser: teacherSession(fixture.teacher),
  }
}

describe("quiz generation pipeline", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("retrieves owned material and persists only unpublished drafts", async () => {
    const { fixture, provider, teacherUser } = await seed()

    const outcome = await generateQuizDraftsForTeacher(
      teacherUser,
      {
        assessmentId: fixture.assessment.id,
        topic: "photosynthesis light reactions",
        questionCount: 3,
        difficulty: "medium",
      },
      { provider },
    )

    expect(outcome.questions).toHaveLength(3)
    expect(outcome.retrieval.chunkCount).toBeGreaterThan(0)
    expect(outcome.retrieval.sourceTitles).toContain("Photosynthesis notes")

    for (const question of outcome.questions) {
      expect(question.status).toBe("draft")
      expect(question.options).toHaveLength(4)
      expect(question.correctOptionId).not.toBeNull()
      expect(question.subtopic).toBeTruthy()
      expect(question.difficulty).not.toBeNull()
      expect(question.difficulty ?? -1).toBeGreaterThanOrEqual(0)
      expect(question.difficulty ?? 2).toBeLessThanOrEqual(1)
      expect(question.promptVersion).toBe(QUIZ_GENERATION_PROMPT_VERSION)
    }

    const rows = await prisma.question.findMany({
      where: { assessmentId: fixture.assessment.id },
      include: { options: true },
    })
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      // State now lives on the explicit column; the metadata envelope carries
      // provenance only (the legacy JSON status is no longer written).
      expect(row.status).toBe("draft")
      expect(row.publishedAt).toBeNull()
      expect(readGenerationMetadata(row.metadata)?.generationStatus).toBeUndefined()
      expect(row.options.filter((option) => option.isCorrect)).toHaveLength(1)
    }

    const audits = await prisma.auditLog.count({
      where: { entityType: "Question", action: "quiz_question.generated" },
    })
    expect(audits).toBe(3)

    const summaries = await listGenerationAssessmentsForTeacher(teacherUser)
    const summary = summaries.find((entry) => entry.id === fixture.assessment.id)
    expect(summary?.draftCount).toBe(3)
    expect(summary?.publishedCount).toBe(0)
  })

  it("generates deterministically with the offline mock provider", async () => {
    const { fixture, provider, teacherUser } = await seed()
    const request = {
      assessmentId: fixture.assessment.id,
      topic: "photosynthesis",
      questionCount: 2,
    }

    const first = await generateQuizDraftsForTeacher(teacherUser, request, { provider })
    const second = await generateQuizDraftsForTeacher(teacherUser, request, { provider })

    expect(second.questions.map((question) => question.prompt)).toEqual(
      first.questions.map((question) => question.prompt),
    )
    expect(
      second.questions.map((question) => question.options.map((option) => option.text)),
    ).toEqual(first.questions.map((question) => question.options.map((option) => option.text)))
  })

  it("keeps drafts unpublished until an explicit teacher action, and never leaks the key", async () => {
    const { fixture, provider, teacherUser } = await seed()
    const outcome = await generateQuizDraftsForTeacher(
      teacherUser,
      { assessmentId: fixture.assessment.id, topic: "photosynthesis", questionCount: 1 },
      { provider },
    )
    const questionId = outcome.questions[0].id

    const drafts = await listGeneratedQuestionsForTeacher(teacherUser, fixture.assessment.id)
    expect(drafts).toHaveLength(1)
    expect(drafts[0].status).toBe("draft")

    const row = await prisma.question.findUniqueOrThrow({
      where: { id: questionId },
      include: { options: true },
    })
    expect(row.status).toBe("draft")
    expect(row.publishedAt).toBeNull()
    expect(row.publishedById).toBeNull()

    // The student-facing projection has no answer key and no provenance.
    const studentView = serializeQuestionForStudent(row)
    const serialized = JSON.stringify(studentView)
    expect(serialized).not.toContain("correctOptionId")
    expect(serialized).not.toContain("isCorrect")
    expect(serialized).not.toContain("promptVersion")
    expect(studentView.options.every((option) => !("isCorrect" in option))).toBe(true)

    // The owning teacher's authoring view does expose which option is correct.
    const teacherView = await getGeneratedQuestionForTeacher(teacherUser, questionId)
    expect(teacherView.correctOptionId).toBe(row.options.find((option) => option.isCorrect)?.id)

    const published = await publishGeneratedQuestionsForTeacher(teacherUser, {
      assessmentId: fixture.assessment.id,
      questionIds: [questionId],
    })
    expect(published.published).toHaveLength(1)
    expect(published.published[0].status).toBe("published")
    expect(published.alreadyPublished).toEqual([])

    const after = await prisma.question.findUniqueOrThrow({ where: { id: questionId } })
    expect(after.status).toBe("published")
    expect(after.publishedAt).not.toBeNull()
    expect(after.publishedById).toBe(fixture.teacher.staffProfile!.id)

    // Publishing again is a no-op that reports the already-published id.
    const again = await publishGeneratedQuestionsForTeacher(teacherUser, {
      assessmentId: fixture.assessment.id,
      questionIds: [questionId],
    })
    expect(again.alreadyPublished).toEqual([questionId])
    expect(again.published).toHaveLength(0)

    // A published question can no longer be edited.
    await expect(
      editGeneratedQuestionForTeacher(teacherUser, questionId, { prompt: "Changed after publish" }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it("edits a draft and rejects an option set with more than one correct answer", async () => {
    const { fixture, provider, teacherUser } = await seed()
    const outcome = await generateQuizDraftsForTeacher(
      teacherUser,
      { assessmentId: fixture.assessment.id, topic: "photosynthesis", questionCount: 1 },
      { provider },
    )
    const questionId = outcome.questions[0].id

    const edited = await editGeneratedQuestionForTeacher(teacherUser, questionId, {
      prompt: "Edited prompt about the Calvin cycle?",
      subtopic: "Calvin cycle",
      difficulty: 0.9,
      options: [
        { text: "Correct edited option", isCorrect: true, rationale: "Matches the material." },
        { text: "Misconception one", isCorrect: false, rationale: "Confuses the two stages." },
        { text: "Misconception two", isCorrect: false, rationale: "Misses the stroma location." },
        { text: "Misconception three", isCorrect: false, rationale: "Confuses ATP with glucose." },
      ],
    })

    expect(edited.prompt).toBe("Edited prompt about the Calvin cycle?")
    expect(edited.subtopic).toBe("Calvin cycle")
    expect(edited.difficulty).toBe(0.9)
    expect(edited.status).toBe("draft")

    const options = await prisma.questionOption.findMany({ where: { questionId } })
    expect(options).toHaveLength(4)
    expect(options.filter((option) => option.isCorrect)).toHaveLength(1)

    await expect(
      editGeneratedQuestionForTeacher(teacherUser, questionId, {
        options: [
          { text: "A", isCorrect: true },
          { text: "B", isCorrect: true },
          { text: "C", isCorrect: false },
          { text: "D", isCorrect: false },
        ],
      }),
    ).rejects.toThrowError(/Exactly one option/)
  })

  it("denies a non-owner teacher and a student", async () => {
    const { fixture, provider, teacherUser } = await seed()
    const outcome = await generateQuizDraftsForTeacher(
      teacherUser,
      { assessmentId: fixture.assessment.id, topic: "photosynthesis", questionCount: 1 },
      { provider },
    )
    const questionId = outcome.questions[0].id

    const otherTeacher = await createOtherTeacher()
    await expect(
      generateQuizDraftsForTeacher(
        otherTeacher,
        { assessmentId: fixture.assessment.id, topic: "photosynthesis", questionCount: 1 },
        { provider },
      ),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      listGeneratedQuestionsForTeacher(otherTeacher, fixture.assessment.id),
    ).rejects.toMatchObject({ status: 403 })
    await expect(getGeneratedQuestionForTeacher(otherTeacher, questionId)).rejects.toMatchObject({
      status: 403,
    })
    await expect(
      publishGeneratedQuestionsForTeacher(otherTeacher, {
        assessmentId: fixture.assessment.id,
        questionIds: [questionId],
      }),
    ).rejects.toMatchObject({ status: 403 })

    const studentUser: AuthUser = {
      id: fixture.student.id,
      email: fixture.student.email,
      role: "student",
    }
    await expect(
      generateQuizDraftsForTeacher(
        studentUser,
        { assessmentId: fixture.assessment.id, topic: "photosynthesis", questionCount: 1 },
        { provider },
      ),
    ).rejects.toMatchObject({ status: 403 })
  })

  it("scopes retrieval to the teacher's own course and material", async () => {
    const { fixture, material, provider, teacherUser } = await seed()

    const otherCourse = await prisma.course.create({
      data: { code: "OTHER-QUIZ-COURSE", name: "Someone else's course" },
    })
    const otherMaterial = await prisma.material.create({
      data: {
        courseId: otherCourse.id,
        title: "Other course notes",
        contentText: "Photosynthesis is a process.",
      },
    })
    await indexMaterial(otherMaterial.id, { provider })

    const outcome = await generateQuizDraftsForTeacher(
      teacherUser,
      { assessmentId: fixture.assessment.id, topic: "photosynthesis", questionCount: 1 },
      { provider },
    )

    const ownChunks = await prisma.materialChunk.findMany({
      where: { materialId: material.id },
      select: { id: true },
    })
    const ownChunkIds = new Set(ownChunks.map((chunk) => chunk.id))

    expect(outcome.retrieval.chunkIds.length).toBeGreaterThan(0)
    expect(outcome.retrieval.chunkIds.every((id) => ownChunkIds.has(id))).toBe(true)
    expect(outcome.retrieval.sourceTitles).not.toContain("Other course notes")
  })

  it("does not retrieve material belonging to a sibling offering of the same course", async () => {
    // The cross-course test above cannot catch this: `courseId` alone is not a
    // cohort boundary. A course has many offerings -- sections, terms, years --
    // so a `courseId` filter also matches material attached to *another* offering
    // of the *same* course, which is a different cohort's material (or a previous
    // year's). This is the case that separates the two tiers, and it is the shape
    // the demo seed has: the 2025 offering's revision handout shares the active
    // offering's course.
    const { fixture, material, provider, teacherUser } = await seed()

    const siblingClass = await prisma.classRoom.create({
      data: { code: "SIBLING-CLASS", name: "Sibling Class", academicYear: 2025 },
    })
    const siblingOffering = await prisma.courseOffering.create({
      data: {
        // Same course as the fixture's offering, deliberately.
        courseId: fixture.course.id,
        classId: siblingClass.id,
        teacherId: fixture.teacher.staffProfile!.id,
        term: "Term-Sibling",
        academicYear: 2025,
      },
    })
    const siblingMaterial = await prisma.material.create({
      data: {
        courseId: fixture.course.id,
        offeringId: siblingOffering.id,
        createdById: fixture.teacher.staffProfile!.id,
        title: "Last year's revision handout",
        kind: "DOCUMENT",
        contentText: "Photosynthesis in the previous cohort's handout.",
      },
    })
    await indexMaterial(siblingMaterial.id, { provider })

    const outcome = await generateQuizDraftsForTeacher(
      teacherUser,
      { assessmentId: fixture.assessment.id, topic: "photosynthesis", questionCount: 1 },
      { provider },
    )

    const ownChunks = new Set(
      (
        await prisma.materialChunk.findMany({
          where: { materialId: material.id },
          select: { id: true },
        })
      ).map((chunk) => chunk.id),
    )

    expect(outcome.retrieval.sourceTitles).not.toContain("Last year's revision handout")
    expect(outcome.retrieval.chunkIds.every((id) => ownChunks.has(id))).toBe(true)
  })

  it("does retrieve material that is genuinely course-wide", async () => {
    // The other half of the boundary: `courseWideOnly` must not exclude the
    // material tier 2 exists for. Without this, narrowing the filter to nothing
    // would pass the test above.
    const { fixture, provider, teacherUser } = await seed()

    const courseWide = await prisma.material.create({
      data: {
        // No offering: shared across the whole course by definition.
        courseId: fixture.course.id,
        offeringId: null,
        createdById: fixture.teacher.staffProfile!.id,
        title: "Shared course syllabus",
        kind: "DOCUMENT",
        contentText: "Photosynthesis is covered in the shared syllabus.",
      },
    })
    await indexMaterial(courseWide.id, { provider })

    const outcome = await generateQuizDraftsForTeacher(
      teacherUser,
      { assessmentId: fixture.assessment.id, topic: "photosynthesis", questionCount: 1 },
      { provider },
    )

    expect(outcome.retrieval.sourceTitles).toContain("Shared course syllabus")
  })

  it("refuses to generate into a non-quiz assessment and hides it from the target list (TN-40)", async () => {
    const { fixture, provider, teacherUser } = await seed()
    const groupProject = await prisma.assessment.create({
      data: {
        offeringId: fixture.offering.id,
        courseId: fixture.course.id,
        classId: fixture.classroom.id,
        title: "Group project",
        type: "GROUP_PROJECT",
        dueDate: new Date("2026-12-20T08:00:00.000Z"),
        maxMarks: 20,
        createdById: fixture.teacher.staffProfile!.id,
      },
    })

    await expect(
      generateQuizDraftsForTeacher(
        teacherUser,
        { assessmentId: groupProject.id, topic: "photosynthesis", questionCount: 1 },
        { provider },
      ),
    ).rejects.toMatchObject({ status: 409 })

    expect(await prisma.question.count({ where: { assessmentId: groupProject.id } })).toBe(0)

    const targets = await listGenerationAssessmentsForTeacher(teacherUser)
    expect(targets.map((target) => target.id)).toContain(fixture.assessment.id)
    expect(targets.map((target) => target.id)).not.toContain(groupProject.id)
  })

  it("rejects a malformed model response and writes no drafts", async () => {
    const { fixture, teacherUser } = await seed()

    await expect(
      generateQuizDraftsForTeacher(
        teacherUser,
        { assessmentId: fixture.assessment.id, topic: "photosynthesis", questionCount: 1 },
        { provider: fakeProvider("this is not JSON") },
      ),
    ).rejects.toMatchObject({ status: 502 })

    expect(await prisma.question.count({ where: { assessmentId: fixture.assessment.id } })).toBe(0)
  })
})

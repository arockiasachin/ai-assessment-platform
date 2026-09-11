import { writeAuditLog } from "@/lib/grading"
import type { LlmGenerateResult, LlmProvider } from "@/lib/llm"
import { getLlmProvider } from "@/lib/llm"
import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"
import {
  QUIZ_GENERATION_MAX_OPTIONS,
  QUIZ_GENERATION_MIN_OPTIONS,
  quizDraftUpdateRequestSchema,
  quizGenerationRequestSchema,
  quizPublishRequestSchema,
  type OwnedQuizAssessmentSummary,
  type QuizGenerationListResponse,
  type QuizGenerationQuestionResponse,
} from "@/lib/contracts"

import { loadOwnedQuizAssessment, teacherOwnsAssessment, resolveTeacherStaffId } from "./authz"
import { QuizGenerationError, QuizGenerationValidationError } from "./errors"
import { parseGeneratedQuestions } from "./parsing"
import { buildQuizGenerationPrompt, QUIZ_GENERATION_PROMPT_VERSION } from "./prompt"
import { retrieveMaterialChunks } from "./retrieval"
import { serializeQuestionForOwner, type QuestionWithOptions } from "./serialize"
import { buildDraftMetadata, readQuestionState, withPublishedMetadata } from "./state"

/**
 * Teacher-facing quiz generation: retrieve, draft, review, edit, publish.
 *
 * Drafts are persisted to `Question` / `QuestionOption` and stay `DRAFT` until
 * an explicit publish call. Nothing here ever writes `Quiz`/`QuizQuestion` (the
 * legacy import store) or exposes an answer key to a non-owner.
 */

const DEFAULT_QUESTION_COUNT = 5

export type QuizGenerationDeps = {
  /** Injected for tests; defaults to the process-wide provider from env. */
  provider?: LlmProvider
}

export type GenerationSummary = {
  assessmentId: string
  promptVersion: string
  model: string
  retrievedChunks: number
  created: QuizGenerationQuestionResponse[]
}

function questionInclude() {
  return { options: { orderBy: { order: "asc" as const } } }
}

/**
 * Every quiz assessment the teacher owns, with draft/published counts. Used by
 * the generator UI so a teacher starts from a class they actually teach.
 */
export async function listOwnedQuizAssessmentsForTeacher(
  user: AuthUser,
): Promise<OwnedQuizAssessmentSummary[]> {
  const staffId = await resolveTeacherStaffId(user)
  const assessments = await prisma.assessment.findMany({
    where: {
      type: "QUIZ",
      OR: [{ createdById: staffId }, { offering: { teacherId: staffId } }],
    },
    select: {
      id: true,
      title: true,
      maxMarks: true,
      offering: {
        select: {
          course: { select: { code: true, name: true } },
          classRoom: { select: { name: true, section: true } },
        },
      },
      questions: { select: { metadata: true } },
    },
    orderBy: { dueDate: "desc" },
    take: 200,
  })

  return assessments.map((assessment) => {
    let draftCount = 0
    let publishedCount = 0
    for (const question of assessment.questions) {
      if (readQuestionState(question.metadata) === "PUBLISHED") publishedCount += 1
      else draftCount += 1
    }
    const section = assessment.offering.classRoom.section
    return {
      id: assessment.id,
      title: assessment.title,
      courseCode: assessment.offering.course.code,
      courseName: assessment.offering.course.name,
      className: `${assessment.offering.classRoom.name}${section ? ` ${section}` : ""}`,
      maxMarks: assessment.maxMarks,
      draftCount,
      publishedCount,
    }
  })
}

async function countsForAssessment(
  assessmentId: string,
): Promise<{ draft: number; published: number }> {
  const rows = await prisma.question.findMany({
    where: { assessmentId },
    select: { metadata: true },
  })
  let draft = 0
  let published = 0
  for (const row of rows) {
    if (readQuestionState(row.metadata) === "PUBLISHED") published += 1
    else draft += 1
  }
  return { draft, published }
}

export async function generateQuizDraftsForTeacher(
  user: AuthUser,
  input: unknown,
  deps: QuizGenerationDeps = {},
): Promise<GenerationSummary> {
  const request = quizGenerationRequestSchema.parse(input)
  const assessment = await loadOwnedQuizAssessment(user, request.assessmentId)
  const questionCount = request.questionCount ?? DEFAULT_QUESTION_COUNT

  const provider = deps.provider ?? getLlmProvider()
  const chunks = await retrieveMaterialChunks(
    { courseId: assessment.courseId, offeringId: assessment.offeringId },
    request.topic,
    { provider, limit: request.materialLimit },
  )
  if (chunks.length === 0) {
    throw new QuizGenerationError(
      409,
      "No indexed course material matched this topic. Add and index material for the course first.",
    )
  }

  const messages = buildQuizGenerationPrompt({
    topic: request.topic,
    questionCount,
    chunks: chunks.map((chunk) => ({
      chunkId: chunk.chunkId,
      materialTitle: chunk.materialTitle,
      content: chunk.content,
    })),
  })

  let result: LlmGenerateResult
  try {
    result = await provider.generate({
      messages,
      task: "quiz-generation",
      promptVersion: QUIZ_GENERATION_PROMPT_VERSION,
      json: true,
      temperature: 0.4,
    })
  } catch (error) {
    throw new QuizGenerationError(
      502,
      `The model call failed: ${error instanceof Error ? error.message : "unknown error"}.`,
    )
  }

  const generated = parseGeneratedQuestions(result.text, { expectedCount: questionCount })

  const sourceChunkIds = chunks.map((chunk) => chunk.chunkId)
  const generatedAt = new Date().toISOString()
  const actor = { id: user.id, role: user.role }

  const created = await prisma.$transaction(async (tx) => {
    const aggregate = await tx.question.aggregate({
      where: { assessmentId: assessment.id },
      _max: { order: true },
    })
    let nextOrder = (aggregate._max.order ?? -1) + 1
    const rows: QuestionWithOptions[] = []

    for (const question of generated) {
      const row = await tx.question.create({
        data: {
          assessmentId: assessment.id,
          type: "MULTIPLE_CHOICE",
          order: nextOrder,
          prompt: question.prompt,
          explanation: question.explanation,
          subtopic: question.subtopic,
          difficulty: question.difficulty,
          metadata: buildDraftMetadata({
            promptVersion: QUIZ_GENERATION_PROMPT_VERSION,
            model: result.model,
            sourceChunkIds,
            generatedAt,
          }),
          options: {
            create: question.options.map((option, index) => ({
              order: index,
              text: option.text,
              isCorrect: option.isCorrect,
              rationale: option.rationale,
            })),
          },
        },
        include: questionInclude(),
      })
      nextOrder += 1
      rows.push(row)

      await writeAuditLog(tx, {
        entityType: "Question",
        entityId: row.id,
        action: "quiz_question.draft_created",
        actor,
        after: {
          assessmentId: assessment.id,
          subtopic: question.subtopic,
          difficulty: question.difficulty,
          promptVersion: QUIZ_GENERATION_PROMPT_VERSION,
          model: result.model,
          sourceChunkIds,
        },
      })
    }

    return rows
  })

  return {
    assessmentId: assessment.id,
    promptVersion: QUIZ_GENERATION_PROMPT_VERSION,
    model: result.model,
    retrievedChunks: chunks.length,
    created: created.map(serializeQuestionForOwner),
  }
}

/** Every generated question on an owned assessment, drafts and published alike. */
export async function listGeneratedQuestionsForTeacher(
  user: AuthUser,
  assessmentId: string,
): Promise<QuizGenerationListResponse> {
  const assessment = await loadOwnedQuizAssessment(user, assessmentId)
  const questions = await prisma.question.findMany({
    where: { assessmentId: assessment.id },
    include: questionInclude(),
    orderBy: { order: "asc" },
  })
  const counts = await countsForAssessment(assessment.id)
  return {
    assessmentId: assessment.id,
    counts,
    questions: questions.map(serializeQuestionForOwner),
  }
}

export async function updateDraftQuestionForTeacher(
  user: AuthUser,
  questionId: string,
  input: unknown,
): Promise<QuizGenerationQuestionResponse> {
  const patch = quizDraftUpdateRequestSchema.parse(input)
  const staffId = await resolveTeacherStaffId(user)

  const question = await prisma.question.findUnique({
    where: { id: questionId },
    select: {
      id: true,
      assessmentId: true,
      metadata: true,
      assessment: { select: { createdById: true, offering: { select: { teacherId: true } } } },
    },
  })
  if (!question) throw new QuizGenerationError(404, "Question not found.")
  if (!teacherOwnsAssessment(question.assessment, staffId)) {
    throw new QuizGenerationError(403, "Forbidden")
  }
  if (readQuestionState(question.metadata) === "PUBLISHED") {
    throw new QuizGenerationError(409, "A published question cannot be edited.")
  }

  const actor = { id: user.id, role: user.role }
  const updated = await prisma.$transaction(async (tx) => {
    await tx.question.update({
      where: { id: question.id },
      data: {
        ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
        ...(patch.subtopic !== undefined ? { subtopic: patch.subtopic } : {}),
        ...(patch.difficulty !== undefined ? { difficulty: patch.difficulty } : {}),
        ...(patch.explanation !== undefined ? { explanation: patch.explanation } : {}),
      },
    })

    if (patch.options) {
      await tx.questionOption.deleteMany({ where: { questionId: question.id } })
      await tx.questionOption.createMany({
        data: patch.options.map((option, index) => ({
          questionId: question.id,
          order: index,
          text: option.text,
          isCorrect: option.isCorrect,
          rationale: option.rationale,
        })),
      })
    }

    await writeAuditLog(tx, {
      entityType: "Question",
      entityId: question.id,
      action: "quiz_question.draft_updated",
      actor,
      after: { fields: Object.keys(patch) },
    })

    return tx.question.findUniqueOrThrow({
      where: { id: question.id },
      include: questionInclude(),
    })
  })

  return serializeQuestionForOwner(updated)
}

export type PublishSummary = {
  assessmentId: string
  published: string[]
  alreadyPublished: number
}

function validatePublishable(question: QuestionWithOptions): void {
  if (
    question.options.length < QUIZ_GENERATION_MIN_OPTIONS ||
    question.options.length > QUIZ_GENERATION_MAX_OPTIONS
  ) {
    throw new QuizGenerationValidationError(
      "Cannot publish a question unless it has between 4 and 5 options.",
    )
  }
  const correct = question.options.filter((option) => option.isCorrect).length
  if (correct !== 1) {
    throw new QuizGenerationValidationError(
      "Cannot publish a question unless exactly one option is correct.",
    )
  }
}

/** Publish specific drafted questions on an owned assessment. */
export async function publishGeneratedQuestionsForTeacher(
  user: AuthUser,
  input: unknown,
): Promise<PublishSummary> {
  const request = quizPublishRequestSchema.parse(input)
  const assessment = await loadOwnedQuizAssessment(user, request.assessmentId)

  const uniqueIds = [...new Set(request.questionIds)]
  const questions = await prisma.question.findMany({
    where: { id: { in: uniqueIds }, assessmentId: assessment.id },
    include: questionInclude(),
  })
  if (questions.length !== uniqueIds.length) {
    throw new QuizGenerationError(404, "One or more questions were not found on this assessment.")
  }
  for (const question of questions) validatePublishable(question)

  const actor = { id: user.id, role: user.role }
  const publishedAt = new Date().toISOString()
  const published: string[] = []
  let alreadyPublished = 0

  await prisma.$transaction(async (tx) => {
    for (const question of questions) {
      if (readQuestionState(question.metadata) === "PUBLISHED") {
        alreadyPublished += 1
        continue
      }
      await tx.question.update({
        where: { id: question.id },
        data: { metadata: withPublishedMetadata(question.metadata, publishedAt) },
      })
      published.push(question.id)
      await writeAuditLog(tx, {
        entityType: "Question",
        entityId: question.id,
        action: "quiz_question.published",
        actor,
        after: { assessmentId: assessment.id, publishedAt },
      })
    }
  })

  return { assessmentId: assessment.id, published, alreadyPublished }
}

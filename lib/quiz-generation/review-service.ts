import {
  generatedQuestionEditRequestSchema,
  publishQuestionsRequestSchema,
  type GeneratedQuestionResponse,
  type GenerationAssessmentSummary,
} from "@/lib/contracts/quiz-generation"
import { writeAuditLog } from "@/lib/grading/audit"
import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"

import { loadOwnedAssessment, resolveTeacherStaffId, teacherOwnsAssessment } from "./authz"
import { QuizGenerationError } from "./errors"
import { readGenerationMetadata, toQuestionMetadata } from "./metadata"
import { serializeQuestionForTeacher } from "./serialize"

/**
 * Teacher-scoped read and lifecycle operations for generated questions.
 *
 * Object-level authorization is enforced on every entry point: the teacher must
 * own the assessment (creator or offering teacher) before a generated question
 * is read, edited, or published. `Question.metadata` carries the draft/published
 * state because the schema is frozen and `Question` has no publish column.
 */

const questionInclude = { options: { orderBy: { order: "asc" as const } } } as const

/** The teacher's own assessments with counts of generated drafts/published questions. */
export async function listGenerationAssessmentsForTeacher(
  user: AuthUser,
): Promise<GenerationAssessmentSummary[]> {
  const staffId = await resolveTeacherStaffId(user)
  const assessments = await prisma.assessment.findMany({
    where: { OR: [{ createdById: staffId }, { offering: { teacherId: staffId } }] },
    select: {
      id: true,
      title: true,
      type: true,
      maxMarks: true,
      dueDate: true,
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
      const metadata = readGenerationMetadata(question.metadata)
      if (!metadata) continue
      if (metadata.generationStatus === "published") publishedCount += 1
      else draftCount += 1
    }
    const section = assessment.offering.classRoom.section
    return {
      id: assessment.id,
      title: assessment.title,
      type: assessment.type,
      maxMarks: assessment.maxMarks,
      dueDate: assessment.dueDate.toISOString(),
      courseCode: assessment.offering.course.code,
      courseName: assessment.offering.course.name,
      className: `${assessment.offering.classRoom.name}${section ? ` ${section}` : ""}`,
      generatedQuestionCount: draftCount + publishedCount,
      draftCount,
      publishedCount,
    }
  })
}

async function loadGeneratedQuestion(user: AuthUser, questionId: string) {
  const staffId = await resolveTeacherStaffId(user)
  const question = await prisma.question.findUnique({
    where: { id: questionId },
    include: {
      ...questionInclude,
      assessment: {
        select: { id: true, createdById: true, offering: { select: { teacherId: true } } },
      },
    },
  })
  if (!question) throw new QuizGenerationError(404, "Question not found.")
  if (!teacherOwnsAssessment(question.assessment, staffId)) {
    throw new QuizGenerationError(403, "Forbidden")
  }
  if (!readGenerationMetadata(question.metadata)) {
    throw new QuizGenerationError(404, "Question not found.")
  }
  return question
}

/** Generated questions (drafts and published) for one owned assessment. */
export async function listGeneratedQuestionsForTeacher(
  user: AuthUser,
  assessmentId: string,
): Promise<GeneratedQuestionResponse[]> {
  await loadOwnedAssessment(user, assessmentId)
  const questions = await prisma.question.findMany({
    where: { assessmentId },
    include: questionInclude,
    orderBy: { order: "asc" },
  })
  return questions
    .filter((question) => readGenerationMetadata(question.metadata) !== null)
    .map(serializeQuestionForTeacher)
}

/** One owned generated question for review. */
export async function getGeneratedQuestionForTeacher(
  user: AuthUser,
  questionId: string,
): Promise<GeneratedQuestionResponse> {
  const question = await loadGeneratedQuestion(user, questionId)
  return serializeQuestionForTeacher(question)
}

/** Edit a draft. Published questions are immutable. */
export async function editGeneratedQuestionForTeacher(
  user: AuthUser,
  questionId: string,
  input: unknown,
): Promise<GeneratedQuestionResponse> {
  const request = generatedQuestionEditRequestSchema.parse(input)
  const question = await loadGeneratedQuestion(user, questionId)
  const metadata = readGenerationMetadata(question.metadata)
  if (!metadata) throw new QuizGenerationError(404, "Question not found.")
  if (metadata.generationStatus === "published") {
    throw new QuizGenerationError(409, "Published questions cannot be edited.")
  }

  const editedFields = Object.entries(request)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key)

  await prisma.$transaction(async (tx) => {
    if (request.options) {
      await tx.questionOption.deleteMany({ where: { questionId } })
      await tx.questionOption.createMany({
        data: request.options.map((option, index) => ({
          questionId,
          order: index,
          text: option.text,
          isCorrect: option.isCorrect,
          rationale: option.rationale ?? null,
        })),
      })
    }

    await tx.question.update({
      where: { id: questionId },
      data: {
        ...(request.prompt !== undefined ? { prompt: request.prompt } : {}),
        ...(request.explanation !== undefined ? { explanation: request.explanation } : {}),
        ...(request.subtopic !== undefined ? { subtopic: request.subtopic } : {}),
        ...(request.difficulty !== undefined ? { difficulty: request.difficulty } : {}),
        ...(request.points !== undefined ? { points: request.points } : {}),
      },
    })

    await writeAuditLog(tx, {
      entityType: "Question",
      entityId: questionId,
      action: "quiz_question.edited",
      actor: { id: user.id, role: user.role },
      after: {
        editedFields,
        optionCount: request.options?.length ?? question.options.length,
        status: "draft",
      },
    })
  })

  const updated = await prisma.question.findUniqueOrThrow({
    where: { id: questionId },
    include: questionInclude,
  })
  return serializeQuestionForTeacher(updated)
}

export type PublishOutcome = {
  published: GeneratedQuestionResponse[]
  alreadyPublished: string[]
}

/**
 * Publish drafts with an explicit teacher action. Every question is re-checked
 * for exactly one correct option server-side before its state flips, so an
 * ungradable draft can never be delivered.
 */
export async function publishGeneratedQuestionsForTeacher(
  user: AuthUser,
  input: unknown,
): Promise<PublishOutcome> {
  const request = publishQuestionsRequestSchema.parse(input)
  const owned = await loadOwnedAssessment(user, request.assessmentId)

  const questions = await prisma.question.findMany({
    where: {
      assessmentId: request.assessmentId,
      ...(request.questionIds ? { id: { in: request.questionIds } } : {}),
    },
    include: questionInclude,
    orderBy: { order: "asc" },
  })

  if (request.questionIds) {
    const found = new Set(questions.map((question) => question.id))
    const missing = request.questionIds.find((id) => !found.has(id))
    if (missing) throw new QuizGenerationError(404, `Question ${missing} not found.`)
  }

  const generated = questions.filter((question) => readGenerationMetadata(question.metadata))
  if (generated.length === 0) {
    throw new QuizGenerationError(409, "No generated questions to publish.")
  }

  const alreadyPublished = generated
    .filter(
      (question) => readGenerationMetadata(question.metadata)?.generationStatus === "published",
    )
    .map((question) => question.id)
  const drafts = generated.filter(
    (question) => readGenerationMetadata(question.metadata)?.generationStatus === "draft",
  )

  for (const draft of drafts) {
    const correctCount = draft.options.filter((option) => option.isCorrect).length
    if (correctCount !== 1) {
      throw new QuizGenerationError(
        409,
        `Question ${draft.id} must have exactly one correct option before publishing.`,
      )
    }
  }

  const publishedAt = new Date().toISOString()
  const publishedIds: string[] = []

  await prisma.$transaction(async (tx) => {
    for (const draft of drafts) {
      const metadata = readGenerationMetadata(draft.metadata)
      if (!metadata) continue
      await tx.question.update({
        where: { id: draft.id },
        data: {
          metadata: toQuestionMetadata({
            ...metadata,
            generationStatus: "published",
            publishedAt,
            publishedByStaffId: owned.staffId,
          }),
        },
      })
      await writeAuditLog(tx, {
        entityType: "Question",
        entityId: draft.id,
        action: "quiz_question.published",
        actor: { id: user.id, role: user.role },
        after: {
          assessmentId: request.assessmentId,
          publishedByStaffId: owned.staffId,
          publishedAt,
        },
      })
      publishedIds.push(draft.id)
    }
  })

  const refreshed = await prisma.question.findMany({
    where: { id: { in: publishedIds } },
    include: questionInclude,
    orderBy: { order: "asc" },
  })

  return {
    published: refreshed.map(serializeQuestionForTeacher),
    alreadyPublished,
  }
}

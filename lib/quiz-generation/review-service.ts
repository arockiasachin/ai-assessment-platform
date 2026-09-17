import {
  generatedQuestionEditRequestSchema,
  publishQuestionsRequestSchema,
  type GeneratedQuestionResponse,
  type GenerationAssessmentSummary,
} from "@/lib/contracts/quiz-generation"
import { writeAuditLog } from "@/lib/grading/audit"
import { partialUpdate } from "@/lib/partial-update"
import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"

import { loadOwnedAssessment, resolveTeacherStaffId, teacherOwnsAssessment } from "./authz"
import { QuizGenerationError } from "./errors"
import { isGeneratedQuestion, resolveGenerationStatus } from "./metadata"
import { serializeQuestionForTeacher } from "./serialize"

/**
 * Teacher-scoped read and lifecycle operations for generated questions.
 *
 * Object-level authorization is enforced on every entry point: the teacher must
 * own the assessment (creator or offering teacher) before a generated question
 * is read, edited, or published. Draft/published state lives on the explicit
 * `Question.status` / `publishedAt` / `publishedById` columns; the resolver
 * still falls back to the legacy `metadata` envelope for older rows.
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
      questions: { select: { status: true, publishedAt: true, metadata: true } },
    },
    orderBy: { dueDate: "desc" },
    take: 200,
  })

  return assessments.map((assessment) => {
    let draftCount = 0
    let publishedCount = 0
    for (const question of assessment.questions) {
      const status = resolveGenerationStatus(question)
      if (!status) continue
      if (status === "published") publishedCount += 1
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
  if (!isGeneratedQuestion(question)) {
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
    .filter((question) => isGeneratedQuestion(question))
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
  if (resolveGenerationStatus(question) === "published") {
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
      data: partialUpdate(request, {
        prompt: true,
        explanation: true,
        subtopic: true,
        difficulty: true,
        points: true,
      }),
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

/**
 * Delete a **draft** generated question (TN-42).
 *
 * Published questions stay immutable — that rule is deliberate, and reversing it would let a
 * question's prompt or weight change under attempts that were scored against the old version
 * (each attempt stores its own `maxScore`, so the divergence would be silent rather than
 * corrected). A draft has never been delivered and has no responses, so removing one is the
 * write path the audit found missing: a bad generation can be discarded instead of becoming
 * permanent. A published question is refused with the reason, not silently ignored.
 */
export async function deleteGeneratedQuestionForTeacher(
  user: AuthUser,
  questionId: string,
): Promise<void> {
  const question = await loadGeneratedQuestion(user, questionId)
  if (resolveGenerationStatus(question) === "published") {
    throw new QuizGenerationError(
      409,
      "Published questions cannot be deleted. A question students have answered is part of the record.",
    )
  }

  await prisma.$transaction(async (tx) => {
    await tx.question.delete({ where: { id: questionId } })
    await writeAuditLog(tx, {
      entityType: "Question",
      entityId: questionId,
      action: "quiz_question.deleted",
      actor: { id: user.id, role: user.role },
      before: {
        assessmentId: question.assessmentId,
        order: question.order,
        status: "draft",
      },
    })
  })
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

  const generated = questions.filter((question) => isGeneratedQuestion(question))
  if (generated.length === 0) {
    throw new QuizGenerationError(409, "No generated questions to publish.")
  }

  const alreadyPublished = generated
    .filter((question) => resolveGenerationStatus(question) === "published")
    .map((question) => question.id)
  const drafts = generated.filter((question) => resolveGenerationStatus(question) !== "published")

  for (const draft of drafts) {
    const correctCount = draft.options.filter((option) => option.isCorrect).length
    if (correctCount !== 1) {
      throw new QuizGenerationError(
        409,
        `Question ${draft.id} must have exactly one correct option before publishing.`,
      )
    }
  }

  const publishedAt = new Date()
  const publishedIds: string[] = []

  await prisma.$transaction(async (tx) => {
    for (const draft of drafts) {
      await tx.question.update({
        where: { id: draft.id },
        data: {
          status: "published",
          publishedAt,
          publishedById: owned.staffId,
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
          publishedAt: publishedAt.toISOString(),
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

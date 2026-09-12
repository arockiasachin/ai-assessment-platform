import { randomUUID } from "node:crypto"

import {
  quizGenerationRequestSchema,
  type GeneratedQuestionResponse,
  type QuizGenerationRetrievalSummary,
} from "@/lib/contracts/quiz-generation"
import { writeAuditLog } from "@/lib/grading/audit"
import type { LlmEmbeddingProvider, LlmGenerateResult, LlmProvider } from "@/lib/llm"
import { getEmbeddingsProvider, getLlmProvider } from "@/lib/llm"
import { prisma } from "@/lib/prisma"
import type { AuthUser } from "@/lib/session"

import { loadOwnedAssessment } from "./authz"
import { QuizGenerationError } from "./errors"
import { toQuestionMetadata, type GeneratedQuestionProvenance } from "./metadata"
import { parseGeneratedQuestions } from "./parsing"
import { QUIZ_GENERATION_PROMPT_VERSION, buildQuizGenerationPrompt } from "./prompt"
import { retrieveTopicMaterial } from "./retrieval"
import { serializeQuestionForTeacher } from "./serialize"

/**
 * End-to-end LLM quiz generation.
 *
 *  1. Resolve the owned assessment (object-level authorization) and derive the
 *     course/offering retrieval scope from the database, never the request.
 *  2. Retrieve the most relevant `MaterialChunk`s through `lib/vector/**`.
 *  3. Ask the provider (task `quiz-generation`, versioned prompt) for questions.
 *  4. Validate the response strictly and persist it as UNPUBLISHED drafts.
 *
 * Nothing here publishes. A question leaves draft state only through the
 * explicit publish action in `review-service.ts`.
 */

export type GenerationDeps = {
  /**
   * Injected generation/grading provider (tests). Defaults to the
   * process-wide `LLM_PROVIDER` singleton.
   */
  provider?: LlmProvider
  /**
   * Injected embeddings provider (tests). Defaults to the process-wide
   * `EMBEDDINGS_PROVIDER` singleton, so retrieval no longer depends on the chat
   * provider. A full injected `provider` is reused for retrieval only when it
   * supports embeddings, preserving existing single-provider test setups.
   */
  embeddingProvider?: LlmEmbeddingProvider
}

export type GenerationOutcome = {
  retrieval: QuizGenerationRetrievalSummary
  questions: GeneratedQuestionResponse[]
}

type PersistDraftInput = {
  parsed: ReturnType<typeof parseGeneratedQuestions>
  assessmentId: string
  staffId: string
  userId: string
  userRole: string
  generationId: string
  topic: string
  model: string
  provider: string
  sourceChunkIds: string[]
}

async function persistDrafts(input: PersistDraftInput): Promise<string[]> {
  return prisma.$transaction(async (tx) => {
    const aggregate = await tx.question.aggregate({
      where: { assessmentId: input.assessmentId },
      _max: { order: true },
    })
    let nextOrder = (aggregate._max.order ?? -1) + 1

    const createdIds: string[] = []
    for (const question of input.parsed) {
      const provenance: GeneratedQuestionProvenance = {
        generator: "quiz-generation",
        promptVersion: QUIZ_GENERATION_PROMPT_VERSION,
        model: input.model,
        provider: input.provider,
        generationId: input.generationId,
        topic: input.topic,
        sourceChunkIds: input.sourceChunkIds,
        createdByStaffId: input.staffId,
      }

      const created = await tx.question.create({
        data: {
          assessmentId: input.assessmentId,
          type: "MULTIPLE_CHOICE",
          order: nextOrder,
          prompt: question.prompt,
          explanation: question.explanation,
          subtopic: question.subtopic,
          difficulty: question.difficulty,
          points: 1,
          status: "draft",
          metadata: toQuestionMetadata(provenance),
        },
        select: { id: true, order: true },
      })
      nextOrder += 1

      await tx.questionOption.createMany({
        data: question.options.map((option, index) => ({
          questionId: created.id,
          order: index,
          text: option.text,
          isCorrect: option.isCorrect,
          rationale: option.rationale,
        })),
      })

      await writeAuditLog(tx, {
        entityType: "Question",
        entityId: created.id,
        action: "quiz_question.generated",
        actor: { id: input.userId, role: input.userRole },
        after: {
          assessmentId: input.assessmentId,
          order: created.order,
          promptVersion: QUIZ_GENERATION_PROMPT_VERSION,
          model: input.model,
          provider: input.provider,
          generationId: input.generationId,
          optionCount: question.options.length,
          status: "draft",
        },
      })

      createdIds.push(created.id)
    }

    return createdIds
  })
}

export async function generateQuizDraftsForTeacher(
  user: AuthUser,
  input: unknown,
  deps: GenerationDeps = {},
): Promise<GenerationOutcome> {
  const request = quizGenerationRequestSchema.parse(input)
  const owned = await loadOwnedAssessment(user, request.assessmentId)
  const provider = deps.provider ?? getLlmProvider()
  const embeddingProvider =
    deps.embeddingProvider ??
    (deps.provider?.supportsEmbeddings ? deps.provider : undefined) ??
    getEmbeddingsProvider()

  const retrieval = await retrieveTopicMaterial(
    { courseId: owned.courseId, offeringId: owned.offeringId },
    request.topic,
    { provider: embeddingProvider, limit: request.retrievalLimit },
  )

  const messages = buildQuizGenerationPrompt({
    topic: request.topic,
    questionCount: request.questionCount,
    difficulty: request.difficulty,
    subtopics: request.subtopics ?? [],
    sources: retrieval.hits.map((hit) => ({
      chunkId: hit.chunkId,
      materialTitle: hit.materialTitle,
      content: hit.content,
    })),
  })

  let result: LlmGenerateResult
  try {
    result = await provider.generate({
      messages,
      task: "quiz-generation",
      promptVersion: QUIZ_GENERATION_PROMPT_VERSION,
      json: true,
      temperature: 0,
    })
  } catch (error) {
    throw new QuizGenerationError(
      502,
      `Model call failed: ${error instanceof Error ? error.message : "unknown error"}.`,
    )
  }

  const parsed = parseGeneratedQuestions(result.text, {
    expectedCount: request.questionCount,
  })
  const generationId = randomUUID()

  const createdIds = await persistDrafts({
    parsed,
    assessmentId: owned.id,
    staffId: owned.staffId,
    userId: user.id,
    userRole: user.role,
    generationId,
    topic: request.topic,
    model: result.model,
    provider: result.provider,
    sourceChunkIds: retrieval.hits.map((hit) => hit.chunkId),
  })

  const questions = await prisma.question.findMany({
    where: { id: { in: createdIds } },
    include: { options: true },
    orderBy: { order: "asc" },
  })

  return {
    retrieval: {
      chunkCount: retrieval.hits.length,
      sourceTitles: retrieval.sourceTitles,
      chunkIds: retrieval.hits.map((hit) => hit.chunkId),
    },
    questions: questions.map(serializeQuestionForTeacher),
  }
}

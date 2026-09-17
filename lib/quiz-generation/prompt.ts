import type { LlmMessage } from "@/lib/llm"
import type { QuizGenerationDifficultyTarget } from "@/lib/contracts/quiz-generation"

import { GENERATED_OPTION_MAX, GENERATED_OPTION_MIN } from "@/lib/contracts/quiz-generation"

/**
 * The versioned quiz-generation prompt.
 *
 * Bump `QUIZ_GENERATION_PROMPT_VERSION` whenever this template changes; the
 * version is persisted in each draft's `Question.metadata` (and on the audit
 * row) so a later reviewer can trace a question back to the prompt that wrote
 * it — the same explainability rule the grading pipeline follows.
 *
 * The distractor instruction is load-bearing: the product spec requires
 * distractors that target plausible misconceptions rather than throwaway
 * options, so the prompt states it explicitly and asks for a per-distractor
 * rationale naming the misconception it captures.
 */
export const QUIZ_GENERATION_PROMPT_VERSION = "quiz-generation-v1"

export type QuizPromptSource = {
  chunkId: string
  materialTitle: string
  content: string
}

export type QuizPromptInput = {
  topic: string
  questionCount: number
  difficulty: QuizGenerationDifficultyTarget
  /** Optional teacher-supplied subtopic tags the questions should cover. */
  subtopics: readonly string[]
  /**
   * The course's declared subtopic vocabulary, when it has one.
   *
   * Distinct from `subtopics` on purpose. Supplying tags is a **hint** for this request; declaring a
   * vocabulary is a **constraint** that makes the tags reusable, and the difference decides whether the
   * model may invent a tag it finds more apt.
   */
  vocabulary?: readonly string[]
  /** Retrieved `MaterialChunk`s used as grounding context (may be empty). */
  sources: readonly QuizPromptSource[]
}

const DIFFICULTY_GUIDANCE: Record<QuizGenerationDifficultyTarget, string> = {
  easy: "recall and basic comprehension; difficulty values around 0.2-0.4",
  medium: "application and analysis; difficulty values around 0.45-0.65",
  hard: "synthesis and evaluation; difficulty values around 0.7-0.95",
  mixed: "a deliberate spread across recall, application, and analysis",
}

function renderSources(sources: readonly QuizPromptSource[]): string {
  if (sources.length === 0) {
    return "No indexed course material was found for this topic. Generate from the topic description only, and keep every claim general enough to be defensible."
  }
  return sources
    .map(
      (source, index) =>
        `[${index + 1}] "${source.materialTitle}" (chunk ${source.chunkId}):\n${source.content}`,
    )
    .join("\n\n")
}

/**
 * Build the system + user messages for one generation request. Pure and
 * deterministic so it can be unit tested and versioned.
 */
export function buildQuizGenerationPrompt(input: QuizPromptInput): LlmMessage[] {
  const vocabulary = input.vocabulary ?? []
  const subtopics =
    vocabulary.length > 0
      ? // A declared vocabulary is a closed list: the whole point is that the tags are reusable across
        // generations, which only holds if every question uses one of them verbatim.
        "Choose every `subtopic` from this list, using each tag **exactly as written** and nothing " +
        "else. Do not invent, rephrase, or introduce a tag that is not here:\n" +
        vocabulary.map((tag) => `- ${tag}`).join("\n")
      : input.subtopics.length > 0
        ? input.subtopics.map((subtopic) => `- ${subtopic}`).join("\n")
        : // Undeclared: unchanged, and the prompt says so rather than pretending a list exists.
          "The teacher did not specify subtopics; choose 2-4 coherent subtopics yourself."

  const system =
    "You are an experienced university examiner writing a multiple-choice quiz grounded ONLY in the " +
    "course material provided. Respond with a single JSON object and nothing else, using this shape:\n" +
    '{"questions":[{"prompt":string,"options":[{"text":string,"isCorrect":boolean,"rationale":string}],' +
    '"explanation":string,"subtopic":string,"difficulty":number}]}\n' +
    `Each question must have between ${GENERATED_OPTION_MIN} and ${GENERATED_OPTION_MAX} options with ` +
    "exactly ONE option where isCorrect is true. Distractors must target plausible misconceptions: " +
    "each incorrect option should be the answer a student with a specific, common misunderstanding " +
    "would choose, and its rationale must name that misunderstanding. Never use filler, joke, " +
    '"all of the above", or obviously wrong options. `difficulty` is a number in [0, 1]. ' +
    "`subtopic` is a short, reusable tag. `explanation` justifies the correct answer in one or two " +
    "sentences and must not appear in any option text. Do not invent facts that the provided material " +
    "does not support; if the material is thin, keep the questions conceptual."

  const user = [
    `Number of questions to generate: ${input.questionCount}`,
    `Topic: ${input.topic}`,
    `Difficulty target: ${input.difficulty} (${DIFFICULTY_GUIDANCE[input.difficulty]})`,
    `Subtopic tags to use:\n${subtopics}`,
    `Course material (ground every question in this content):\n\n${renderSources(input.sources)}`,
  ].join("\n\n")

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

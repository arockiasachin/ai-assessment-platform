import type { LlmMessage } from "@/lib/llm"

import {
  QUIZ_GENERATION_MAX_DIFFICULTY,
  QUIZ_GENERATION_MAX_OPTIONS,
  QUIZ_GENERATION_MIN_DIFFICULTY,
  QUIZ_GENERATION_MIN_OPTIONS,
} from "@/lib/contracts"

/**
 * The quiz-generation prompt.
 *
 * Bump `QUIZ_GENERATION_PROMPT_VERSION` whenever the template below changes; the
 * version is stored on every drafted question so a question can always be traced
 * back to the exact prompt revision that produced it.
 */
export const QUIZ_GENERATION_PROMPT_VERSION = "quiz-generation-v1"

/** The retrieval excerpt shape the prompt needs (kept narrow for testability). */
export type QuizPromptChunk = {
  chunkId: string
  materialTitle: string
  content: string
}

export type BuildQuizPromptInput = {
  topic: string
  questionCount: number
  chunks: readonly QuizPromptChunk[]
}

export function buildQuizGenerationPrompt(input: BuildQuizPromptInput): LlmMessage[] {
  const sourceExcerpts = input.chunks
    .map(
      (chunk, index) =>
        `[${index + 1}] (chunk ${chunk.chunkId} — ${chunk.materialTitle})\n${chunk.content}`,
    )
    .join("\n\n")

  const optionRange = `${QUIZ_GENERATION_MIN_OPTIONS}-${QUIZ_GENERATION_MAX_OPTIONS}`

  const system = [
    "You write multiple-choice quiz questions for a university course.",
    `Produce exactly ${input.questionCount} questions grounded ONLY in the provided course material.`,
    "Reply with a single JSON object and nothing else, using this shape:",
    '{"questions":[{"prompt": string, "subtopic": string, "difficulty": number, ' +
      '"explanation": string, "options":[{"text": string, "isCorrect": boolean, "rationale": string}]}]}',
    `Every question must have ${optionRange} options with exactly ONE option whose "isCorrect" is true.`,
    `"difficulty" is a number on a ${QUIZ_GENERATION_MIN_DIFFICULTY} (easiest) to ` +
      `${QUIZ_GENERATION_MAX_DIFFICULTY} (hardest) scale.`,
    '"subtopic" is a short tag naming the specific sub-skill the question tests.',
    '"explanation" states why the correct option is correct.',
    "The incorrect options (distractors) MUST each target a plausible misconception a student " +
      "actually holds — a common slip, a tempting near-miss, or a confusion with a related " +
      'concept. Never use throwaway or obviously wrong options. Give every option a "rationale" ' +
      "that names the misconception it addresses (or, for the correct option, why it is right).",
    "Do not repeat a question prompt or reuse an option's wording within a question.",
    "Do not rely on facts that are absent from the provided material.",
  ].join(" ")

  const user = [
    `Topic / lesson description:\n"""\n${input.topic}\n"""`,
    `Course material excerpts:\n"""\n${sourceExcerpts}\n"""`,
    `Write ${input.questionCount} questions as the JSON object described above.`,
  ].join("\n\n")

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

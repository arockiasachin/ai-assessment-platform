import { z } from "zod"

import {
  QUIZ_GENERATION_MAX_DIFFICULTY,
  QUIZ_GENERATION_MAX_OPTIONS,
  QUIZ_GENERATION_MIN_DIFFICULTY,
  QUIZ_GENERATION_MIN_OPTIONS,
} from "@/lib/contracts"

import { QuizGenerationParseError } from "./errors"

/**
 * Strict parsing and validation of the model's question output.
 *
 * The contract is deliberately fail-closed: an unparseable response, the wrong
 * number of questions, an option count outside 4-5, zero or multiple correct
 * options, or duplicated prompts/options all raise `QuizGenerationParseError`
 * (HTTP 502). We never persist a half-valid draft or invent an answer key.
 */

const modelOptionSchema = z.object({
  text: z.string().trim().min(1).max(1000),
  isCorrect: z.boolean(),
  rationale: z.string().trim().min(1).max(1000),
})

const modelQuestionSchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
  subtopic: z.string().trim().min(1).max(200),
  difficulty: z
    .number()
    .finite()
    .min(QUIZ_GENERATION_MIN_DIFFICULTY)
    .max(QUIZ_GENERATION_MAX_DIFFICULTY),
  explanation: z.string().trim().min(1).max(2000),
  // Count is validated below so the error can name the offending question.
  options: z.array(modelOptionSchema).min(1).max(10),
})

const modelQuizSchema = z.object({
  questions: z.array(modelQuestionSchema).min(1).max(50),
})

export type GeneratedOption = z.infer<typeof modelOptionSchema>
export type GeneratedQuestion = z.infer<typeof modelQuestionSchema>

export type ParseGeneratedQuestionsOptions = {
  /** The exact number of questions the caller asked for. */
  expectedCount: number
}

function stripFence(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return fenced?.[1]?.trim() ?? raw.trim()
}

/** Best-effort JSON extraction: the whole response, a fenced block, or the outermost object. */
export function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim()
  if (!trimmed) throw new QuizGenerationParseError("The model returned an empty response.")

  const candidates: string[] = []
  const unfenced = stripFence(trimmed)
  candidates.push(unfenced)
  const first = unfenced.indexOf("{")
  const last = unfenced.lastIndexOf("}")
  if (first >= 0 && last > first) candidates.push(unfenced.slice(first, last + 1))

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      // Try the next candidate.
    }
  }

  throw new QuizGenerationParseError("The model response did not contain a JSON object.")
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase()
}

export function parseGeneratedQuestions(
  rawText: string,
  options: ParseGeneratedQuestionsOptions,
): GeneratedQuestion[] {
  const json = extractJsonObject(rawText)
  const parsed = modelQuizSchema.safeParse(json)
  if (!parsed.success) {
    throw new QuizGenerationParseError(
      "The model response must be a JSON object with a questions array; every question needs a " +
        `prompt, subtopic, difficulty on the ${QUIZ_GENERATION_MIN_DIFFICULTY}-${QUIZ_GENERATION_MAX_DIFFICULTY} ` +
        "scale, an explanation, and options with text, isCorrect, and rationale.",
    )
  }

  const questions = parsed.data.questions
  if (questions.length !== options.expectedCount) {
    throw new QuizGenerationParseError(
      `Expected ${options.expectedCount} questions but the model returned ${questions.length}.`,
    )
  }

  const seenPrompts = new Set<string>()
  return questions.map((question, index) => {
    const position = index + 1

    if (
      question.options.length < QUIZ_GENERATION_MIN_OPTIONS ||
      question.options.length > QUIZ_GENERATION_MAX_OPTIONS
    ) {
      throw new QuizGenerationParseError(
        `Question ${position} must have between ${QUIZ_GENERATION_MIN_OPTIONS} and ` +
          `${QUIZ_GENERATION_MAX_OPTIONS} options (got ${question.options.length}).`,
      )
    }

    const correctCount = question.options.filter((option) => option.isCorrect).length
    if (correctCount !== 1) {
      throw new QuizGenerationParseError(
        `Question ${position} must mark exactly one correct option (found ${correctCount}).`,
      )
    }

    const optionTexts = question.options.map((option) => normalize(option.text))
    if (new Set(optionTexts).size !== optionTexts.length) {
      throw new QuizGenerationParseError(`Question ${position} repeats an option's wording.`)
    }

    const promptKey = normalize(question.prompt)
    if (seenPrompts.has(promptKey)) {
      throw new QuizGenerationParseError(`Question ${position} duplicates an earlier prompt.`)
    }
    seenPrompts.add(promptKey)

    return question
  })
}

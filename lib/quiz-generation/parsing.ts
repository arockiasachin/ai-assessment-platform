import { z } from "zod"

import { firstIssueMessage } from "@/lib/contracts/common"

import { QuizGenerationParseError } from "./errors"

/**
 * Validation of the raw model output.
 *
 * The contract is strict on purpose: a generated question must have a prompt,
 * 4-5 distinct options with exactly one correct answer, a subtopic tag, and a
 * difficulty in [0, 1]. Anything else is a loud 502, never a silently invented
 * draft. The parser also strips a fenced code block and tolerates a bare JSON
 * array, because both are common model habits.
 */

export type ParsedGeneratedOption = {
  text: string
  isCorrect: boolean
  rationale: string | null
}

export type ParsedGeneratedQuestion = {
  prompt: string
  options: ParsedGeneratedOption[]
  explanation: string | null
  subtopic: string
  difficulty: number
}

const OPTION_COUNT_MESSAGE = "Each question needs 4 or 5 options."

const modelOptionSchema = z.object({
  text: z.string().trim().min(1, "Every option needs text."),
  isCorrect: z.boolean(),
  rationale: z.string().trim().max(2000).optional(),
})

const modelQuestionSchema = z
  .object({
    prompt: z.string().trim().min(1, "Every question needs a prompt.").max(5000),
    options: z.array(modelOptionSchema).min(4, OPTION_COUNT_MESSAGE).max(5, OPTION_COUNT_MESSAGE),
    explanation: z.string().trim().max(4000).optional(),
    subtopic: z.string().trim().min(1, "Every question needs a subtopic tag.").max(200),
    difficulty: z
      .number()
      .finite()
      .min(0, "Difficulty must be between 0 and 1.")
      .max(1, "Difficulty must be between 0 and 1."),
  })
  .refine((value) => value.options.filter((option) => option.isCorrect).length === 1, {
    message: "Each question must have exactly one correct option.",
  })
  .refine(
    (value) =>
      new Set(value.options.map((option) => option.text.trim().toLowerCase())).size ===
      value.options.length,
    { message: "Each question's options must be distinct." },
  )

type ModelQuestion = z.infer<typeof modelQuestionSchema>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Strip a fenced code block if the model wrapped its JSON in one. */
function stripFence(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return fenced?.[1]?.trim() ?? raw.trim()
}

/**
 * Best-effort JSON extraction: the whole response, a fenced block, an object
 * span, or an array span. Anything else fails closed with a parse error.
 */
export function extractJsonValue(raw: string): unknown {
  const trimmed = raw.trim()
  if (!trimmed) throw new QuizGenerationParseError("The model returned an empty response.")

  const unfenced = stripFence(trimmed)
  const candidates: string[] = [unfenced]
  const firstBrace = unfenced.indexOf("{")
  const lastBrace = unfenced.lastIndexOf("}")
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(unfenced.slice(firstBrace, lastBrace + 1))
  }
  const firstBracket = unfenced.indexOf("[")
  const lastBracket = unfenced.lastIndexOf("]")
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    candidates.push(unfenced.slice(firstBracket, lastBracket + 1))
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      // Try the next candidate.
    }
  }

  throw new QuizGenerationParseError("The model response did not contain valid JSON.")
}

function toQuestion(model: ModelQuestion): ParsedGeneratedQuestion {
  return {
    prompt: model.prompt.trim(),
    options: model.options.map((option) => ({
      text: option.text.trim(),
      isCorrect: option.isCorrect,
      rationale: option.rationale?.trim() ? option.rationale.trim() : null,
    })),
    explanation: model.explanation?.trim() ? model.explanation.trim() : null,
    subtopic: model.subtopic.trim(),
    difficulty: Math.round(model.difficulty * 1000) / 1000,
  }
}

export type ParseGeneratedQuestionsOptions = {
  /** When set, at least this many questions must be returned; extra ones are dropped. */
  expectedCount?: number
}

/**
 * Turn raw model text into validated questions. Throws `QuizGenerationParseError`
 * for malformed JSON, a missing question array, an empty result, the wrong
 * option count, a missing/duplicate correct answer, or an out-of-range
 * difficulty.
 */
export function parseGeneratedQuestions(
  rawText: string,
  options: ParseGeneratedQuestionsOptions = {},
): ParsedGeneratedQuestion[] {
  const json = extractJsonValue(rawText)

  let list: unknown[]
  if (Array.isArray(json)) {
    list = json
  } else if (isRecord(json) && Array.isArray(json.questions)) {
    list = json.questions
  } else {
    throw new QuizGenerationParseError("The model response did not contain a questions array.")
  }

  if (list.length === 0) {
    throw new QuizGenerationParseError("The model returned no questions.")
  }

  const parsed: ParsedGeneratedQuestion[] = []
  for (const [index, entry] of list.entries()) {
    const result = modelQuestionSchema.safeParse(entry)
    if (!result.success) {
      throw new QuizGenerationParseError(
        `Question ${index + 1} is invalid: ${firstIssueMessage(result.error)}`,
      )
    }
    parsed.push(toQuestion(result.data))
  }

  const expected = options.expectedCount
  if (expected !== undefined) {
    if (parsed.length < expected) {
      throw new QuizGenerationParseError(
        `The model returned ${parsed.length} questions but ${expected} were requested.`,
      )
    }
    return parsed.slice(0, expected)
  }

  return parsed
}

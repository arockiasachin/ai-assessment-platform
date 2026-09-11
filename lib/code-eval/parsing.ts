import { z } from "zod"

import { firstIssueMessage } from "@/lib/contracts/common"
import type { GeneratedTestCaseDraft } from "@/lib/contracts/code-eval"

import { TestGenerationParseError } from "./errors"
import { normalizeCategory } from "./results"

/**
 * Validation of the raw model output for test-case drafts.
 *
 * Strict on purpose: a generated test case must have a name, a supported
 * category, and a category-appropriate `input` / `expectedOutput`. Anything else
 * is a loud 502 rather than a silently invented draft. Fenced code blocks and a
 * bare JSON array are tolerated because both are common model habits.
 */

const modelTestCaseSchema = z.object({
  name: z.string().trim().min(1, "Every test case needs a name.").max(200),
  description: z.string().trim().max(2_000).nullable().optional(),
  category: z.string().trim().min(1, "Every test case needs a category."),
  input: z.string().nullable().optional(),
  expectedOutput: z.string().nullable().optional(),
  points: z.number().finite().positive().max(1_000).optional(),
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stripFence(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return fenced?.[1]?.trim() ?? raw.trim()
}

/** Best-effort JSON extraction: whole response, fenced block, object, or array. */
export function extractJsonValue(raw: string): unknown {
  const trimmed = raw.trim()
  if (!trimmed) throw new TestGenerationParseError("The model returned an empty response.")

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

  throw new TestGenerationParseError("The model response did not contain valid JSON.")
}

function requireText(value: string | null | undefined, label: string): string {
  const text = typeof value === "string" ? value : ""
  if (!text.trim()) {
    throw new TestGenerationParseError(`A generated test case is missing its ${label}.`)
  }
  return text
}

export type ParseGeneratedTestCasesOptions = {
  /** When set, at least this many test cases must be returned. */
  expectedCount?: number
}

/**
 * Turn raw model text into validated test-case drafts. Throws
 * `TestGenerationParseError` for malformed JSON, a missing array, or a test case
 * whose shape does not match its category.
 */
export function parseGeneratedTestCases(
  rawText: string,
  options: ParseGeneratedTestCasesOptions = {},
): GeneratedTestCaseDraft[] {
  const json = extractJsonValue(rawText)

  let list: unknown[]
  if (Array.isArray(json)) {
    list = json
  } else if (isRecord(json) && Array.isArray(json.testCases)) {
    list = json.testCases
  } else {
    throw new TestGenerationParseError("The model response did not contain a testCases array.")
  }

  if (list.length === 0) {
    throw new TestGenerationParseError("The model returned no test cases.")
  }

  const drafts: GeneratedTestCaseDraft[] = []
  const seenNames = new Set<string>()

  for (const [index, entry] of list.entries()) {
    const result = modelTestCaseSchema.safeParse(entry)
    if (!result.success) {
      throw new TestGenerationParseError(
        `Test case ${index + 1} is invalid: ${firstIssueMessage(result.error)}`,
      )
    }
    const model = result.data
    const category = normalizeCategory(model.category)

    if (category === "input-output") {
      requireText(model.input, "input")
      requireText(model.expectedOutput, "expectedOutput")
    } else if (category === "unit") {
      const spec = requireText(model.input, "input")
      let parsedSpec: unknown
      try {
        parsedSpec = JSON.parse(spec)
      } catch {
        throw new TestGenerationParseError(
          `Test case ${index + 1} has a unit input that is not valid JSON.`,
        )
      }
      if (!isRecord(parsedSpec) || typeof parsedSpec.function !== "string") {
        throw new TestGenerationParseError(
          `Test case ${index + 1} unit input must be a JSON object with a "function" name.`,
        )
      }
    } else {
      const rules = requireText(model.input, "input")
      let parsedRules: unknown
      try {
        parsedRules = JSON.parse(rules)
      } catch {
        throw new TestGenerationParseError(
          `Test case ${index + 1} has ${category} rules that are not valid JSON.`,
        )
      }
      if (!isRecord(parsedRules)) {
        throw new TestGenerationParseError(
          `Test case ${index + 1} ${category} input must be a JSON object.`,
        )
      }
    }

    const name = model.name.trim()
    if (seenNames.has(name.toLowerCase())) {
      throw new TestGenerationParseError(`Generated test case names must be unique ("${name}").`)
    }
    seenNames.add(name.toLowerCase())

    drafts.push({
      name,
      description: model.description?.trim() ? model.description.trim() : null,
      category,
      input: model.input ?? null,
      expectedOutput: model.expectedOutput ?? null,
      points: model.points ?? 1,
    })
  }

  const expected = options.expectedCount
  if (expected !== undefined && drafts.length < expected) {
    throw new TestGenerationParseError(
      `The model returned ${drafts.length} test cases but ${expected} were requested.`,
    )
  }

  return expected !== undefined ? drafts.slice(0, expected) : drafts
}

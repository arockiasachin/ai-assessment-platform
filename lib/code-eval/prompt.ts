import type { CodeLanguage, TestCategory } from "@/lib/contracts/code-eval"
import type { LlmMessage } from "@/lib/llm"

/**
 * The versioned test-case-generation prompt.
 *
 * Bump `CODE_EVAL_PROMPT_VERSION` whenever the template changes; the version is
 * persisted on the `CodeTask.metadata` generation envelope so a reviewer can
 * trace a draft back to the prompt that wrote it. Generated tests are drafts
 * until a teacher publishes them — exactly the quiz-generation pod's pattern.
 */
export const CODE_EVAL_PROMPT_VERSION = "code-eval-v1"

/** The categories the model may use. */
export const GENERATED_TEST_CATEGORIES: readonly TestCategory[] = [
  "input-output",
  "unit",
  "structure",
  "code-quality",
]

export type CodeEvalPromptInput = {
  language: CodeLanguage
  instructions: string | null
  starterCode: string | null
  count: number
  focus?: string
  /** Existing test names, so the model does not duplicate them. */
  existingTestNames: readonly string[]
}

const CATEGORY_GUIDANCE: Record<TestCategory, string> = {
  "input-output":
    'category "input-output": `input` is the exact stdin text, `expectedOutput` the exact stdout it should produce.',
  unit: 'category "unit": `input` is a JSON object {"function": string, "args": array} calling a function the student defines; `expectedOutput` is the JSON-encoded return value.',
  structure:
    'category "structure": `input` is a JSON object of static rules ({"mustContain": [string], "mustNotContain": [string], "minLines": number, "maxLines": number, "maxLineLength": number}); `expectedOutput` is null.',
  "code-quality":
    'category "code-quality": `input` is a JSON object of quality signals ({"minComments": number, "maxLineLength": number, "mustContain": [string]}); `expectedOutput` is null.',
}

function renderList(values: readonly string[], fallback: string): string {
  if (values.length === 0) return fallback
  return values.map((value) => `- ${value}`).join("\n")
}

/**
 * Build the system + user messages for one draft-generation request. Pure and
 * deterministic so it can be versioned and unit tested.
 */
export function buildCodeEvalPrompt(input: CodeEvalPromptInput): LlmMessage[] {
  const language = input.language === "python" ? "Python 3.12" : "Node.js 22 (JavaScript)"
  const categories = GENERATED_TEST_CATEGORIES.map(
    (category) => `- ${CATEGORY_GUIDANCE[category]}`,
  ).join("\n")

  const system =
    "You are an experienced programming instructor writing autograder test cases. " +
    "Respond with a single JSON object and nothing else, using this shape:\n" +
    '{"testCases":[{"name":string,"description":string,"category":"input-output"|"unit"|"structure"|"code-quality","input":string|null,"expectedOutput":string|null,"points":number}]}\n' +
    `The student writes ${language}. Each test case must be independently runnable and must not ` +
    "depend on another test. Categories and their input formats:\n" +
    `${categories}\n` +
    "Prefer `input-output` for behavioural tests. Include at least one `structure` or `code-quality` " +
    "signal only when it is genuinely useful. `points` must be a positive number (default 1). " +
    "Test names must be unique and descriptive. Never include a test whose expected output you cannot " +
    "determine from the task description."

  const user = [
    `Number of draft test cases to generate: ${input.count}`,
    `Task instructions:\n${input.instructions?.trim() || "No extra instructions were provided."}`,
    `Starter code:\n${input.starterCode?.trim() || "(none)"}`,
    input.focus?.trim() ? `Focus areas requested by the teacher:\n${input.focus.trim()}` : null,
    `Existing test names (do not duplicate these):\n${renderList(
      input.existingTestNames,
      "(this task has no test cases yet)",
    )}`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n\n")

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

import { describe, expect, it } from "vitest"

import { createMockProvider } from "@/lib/llm"
import { parseCriterionEvaluation } from "@/lib/rubric-grading/parsing"
import { buildCriterionPrompt } from "@/lib/rubric-grading/evaluation"
import { buildQuizGenerationPrompt } from "@/lib/quiz-generation/prompt"
import { parseGeneratedQuestions } from "@/lib/quiz-generation/parsing"

/**
 * Regression coverage for bug-fix run 2: the offline `mock` provider only knew
 * the `quiz-generation` task. Every `rubric-grading` call returned the generic
 * mock JSON, which `parseCriterionEvaluation` rejects, so with
 * `LLM_PROVIDER=mock` (the documented offline mode) the review-evaluate route
 * always answered 502. Its quiz synthesis also leaked the "Course material"
 * prompt section into the persisted subtopic tags.
 */
const SUBMISSION =
  "Photosynthesis converts light energy into glucose. The Calvin cycle fixes carbon dioxide in the stroma."

async function rubricMock(maxPoints: number, label: string) {
  const provider = createMockProvider()
  const messages = buildCriterionPrompt({
    assessmentTitle: "Biology write-up",
    criterionLabel: label,
    criterionDescription: "Explain the two stages.",
    levels: [{ label: "Excellent", descriptor: "Complete", points: maxPoints }],
    maxPoints,
    submissionText: SUBMISSION,
  })
  const result = await provider.generate({
    messages,
    task: "rubric-grading",
    promptVersion: "rubric-grading-v1",
    json: true,
    temperature: 0,
  })
  return {
    result,
    parsed: parseCriterionEvaluation(result.text, {
      criterionLabel: label,
      maxPoints,
      submissionText: SUBMISSION,
    }),
  }
}

describe("mock provider — rubric grading task", () => {
  it("the generic json mock (pre-fix behaviour) does not satisfy the criterion contract", async () => {
    const provider = createMockProvider()
    const generic = await provider.generate({
      messages: [{ role: "user", content: "Score this criterion." }],
      task: "general",
      json: true,
    })
    expect(() =>
      parseCriterionEvaluation(generic.text, {
        criterionLabel: "Argument",
        maxPoints: 10,
        submissionText: SUBMISSION,
      }),
    ).toThrowError(/score|rationale|evidence|confidence/i)
  })

  it("returns a parseable, evidence-verified criterion evaluation", async () => {
    const { parsed } = await rubricMock(10, "Photosynthesis stages")
    expect(parsed.score).toBeGreaterThan(0)
    expect(parsed.score).toBeLessThanOrEqual(10)
    expect(parsed.clampedToCeiling).toBe(false)
    expect(parsed.evidenceVerified).toBe(true)
    expect(parsed.confidence).toBeGreaterThanOrEqual(0)
    expect(parsed.confidence).toBeLessThanOrEqual(1)
    expect(parsed.rationale.length).toBeGreaterThan(0)
  })

  it("is deterministic and respects the criterion ceiling", async () => {
    const first = await rubricMock(7, "Clarity")
    const second = await rubricMock(7, "Clarity")
    expect(second.result.text).toBe(first.result.text)
    expect(first.parsed.score).toBeLessThanOrEqual(7)
  })
})

describe("mock provider — quiz generation subtopics", () => {
  it("uses the supplied bullet tags, never the material heading", async () => {
    const provider = createMockProvider()
    const messages = buildQuizGenerationPrompt({
      topic: "Thermodynamics",
      questionCount: 2,
      difficulty: "mixed",
      subtopics: ["First law", "Entropy"],
      sources: [
        { chunkId: "c1", materialTitle: "Notes", content: "- a bullet that is not a subtopic" },
      ],
    })
    const result = await provider.generate({ messages, task: "quiz-generation", json: true })
    const parsed = parseGeneratedQuestions(result.text, { expectedCount: 2 })

    const allowed = new Set(["First law", "Entropy"])
    for (const question of parsed) {
      expect(allowed.has(question.subtopic)).toBe(true)
      expect(question.subtopic).not.toMatch(/course material/i)
    }
  })

  it("falls back to the topic when no bullet tags are supplied", async () => {
    const provider = createMockProvider()
    const messages = buildQuizGenerationPrompt({
      topic: "Thermodynamics",
      questionCount: 1,
      difficulty: "mixed",
      subtopics: [],
      sources: [],
    })
    const result = await provider.generate({ messages, task: "quiz-generation", json: true })
    const parsed = parseGeneratedQuestions(result.text, { expectedCount: 1 })
    expect(parsed[0].subtopic).toBe("Thermodynamics fundamentals")
  })
})

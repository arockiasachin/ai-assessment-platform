import { describe, expect, it } from "vitest"

import { buildQuizGenerationPrompt, QUIZ_GENERATION_PROMPT_VERSION } from "@/lib/quiz-generation"

/**
 * Prompt construction. The prompt is the pod's contract with the model, so these
 * assertions pin the properties the acceptance criteria depend on: the topic and
 * retrieved material are present, the exact question count is requested, and the
 * distractor instruction demands plausible misconceptions.
 */

const chunk = (id: string, title: string, content: string) => ({
  chunkId: id,
  materialTitle: title,
  content,
})

describe("buildQuizGenerationPrompt", () => {
  it("includes the topic, every retrieved excerpt, and the requested count", () => {
    const messages = buildQuizGenerationPrompt({
      topic: "Newton's second law",
      questionCount: 3,
      chunks: [
        chunk("chunk-a", "Mechanics notes", "F = m * a relates force, mass, and acceleration."),
        chunk("chunk-b", "Worked examples", "Doubling the mass halves the acceleration."),
      ],
    })

    expect(messages).toHaveLength(2)
    const [system, user] = messages
    expect(system.role).toBe("system")
    expect(user.role).toBe("user")

    expect(user.content).toContain("Newton's second law")
    expect(user.content).toContain("F = m * a")
    expect(user.content).toContain("chunk-a")
    expect(user.content).toContain("Doubling the mass halves the acceleration.")
    expect(user.content).toContain("chunk-b")
    expect(user.content).toContain("Write 3 questions")
    expect(system.content).toContain("exactly 3 questions")
  })

  it("demands misconception-targeting distractors and one correct option", () => {
    const [system] = buildQuizGenerationPrompt({
      topic: "Photosynthesis",
      questionCount: 1,
      chunks: [chunk("chunk-1", "Biology", "Chlorophyll absorbs light energy.")],
    })

    expect(system.content).toContain("misconception")
    expect(system.content).toContain("exactly ONE")
    expect(system.content).toContain("4-5 options")
    // Grounding rule: the model may not invent facts outside the excerpts.
    expect(system.content).toContain("ONLY in the provided course material")
  })

  it("exposes a stable prompt version", () => {
    expect(QUIZ_GENERATION_PROMPT_VERSION).toBe("quiz-generation-v1")
  })
})

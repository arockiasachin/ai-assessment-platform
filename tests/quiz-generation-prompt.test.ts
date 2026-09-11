import { describe, expect, it } from "vitest"

import {
  QUIZ_GENERATION_PROMPT_VERSION,
  buildQuizGenerationPrompt,
  type QuizPromptInput,
} from "@/lib/quiz-generation"

function input(overrides: Partial<QuizPromptInput> = {}): QuizPromptInput {
  return {
    topic: "Photosynthesis light-dependent reactions",
    questionCount: 4,
    difficulty: "mixed",
    subtopics: ["light reactions", "Calvin cycle"],
    sources: [
      {
        chunkId: "chunk-1",
        materialTitle: "Week 3 slides",
        content: "Photosynthesis converts light energy into chemical energy.",
      },
    ],
    ...overrides,
  }
}

describe("quiz generation prompt", () => {
  it("is versioned and deterministic", () => {
    expect(QUIZ_GENERATION_PROMPT_VERSION).toBe("quiz-generation-v1")
    expect(buildQuizGenerationPrompt(input())).toEqual(buildQuizGenerationPrompt(input()))
  })

  it("returns a system and a user message", () => {
    const messages = buildQuizGenerationPrompt(input())
    expect(messages.map((message) => message.role)).toEqual(["system", "user"])
  })

  it("instructs the model to build misconception-targeting distractors", () => {
    const system = buildQuizGenerationPrompt(input())[0].content
    expect(system).toContain("plausible misconception")
    expect(system).toContain("exactly ONE option")
    expect(system).toContain("Never use filler")
    expect(system).toContain("isCorrect")
  })

  it("carries the topic, requested count, and difficulty guidance", () => {
    const user = buildQuizGenerationPrompt(input({ questionCount: 4, difficulty: "hard" }))[1]
      .content
    expect(user).toContain("Number of questions to generate: 4")
    expect(user).toContain("Topic: Photosynthesis light-dependent reactions")
    expect(user).toContain("Difficulty target: hard")
    expect(user).toContain("synthesis and evaluation")
    expect(user).toContain("- light reactions")
    expect(user).toContain("- Calvin cycle")
  })

  it("grounds the prompt in the retrieved chunks", () => {
    const user = buildQuizGenerationPrompt(input())[1].content
    expect(user).toContain('"Week 3 slides"')
    expect(user).toContain("chunk-1")
    expect(user).toContain("Photosynthesis converts light energy into chemical energy.")
  })

  it("says so when no material was retrieved", () => {
    const user = buildQuizGenerationPrompt(input({ sources: [], subtopics: [] }))[1].content
    expect(user).toContain("No indexed course material was found")
    expect(user).toContain("choose 2-4 coherent subtopics yourself")
  })
})

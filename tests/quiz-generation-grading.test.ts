import { describe, expect, it } from "vitest"

import { QuizGenerationError, gradeGeneratedQuiz } from "@/lib/quiz-generation"

const questions = [
  {
    id: "q1",
    prompt: "Which organelle carries out photosynthesis?",
    explanation: "Chloroplasts.",
    options: [
      { text: "Chloroplast", isCorrect: true },
      { text: "Mitochondrion", isCorrect: false },
      { text: "Ribosome", isCorrect: false },
      { text: "Golgi apparatus", isCorrect: false },
    ],
  },
  {
    id: "q2",
    prompt: "What is the primary light-absorbing pigment?",
    explanation: "Chlorophyll a.",
    options: [
      { text: "Melanin", isCorrect: false },
      { text: "Hemoglobin", isCorrect: false },
      { text: "Chlorophyll a", isCorrect: true },
      { text: "Keratin", isCorrect: false },
    ],
  },
]

describe("gradeGeneratedQuiz", () => {
  it("scores against the server-held answer key", () => {
    const scored = gradeGeneratedQuiz(
      questions,
      [
        { questionId: "q1", selectedIndex: 0 },
        { questionId: "q2", selectedIndex: 1 },
      ],
      20,
    )

    expect(scored.correctCount).toBe(1)
    expect(scored.score).toBe(10)
    expect(scored.results[0].isCorrect).toBe(true)
    expect(scored.results[1].isCorrect).toBe(false)
    // The key is derived from the stored options, not from the submitted answers.
    expect(scored.results[1].correctIndex).toBe(2)
    expect(scored.results[1].correctText).toBe("Chlorophyll a")
  })

  it("treats unanswered questions as incorrect", () => {
    const scored = gradeGeneratedQuiz(questions, [{ questionId: "q1", selectedIndex: null }], 20)
    expect(scored.correctCount).toBe(0)
    expect(scored.score).toBe(0)
  })

  it("refuses to grade a question without a correct option", () => {
    const broken = [
      {
        id: "q1",
        prompt: "Broken",
        explanation: null,
        options: [
          { text: "A", isCorrect: false },
          { text: "B", isCorrect: false },
          { text: "C", isCorrect: false },
          { text: "D", isCorrect: false },
        ],
      },
    ]
    expect(() =>
      gradeGeneratedQuiz(broken, [{ questionId: "q1", selectedIndex: 0 }], 1),
    ).toThrowError(QuizGenerationError)
  })
})

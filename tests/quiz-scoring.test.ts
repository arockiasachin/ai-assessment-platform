import { describe, expect, it } from "vitest"

import { quizGradeRequestSchema } from "@/lib/contracts"
import { QuizScoringError, scoreQuiz } from "@/lib/quiz-scoring"

const questions = [
  { id: "q1", prompt: "2 + 2?", options: ["3", "4", "5"], correctIndex: 1 },
  { id: "q2", prompt: "3 x 3?", options: ["6", "9", "12"], correctIndex: 1 },
]

describe("scoreQuiz (server-authoritative)", () => {
  it("derives correctness from the server's key, not from the client", () => {
    const scored = scoreQuiz(
      questions,
      [
        { questionId: "q1", selectedIndex: 1 },
        { questionId: "q2", selectedIndex: 0 },
      ],
      10,
    )

    expect(scored.correctCount).toBe(1)
    expect(scored.totalQuestions).toBe(2)
    expect(scored.score).toBe(5)
    expect(scored.maxScore).toBe(10)
    expect(scored.results[0]).toMatchObject({
      questionId: "q1",
      isCorrect: true,
      correctIndex: 1,
      correctText: "4",
      selectedText: "4",
    })
    expect(scored.results[1]).toMatchObject({
      questionId: "q2",
      isCorrect: false,
      correctIndex: 1,
      correctText: "9",
      selectedText: "6",
    })
  })

  it("scores unanswered questions as zero and returns every question", () => {
    const scored = scoreQuiz(questions, [{ questionId: "q1", selectedIndex: null }], 10)

    expect(scored.results).toHaveLength(2)
    expect(scored.results.every((result) => result.isCorrect === false)).toBe(true)
    expect(scored.results[1].selectedText).toBeNull()
    expect(scored.score).toBe(0)
  })

  it("rejects answers that reference an unknown or duplicate question", () => {
    expect(() => scoreQuiz(questions, [{ questionId: "missing", selectedIndex: 0 }], 10)).toThrow(
      QuizScoringError,
    )

    expect(() =>
      scoreQuiz(
        questions,
        [
          { questionId: "q1", selectedIndex: 0 },
          { questionId: "q1", selectedIndex: 1 },
        ],
        10,
      ),
    ).toThrow(QuizScoringError)
  })
})

describe("quizGradeRequestSchema", () => {
  it("requires at least one answer and never accepts a correctness flag", () => {
    expect(quizGradeRequestSchema.safeParse({ assessmentId: "a1", answers: [] }).success).toBe(
      false,
    )
    expect(
      quizGradeRequestSchema.safeParse({
        assessmentId: "a1",
        answers: [{ questionId: "q1", selectedIndex: 1 }],
      }).success,
    ).toBe(true)
  })
})

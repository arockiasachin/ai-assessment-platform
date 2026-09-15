import { MOCK_ASSESSMENT_BY_ID, MOCK_MARKS, MOCK_STUDENTS } from "./course"
import { MOCK_NOW } from "./format"
import type {
  ItemAnalysis,
  QuizAttemptSummary,
  QuizInProgressAttempt,
  QuizQuestion,
  QuizResponse,
} from "./types"

/**
 * Quiz domain: the published question set for Quiz 1, its attempts, and the
 * per-question item analysis.
 *
 * Two deliberate edge cases:
 *  - question 5 is still a DRAFT (generated questions are drafts until the
 *    teacher publishes them), so it has no responses to analyse;
 *  - question 6 has only 3 responses — below the item-analysis threshold — so
 *    its difficulty and discrimination are `null` and it is flagged
 *    `insufficient-data` rather than being reported as if it were real.
 */

export const MOCK_QUIZ_QUESTIONS: QuizQuestion[] = [
  {
    id: "q_linear_1",
    order: 1,
    prompt: "Which value of x satisfies 3x + 7 = 22?",
    type: "MULTIPLE_CHOICE",
    points: 3,
    topic: "Solving linear equations",
    difficulty: 0.2,
    state: "published",
    explanation: "Subtract 7 from both sides (3x = 15), then divide by 3 to get x = 5.",
    options: [
      { id: "q1_a", label: "A", text: "x = 5", isCorrect: true },
      {
        id: "q1_b",
        label: "B",
        text: "x = 3",
        isCorrect: false,
        rationale: "Likely from dividing 15 by 5 instead of by 3.",
      },
      {
        id: "q1_c",
        label: "C",
        text: "x = 6",
        isCorrect: false,
        rationale: "Likely from adding 7 rather than subtracting it.",
      },
      {
        id: "q1_d",
        label: "D",
        text: "x = 7.33",
        isCorrect: false,
        rationale: "Likely from dividing 22 by 3.",
      },
    ],
  },
  {
    id: "q_linear_2",
    order: 2,
    prompt: "Simplify 4(2x − 3) + 5.",
    type: "MULTIPLE_CHOICE",
    points: 3,
    topic: "Algebraic manipulation",
    difficulty: 0.35,
    state: "published",
    explanation: "Expand to 8x − 12, then add 5: 8x − 7.",
    options: [
      { id: "q2_a", label: "A", text: "8x − 7", isCorrect: true },
      {
        id: "q2_b",
        label: "B",
        text: "8x − 12",
        isCorrect: false,
        rationale: "Distributed correctly but forgot to combine +5.",
      },
      {
        id: "q2_c",
        label: "C",
        text: "8x + 2",
        isCorrect: false,
        rationale: "Likely from subtracting 3 instead of multiplying by 4.",
      },
      {
        id: "q2_d",
        label: "D",
        text: "6x − 7",
        isCorrect: false,
        rationale: "Likely from adding 4 to 2x instead of multiplying.",
      },
    ],
  },
  {
    id: "q_linear_3",
    order: 3,
    prompt: "A line passes through (0, −2) with gradient 3. Which equation describes it?",
    type: "MULTIPLE_CHOICE",
    points: 4,
    topic: "Gradient & intercept",
    difficulty: 0.4,
    state: "published",
    explanation: "The point (0, −2) is the y-intercept, so y = 3x − 2.",
    options: [
      { id: "q3_a", label: "A", text: "y = 3x − 2", isCorrect: true },
      {
        id: "q3_b",
        label: "B",
        text: "y = −2x + 3",
        isCorrect: false,
        rationale: "Swapped the roles of gradient and intercept.",
      },
      {
        id: "q3_c",
        label: "C",
        text: "y = 3x + 2",
        isCorrect: false,
        rationale: "Sign error on the intercept.",
      },
      {
        id: "q3_d",
        label: "D",
        text: "y = x/3 − 2",
        isCorrect: false,
        rationale: "Used the reciprocal of the gradient.",
      },
    ],
  },
  {
    id: "q_linear_4",
    order: 4,
    prompt: "Solve 5 − 2x = 1.",
    type: "MULTIPLE_CHOICE",
    points: 3,
    topic: "Solving linear equations",
    difficulty: 0.3,
    state: "published",
    explanation: "Rearrange to 2x = 4, so x = 2.",
    options: [
      { id: "q4_a", label: "A", text: "x = 2", isCorrect: true },
      {
        id: "q4_b",
        label: "B",
        text: "x = −2",
        isCorrect: false,
        rationale: "Sign error when moving the term across the equals sign.",
      },
      {
        id: "q4_c",
        label: "C",
        text: "x = 3",
        isCorrect: false,
        rationale: "Likely from computing 5 − 1 = 4 and dividing by 2 twice.",
      },
      {
        id: "q4_d",
        label: "D",
        text: "x = 0.5",
        isCorrect: false,
        rationale: "Likely from dividing 1 by 2 before rearranging.",
      },
    ],
  },
  {
    id: "q_linear_5",
    order: 5,
    prompt: "Which pair of lines is parallel?",
    type: "MULTIPLE_CHOICE",
    points: 4,
    topic: "Parallel & perpendicular",
    difficulty: 0.45,
    state: "draft",
    explanation: "Parallel lines share the same gradient: y = 2x + 1 and y = 2x − 5.",
    options: [
      { id: "q5_a", label: "A", text: "y = 2x + 1 and y = 2x − 5", isCorrect: true },
      {
        id: "q5_b",
        label: "B",
        text: "y = 2x and y = −2x",
        isCorrect: false,
        rationale: "Confuses opposite gradients with equal gradients.",
      },
      {
        id: "q5_c",
        label: "C",
        text: "y = x + 3 and y = 3x + 1",
        isCorrect: false,
        rationale: "Gradients 1 and 3 are not equal.",
      },
      {
        id: "q5_d",
        label: "D",
        text: "y = 0.5x and y = 2x",
        isCorrect: false,
        rationale: "These gradients are reciprocals, not equal.",
      },
    ],
  },
  {
    id: "q_linear_6",
    order: 6,
    prompt: "Select every value of x that satisfies 2x − 3 ≤ 7.",
    type: "MULTIPLE_SELECT",
    points: 3,
    topic: "Inequalities",
    difficulty: 0.5,
    state: "published",
    explanation: "2x ≤ 10, so x ≤ 5. Only 3 and 5 satisfy the inequality.",
    options: [
      { id: "q6_a", label: "A", text: "5", isCorrect: true },
      { id: "q6_b", label: "B", text: "3", isCorrect: true },
      {
        id: "q6_c",
        label: "C",
        text: "7",
        isCorrect: false,
        rationale: "7 > 5, so it does not satisfy the inequality.",
      },
      {
        id: "q6_d",
        label: "D",
        text: "8",
        isCorrect: false,
        rationale: "8 > 5, so it does not satisfy the inequality.",
      },
    ],
  },
]

/** Finalized Quiz 1 attempts. Scores come from the shared marks table. */
const QUIZ_1 = MOCK_ASSESSMENT_BY_ID["asm_quiz1"]

export const MOCK_QUIZ_ATTEMPTS: QuizAttemptSummary[] = MOCK_STUDENTS.filter(
  (student) => MOCK_MARKS.quiz1[student.id] !== null,
).map((student, index) => {
  const score = MOCK_MARKS.quiz1[student.id]
  return {
    id: `att_quiz1_${student.id}`,
    assessmentId: QUIZ_1.id,
    assessmentTitle: QUIZ_1.title,
    studentId: student.id,
    studentName: student.name,
    attemptNumber: student.id === "stu_ethan" ? 2 : 1,
    state: "graded",
    score,
    maxScore: 20,
    submittedAt: index % 3 === 0 ? "2026-09-02T13:05:00.000Z" : "2026-09-02T12:40:00.000Z",
    timeSpentMs: 1_200_000 + index * 45_000,
  }
})

/**
 * Item analysis for Quiz 1.
 *
 * `percentCorrect` is the facility index (1.0 = everyone correct) and
 * `discrimination` is the point-biserial correlation. Question 3 is flagged
 * `needs-review` for near-zero discrimination: strong and weak students do
 * equally well on it, which usually means the wording gives the answer away.
 */
export const MOCK_ITEM_ANALYSIS: ItemAnalysis[] = [
  {
    questionId: "q_linear_1",
    order: 1,
    prompt: "Which value of x satisfies 3x + 7 = 22?",
    topic: "Solving linear equations",
    responses: 12,
    percentCorrect: 0.92,
    discrimination: 0.41,
    flag: "active",
    note: "Well understood; a good warm-up item.",
  },
  {
    questionId: "q_linear_2",
    order: 2,
    prompt: "Simplify 4(2x − 3) + 5.",
    topic: "Algebraic manipulation",
    responses: 12,
    percentCorrect: 0.75,
    discrimination: 0.58,
    flag: "active",
    note: "Discriminates well between strong and weak students.",
  },
  {
    questionId: "q_linear_3",
    order: 3,
    prompt: "A line passes through (0, −2) with gradient 3. Which equation describes it?",
    topic: "Gradient & intercept",
    responses: 12,
    percentCorrect: 0.83,
    discrimination: 0.04,
    flag: "needs-review",
    note: "Almost no discrimination — distractor B may be too obviously wrong.",
  },
  {
    questionId: "q_linear_4",
    order: 4,
    prompt: "Solve 5 − 2x = 1.",
    topic: "Solving linear equations",
    responses: 12,
    percentCorrect: 0.67,
    discrimination: 0.52,
    flag: "active",
    note: "Sign handling is the main source of error.",
  },
  {
    questionId: "q_linear_5",
    order: 5,
    prompt: "Which pair of lines is parallel?",
    topic: "Parallel & perpendicular",
    responses: 0,
    percentCorrect: null,
    discrimination: null,
    flag: "insufficient-data",
    note: "Draft question — not yet published, so there are no responses.",
  },
  {
    questionId: "q_linear_6",
    order: 6,
    prompt: "Select every value of x that satisfies 2x − 3 ≤ 7.",
    topic: "Inequalities",
    responses: 3,
    percentCorrect: null,
    discrimination: null,
    flag: "insufficient-data",
    note: "Only 3 responses; below the 5-response threshold for item analysis.",
  },
]

/** Questions the teacher can still edit or publish. */
export const MOCK_DRAFT_QUESTIONS = MOCK_QUIZ_QUESTIONS.filter(
  (question) => question.state === "draft",
)

/** The demo student's own attempt history. */
export const MOCK_MY_QUIZ_ATTEMPTS: QuizAttemptSummary[] = MOCK_QUIZ_ATTEMPTS.filter(
  (attempt) => attempt.studentId === "stu_aarav",
)

/**
 * The demo student's selections on the submitted Quiz 1 attempt.
 *
 * This is the raw student input the post-submission payload is built from, so
 * the awarded points are derived (see `scoreSelection`) instead of typed in
 * twice: five questions fully correct and one multi-select answered partially,
 * which is exactly the 18 / 20 in the shared marks table.
 */
const MY_QUIZ_1_SELECTIONS: Record<string, string[]> = {
  q_linear_1: ["q1_a"],
  q_linear_2: ["q2_a"],
  q_linear_3: ["q3_a"],
  q_linear_4: ["q4_a"],
  q_linear_5: ["q5_a"],
  // Two options are correct; the student picked one, so partial credit applies.
  q_linear_6: ["q6_a"],
}

function scoreSelection(
  question: QuizQuestion,
  selected: string[] | undefined,
): Pick<QuizResponse, "outcome" | "selectedOptionIds" | "pointsAwarded"> {
  if (!selected || selected.length === 0) {
    // Unanswered is its own outcome — never reported as incorrect.
    return { outcome: "UNANSWERED", selectedOptionIds: [], pointsAwarded: 0 }
  }

  const correctOptionIds = question.options.filter((option) => option.isCorrect).map((o) => o.id)
  const correctSelected = selected.filter((id) => correctOptionIds.includes(id)).length
  const wrongSelected = selected.length - correctSelected

  if (question.type === "MULTIPLE_SELECT") {
    const ratio = (correctSelected - wrongSelected) / correctOptionIds.length
    const pointsAwarded = Math.max(0, Math.floor(question.points * ratio))
    const outcome =
      pointsAwarded === question.points
        ? "CORRECT"
        : pointsAwarded > 0
          ? "PARTIALLY_CORRECT"
          : "INCORRECT"
    return { outcome, selectedOptionIds: selected, pointsAwarded }
  }

  const isCorrect = correctSelected === correctOptionIds.length && wrongSelected === 0
  return {
    outcome: isCorrect ? "CORRECT" : "INCORRECT",
    selectedOptionIds: selected,
    pointsAwarded: isCorrect ? question.points : 0,
  }
}

/**
 * Per-question results the student sees AFTER submitting Quiz 1.
 *
 * Every question in the sitting has a row, including the one answered
 * partially. Summing `pointsAwarded` gives 18, the same figure as
 * `MOCK_MY_QUIZ_ATTEMPTS[0].score`.
 */
export const MOCK_MY_QUIZ_RESPONSES: QuizResponse[] = MOCK_QUIZ_QUESTIONS.map((question) => ({
  id: `resp_quiz1_${question.id}`,
  questionId: question.id,
  ...scoreSelection(question, MY_QUIZ_1_SELECTIONS[question.id]),
}))

/** Points earned across the responses above. Equals the attempt score (18). */
export const MOCK_MY_QUIZ_RESPONSE_TOTAL = MOCK_MY_QUIZ_RESPONSES.reduce(
  (total, response) => total + response.pointsAwarded,
  0,
)

/**
 * The sitting the student is part-way through: an adaptive practice retake of
 * Quiz 1, drawn from the weakest subtopics. It carries the student's own
 * selections and nothing about correctness, so the pre-submission surface has
 * no answer key to leak — see `QuizInProgressAttempt`.
 */
export const MOCK_MY_IN_PROGRESS_ATTEMPT: QuizInProgressAttempt = (() => {
  const startedAt = "2026-09-15T13:00:00.000Z"
  const expiresAt = "2026-09-15T13:45:00.000Z"
  const questionIds = ["q_linear_1", "q_linear_2", "q_linear_4", "q_linear_6"]
  const selections: Record<string, string[]> = {
    q_linear_1: ["q1_a"],
    q_linear_4: ["q4_b"],
  }
  const pointsFor = (id: string) => MOCK_QUIZ_QUESTIONS.find((q) => q.id === id)?.points ?? 0

  return {
    id: "att_quiz1_practice_stu_aarav",
    assessmentId: "asm_quiz1",
    title: "Quiz 1 — Linear Equations",
    kind: "PRACTICE",
    attemptNumber: 2,
    maxScore: questionIds.reduce((total, id) => total + pointsFor(id), 0),
    startedAt,
    expiresAt,
    questionIds,
    answeredQuestionIds: Object.keys(selections),
    flaggedQuestionIds: ["q_linear_4"],
    selections,
    timeSpentMs: Date.parse(MOCK_NOW) - Date.parse(startedAt),
    timeRemainingMs: Date.parse(expiresAt) - Date.parse(MOCK_NOW),
  }
})()

/** The in-progress sitting's questions, in the order the student sees them. */
export const MOCK_MY_IN_PROGRESS_QUESTIONS: QuizQuestion[] = MOCK_MY_IN_PROGRESS_ATTEMPT.questionIds
  .map((id) => MOCK_QUIZ_QUESTIONS.find((question) => question.id === id))
  .filter((question): question is QuizQuestion => question !== undefined)

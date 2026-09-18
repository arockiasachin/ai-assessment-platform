import type { QuizAttemptSummary, QuizAttemptView } from "@/lib/contracts/quiz-attempts"

/**
 * Pure view logic for the quiz-taking workspace.
 *
 * The same reason as the other `*-view` modules: no jsdom here, so anything left
 * inside the component has no test. Two rules that used to be implicit move here.
 */

type Question = QuizAttemptView["questions"][number]

/**
 * Whether a question is answered with prose rather than a choice.
 *
 * One definition, used by the autosave payload, the submit payload and the
 * unanswered count. They previously each re-tested the type, and a fourth copy
 * would have been the way the three drifted apart.
 */
export function isTextQuestionType(question: Pick<Question, "type">): boolean {
  return question.type === "SHORT_ANSWER" || question.type === "ESSAY"
}

/**
 * How many questions are still blank.
 *
 * The submit route accepts a partial set and scores a blank zero, so the honest
 * thing is to tell the student how many are blank before they submit rather than
 * to claim all of them are required (SL-3).
 */
export function unansweredQuestionCount(
  view: Pick<QuizAttemptView, "questions">,
  answers: Readonly<Record<string, number | null>>,
  textAnswers: Readonly<Record<string, string>>,
): number {
  return view.questions.reduce((count, question) => {
    if (isTextQuestionType(question)) {
      return (textAnswers[question.id] ?? "").trim() === "" ? count + 1 : count
    }
    return answers[question.id] === undefined || answers[question.id] === null ? count + 1 : count
  }, 0)
}

/**
 * The graded sitting that is still open, if any.
 *
 * An in-progress attempt is resumable by the server (`startQuizAttempt` returns
 * the existing row instead of spending a new one), so the primary action should
 * say "Resume" rather than "Start" while one exists (SN-23). Practice sittings are
 * excluded upstream — the history list is `kind: GRADED` — so anything here is a
 * real sitting.
 */
export function resumableAttempt<T extends Pick<QuizAttemptSummary, "id" | "status">>(
  attempts: readonly T[],
): T | null {
  return attempts.find((attempt) => attempt.status === "IN_PROGRESS") ?? null
}

/**
 * How an attempt's score may be presented, given its publication state.
 *
 * The server records the auto-score at submit so the grade pipeline has
 * something to suggest, but only a teacher's `accept`/`override` releases the
 * mark (`docs/features/quiz-grading.md`). Presenting the auto-score as the
 * student's score before that is the SN-11 defect, so the three states are
 * resolved here — one definition shared by the history rows, the attempt
 * heading and the summary tile — rather than each re-testing `gradePublished`.
 */
export type AttemptScoreState =
  | { kind: "unscored" }
  | { kind: "pending"; autoScore: number; maxScore: number | null }
  | { kind: "published"; score: number; maxScore: number | null }

export function attemptScoreState(
  attempt: Pick<QuizAttemptSummary, "score" | "maxScore" | "gradePublished">,
): AttemptScoreState {
  if (attempt.score === null) return { kind: "unscored" }
  if (!attempt.gradePublished) {
    return { kind: "pending", autoScore: attempt.score, maxScore: attempt.maxScore }
  }
  return { kind: "published", score: attempt.score, maxScore: attempt.maxScore }
}

/**
 * Whether an attempt's mark has been released, so a summary tile counts
 * published scores rather than auto-scores awaiting approval (SN-11).
 */
export function isPublishedScore(
  attempt: Pick<QuizAttemptSummary, "score" | "gradePublished"> | null | undefined,
): boolean {
  return attempt != null && attempt.score !== null && attempt.gradePublished
}

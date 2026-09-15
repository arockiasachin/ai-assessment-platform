"use client"

import { useState } from "react"
import { CheckCheck, ClipboardCheck, History, Loader2, Play, Send } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { SectionCard } from "@/components/ui/section-card"
import { StatCard } from "@/components/ui/stat-card"
import { StatusPill, type StatusKey } from "@/components/ui/status-pill"
import type {
  QuizAttemptSummary,
  QuizAttemptView,
  StudentQuizSummary,
} from "@/lib/contracts/quiz-attempts"

/**
 * Student quiz-taking workspace.
 *
 * The list and every attempt payload come from the server. Before submission the
 * questions carry no answer key and no explanation; the per-question feedback
 * (correctness, the chosen answer, the correct answer, the explanation) only
 * appears in `attempt.results` after a successful submit. The attempt cap and
 * deadline are enforced server-side; this component only reflects what the
 * server reports.
 */

type Props = { initialQuizzes: StudentQuizSummary[] }

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  })
  const body: { success?: boolean; message?: string } = await response.json().catch(() => ({}))
  if (!response.ok || body.success === false) {
    throw new Error(body.message ?? "Request failed.")
  }
  return body as T
}

/**
 * Attempt status → the shared status vocabulary.
 *
 * `EXPIRED` and `ABANDONED` map onto `missed`: both mean the sitting will not be
 * scored, and the design system's vocabulary is closed, so inventing a key for
 * each would be drift rather than detail.
 */
const ATTEMPT_STATUS: Record<string, { key: StatusKey; label: string }> = {
  IN_PROGRESS: { key: "in-progress", label: "In progress" },
  SUBMITTED: { key: "submitted", label: "Submitted" },
  GRADED: { key: "graded", label: "Scored" },
  EXPIRED: { key: "missed", label: "Expired" },
  ABANDONED: { key: "missed", label: "Abandoned" },
}

function attemptStatus(status: string) {
  return ATTEMPT_STATUS[status] ?? { key: "pending" as StatusKey, label: status }
}

/**
 * Deterministic date rendering. Without an explicit locale the server (Node,
 * `en-US`) and the browser (the user's locale) format the same timestamp
 * differently, which makes the hydrated output disagree with the server HTML and
 * raises a React hydration error. Pinning the locale keeps both renders equal.
 */
function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function StudentQuizAttempts({ initialQuizzes }: Props) {
  const [quizzes, setQuizzes] = useState(initialQuizzes)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [attempts, setAttempts] = useState<QuizAttemptSummary[]>([])
  const [view, setView] = useState<QuizAttemptView | null>(null)
  const [answers, setAnswers] = useState<Record<string, number | null>>({})
  const [textAnswers, setTextAnswers] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selected = quizzes.find((quiz) => quiz.assessmentId === selectedId) ?? null

  function isTextQuestion(question: QuizAttemptView["questions"][number]): boolean {
    return question.type === "SHORT_ANSWER" || question.type === "ESSAY"
  }

  async function refreshQuizzes() {
    const body = await call<{ success: true; quizzes: StudentQuizSummary[] }>(
      "/api/student/quiz-attempts",
    )
    setQuizzes(body.quizzes)
  }

  async function refreshAttempts(assessmentId: string) {
    const body = await call<{ success: true; attempts: QuizAttemptSummary[] }>(
      `/api/student/quiz-attempts?assessmentId=${encodeURIComponent(assessmentId)}`,
    )
    setAttempts(body.attempts)
  }

  async function selectQuiz(assessmentId: string) {
    setSelectedId(assessmentId)
    setView(null)
    setAnswers({})
    setTextAnswers({})
    setMessage(null)
    setError(null)
    setBusy(true)
    try {
      await refreshAttempts(assessmentId)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed.")
    } finally {
      setBusy(false)
    }
  }

  async function startAttempt() {
    if (!selected) return
    setBusy(true)
    setMessage(null)
    setError(null)
    try {
      const body = await call<{ success: true; attempt: QuizAttemptView }>(
        "/api/student/quiz-attempts",
        { method: "POST", body: JSON.stringify({ assessmentId: selected.assessmentId }) },
      )
      setView(body.attempt)
      setAnswers(Object.fromEntries(body.attempt.questions.map((question) => [question.id, null])))
      setTextAnswers({})
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed.")
    } finally {
      setBusy(false)
    }
  }

  async function openAttempt(attemptId: string) {
    setBusy(true)
    setMessage(null)
    setError(null)
    try {
      const body = await call<{ success: true; attempt: QuizAttemptView }>(
        `/api/student/quiz-attempts/${encodeURIComponent(attemptId)}`,
      )
      setView(body.attempt)
      setAnswers(Object.fromEntries(body.attempt.questions.map((question) => [question.id, null])))
      setTextAnswers({})
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed.")
    } finally {
      setBusy(false)
    }
  }

  async function submit() {
    if (!view) return
    setBusy(true)
    setMessage(null)
    setError(null)
    try {
      const payload = {
        answers: view.questions.map((question) => {
          if (isTextQuestion(question)) {
            const text = (textAnswers[question.id] ?? "").trim()
            return text.length > 0
              ? { questionId: question.id, selectedIndex: null, answerText: text }
              : { questionId: question.id, selectedIndex: null }
          }
          return { questionId: question.id, selectedIndex: answers[question.id] ?? null }
        }),
      }
      const body = await call<{ success: true; message?: string; attempt: QuizAttemptView }>(
        `/api/student/quiz-attempts/${encodeURIComponent(view.id)}/submit`,
        { method: "POST", body: JSON.stringify(payload) },
      )
      setView(body.attempt)
      setMessage(body.message ?? "Quiz submitted.")
      setTextAnswers({})
      await refreshAttempts(view.assessmentId)
      await refreshQuizzes()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed.")
    } finally {
      setBusy(false)
    }
  }

  const resultByQuestion = new Map(
    (view?.results ?? []).map((result) => [result.questionId, result]),
  )

  return (
    <div className="grid gap-6">
      {/* Every tile derives from the quiz list the server sent, so none can
          contradict the rows below. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Quizzes"
          value={String(quizzes.length)}
          hint="Assigned to you"
          icon={ClipboardCheck}
        />
        <StatCard
          label="Open to attempt"
          value={String(quizzes.filter((quiz) => quiz.canStart).length)}
          hint="Attempts remaining and within the deadline"
          icon={Play}
        />
        <StatCard
          label="Attempts used"
          value={String(quizzes.reduce((sum, quiz) => sum + quiz.attemptsUsed, 0))}
          hint={`Across ${quizzes.length} quiz${quizzes.length === 1 ? "" : "zes"}`}
          icon={History}
        />
        <StatCard
          label="Latest attempt scored"
          value={String(
            quizzes.filter((quiz) => (quiz.latestAttempt?.score ?? null) !== null).length,
          )}
          hint="A quiz counts here only if its most recent attempt has a score"
          icon={CheckCheck}
        />
      </div>

      <SectionCard
        title="Your quizzes"
        description="Answers are scored on the server. Your score is a suggestion that your teacher approves before it is published."
      >
        <div className="grid gap-2">
          {quizzes.length === 0 && (
            <p className="text-sm text-muted-foreground">No quizzes are assigned to you yet.</p>
          )}
          {quizzes.map((quiz) => (
            <button
              key={quiz.assessmentId}
              type="button"
              onClick={() => void selectQuiz(quiz.assessmentId)}
              aria-current={quiz.assessmentId === selectedId ? "true" : undefined}
              className={[
                "rounded-lg border px-3 py-2 text-left text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                quiz.assessmentId === selectedId
                  ? "border-primary/40 bg-primary/10"
                  : "border-border bg-background hover:bg-muted",
              ].join(" ")}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{quiz.title}</span>
                <span className="text-xs text-muted-foreground">
                  due {formatDateTime(quiz.dueDate)}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>
                  {quiz.attemptsUsed}/{quiz.maxAttempts} attempts used
                </span>
                <span>· {quiz.questionCount} questions</span>
                {!quiz.canStart && quiz.blockedReason && (
                  <span className="text-destructive">· {quiz.blockedReason}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      </SectionCard>

      {message && (
        <Callout tone="success" role="status" title="Saved">
          {message}
        </Callout>
      )}
      {error && (
        <Callout tone="destructive" role="alert" title="Something went wrong">
          {error}
        </Callout>
      )}

      {selected && (
        <SectionCard
          title={selected.title}
          description="Attempt history. The attempt cap and the deadline are enforced on the server."
          action={
            <Button
              size="sm"
              disabled={busy || !selected.canStart}
              onClick={() => void startAttempt()}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Play className="size-4" aria-hidden="true" />
              )}
              <span className="ml-1">Start attempt</span>
            </Button>
          }
        >
          <div className="grid gap-2">
            {attempts.length === 0 && (
              <p className="text-sm text-muted-foreground">No attempts yet.</p>
            )}
            {attempts.map((attempt) => {
              const state = attemptStatus(attempt.status)
              return (
                <button
                  key={attempt.id}
                  type="button"
                  onClick={() => void openAttempt(attempt.id)}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span>
                    Attempt {attempt.attemptNumber}
                    {attempt.submittedAt && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        submitted {formatDateTime(attempt.submittedAt)}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-2">
                    {attempt.isLate && <StatusPill status="late" label="Late" dot />}
                    {attempt.score !== null && (
                      <span className="text-xs text-muted-foreground">
                        {attempt.score}/{attempt.maxScore ?? selected.maxMarks}
                      </span>
                    )}
                    <StatusPill status={state.key} label={state.label} dot />
                  </span>
                </button>
              )
            })}
          </div>
        </SectionCard>
      )}

      {view && (
        <SectionCard
          title={`Attempt ${view.attemptNumber}`}
          description={
            view.status === "IN_PROGRESS"
              ? "In progress — answer all questions, then submit."
              : view.score !== null
                ? `Scored ${view.score}/${view.maxScore ?? ""}`
                : "Submitted"
          }
        >
          <div className="grid gap-4">
            {view.questions.map((question) => {
              const result = resultByQuestion.get(question.id)
              const chosen = answers[question.id] ?? null
              if (isTextQuestion(question)) {
                return (
                  <div key={question.id} className="rounded-lg border border-border p-3">
                    <p className="text-sm font-medium">{question.prompt}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {question.points} mark{question.points === 1 ? "" : "s"} · written answer
                    </p>
                    <textarea
                      className="mt-2 min-h-24 w-full rounded border border-border bg-background p-2 text-sm"
                      placeholder="Type your answer here."
                      disabled={view.status !== "IN_PROGRESS"}
                      value={result ? (result.answerText ?? "") : (textAnswers[question.id] ?? "")}
                      onChange={(event) =>
                        setTextAnswers((prev) => ({ ...prev, [question.id]: event.target.value }))
                      }
                    />
                    {result && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {result.needsManualReview
                          ? "Awaiting teacher scoring."
                          : `Suggested ${result.points}/${result.maxPoints} (partial credit is a suggestion awaiting teacher approval).`}
                        {result.rationale ? ` ${result.rationale}` : ""}
                        {result.explanation ? ` Reference answer: ${result.explanation}` : ""}
                      </p>
                    )}
                  </div>
                )
              }
              return (
                <div key={question.id} className="rounded-lg border border-border p-3">
                  <p className="text-sm font-medium">{question.prompt}</p>
                  <div className="mt-2 grid gap-1">
                    {question.options.map((option, optionIndex) => {
                      const isChosen = result
                        ? result.selectedIndex === optionIndex
                        : chosen === optionIndex
                      const isCorrectOption = result ? result.correctIndex === optionIndex : false
                      return (
                        <label
                          key={option.id}
                          className={[
                            "flex items-center gap-2 rounded border px-2 py-1 text-sm",
                            result && isCorrectOption
                              ? "border-emerald-500/60 bg-emerald-500/10"
                              : result && isChosen
                                ? "border-destructive/60 bg-destructive/10"
                                : "border-border",
                          ].join(" ")}
                        >
                          <input
                            type="radio"
                            name={question.id}
                            disabled={view.status !== "IN_PROGRESS"}
                            checked={isChosen}
                            onChange={() =>
                              setAnswers((prev) => ({ ...prev, [question.id]: optionIndex }))
                            }
                          />
                          <span>{option.text}</span>
                          {result && isCorrectOption && (
                            <span className="ml-auto text-xs text-emerald-600">correct</span>
                          )}
                          {result && isChosen && !isCorrectOption && (
                            <span className="ml-auto text-xs text-destructive">your answer</span>
                          )}
                        </label>
                      )
                    })}
                  </div>
                  {result && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {result.isCorrect ? "Correct." : "Incorrect."} Correct answer:{" "}
                      <span className="font-medium">{result.correctText || "—"}</span>
                      {result.explanation ? ` — ${result.explanation}` : ""}
                    </p>
                  )}
                </div>
              )
            })}

            {view.status === "IN_PROGRESS" && (
              <div>
                <Button disabled={busy} onClick={() => void submit()}>
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Send className="size-4" aria-hidden="true" />
                  )}
                  <span className="ml-1">Submit quiz</span>
                </Button>
              </div>
            )}
          </div>
        </SectionCard>
      )}
    </div>
  )
}

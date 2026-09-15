import type { Metadata } from "next"
import Link from "next/link"
import { CircleCheck, ClipboardCheck, Flag, Timer, Trophy, type LucideIcon } from "lucide-react"

import { PageHeader } from "@/components/shell/page-header"
import { Button, buttonVariants } from "@/components/ui/button"
import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { MetricRow } from "@/components/ui/metric-row"
import { ProgressBar } from "../_lib/progress-bar"
import { SectionCard } from "@/components/ui/section-card"
import { StatCard } from "@/components/ui/stat-card"
import { StatusPill, type StatusKey } from "@/components/ui/status-pill"
import {
  MOCK_ASSESSMENTS,
  MOCK_COURSE,
  MOCK_MY_IN_PROGRESS_ATTEMPT,
  MOCK_MY_IN_PROGRESS_QUESTIONS,
  MOCK_MY_QUIZ_ATTEMPTS,
  MOCK_MY_QUIZ_RESPONSES,
  MOCK_MY_QUIZ_RESPONSE_TOTAL,
  MOCK_QUIZ_QUESTIONS,
  formatDateTime,
  formatDuration,
  formatPercent,
  formatPoints,
  type QuizQuestion,
  type QuizResponseOutcome,
  type QuizResponse,
} from "@/lib/mock"

import { InProgressQuestion } from "./in-progress-question"

export const metadata: Metadata = {
  title: "Quizzes",
}

const KPI_ICONS: Record<string, LucideIcon> = {
  attempts: ClipboardCheck,
  best: Trophy,
  time: Timer,
  correct: CircleCheck,
}

const OUTCOME_STATUS: Record<QuizResponseOutcome, { status: StatusKey; label: string }> = {
  CORRECT: { status: "graded", label: "Correct" },
  PARTIALLY_CORRECT: { status: "needs-review", label: "Partly correct" },
  INCORRECT: { status: "failed", label: "Incorrect" },
  UNANSWERED: { status: "draft", label: "Not answered" },
}

/** "A — x = 5 · B — x = 3", or a dash when nothing was chosen. */
function optionSummary(question: QuizQuestion, optionIds: string[]): string {
  const chosen = question.options
    .filter((option) => optionIds.includes(option.id))
    .map((option) => `${option.label} — ${option.text}`)
  return chosen.length === 0 ? "—" : chosen.join(" · ")
}

type AttemptRow = {
  id: string
  label: string
  detail: string
  state: StatusKey
  stateLabel?: string
  score: string
  submitted: string
  time: string
}

type ResponseRow = {
  id: string
  question: QuizQuestion
  outcome: QuizResponseOutcome
  yourAnswer: string
  correctAnswer: string
  pointsAwarded: number
  maxPoints: number
  explanation: string
}

export default function StudentQuizzesPage() {
  const gradedAttempt = MOCK_MY_QUIZ_ATTEMPTS[0]
  const sitting = MOCK_MY_IN_PROGRESS_ATTEMPT
  const sittingQuestions = MOCK_MY_IN_PROGRESS_QUESTIONS
  const unreleasedQuizzes = MOCK_ASSESSMENTS.filter(
    (assessment) => assessment.kind === "QUIZ" && assessment.state === "draft",
  )

  // ------------------------------------------------------------------ KPIs
  const gradedTimeMs = MOCK_MY_QUIZ_ATTEMPTS.reduce(
    (total, attempt) => total + (attempt.timeSpentMs ?? 0),
    0,
  )
  const correctCount = MOCK_MY_QUIZ_RESPONSES.filter(
    (response) => response.outcome === "CORRECT",
  ).length
  const partialCount = MOCK_MY_QUIZ_RESPONSES.filter(
    (response) => response.outcome === "PARTIALLY_CORRECT",
  ).length

  const kpis = [
    {
      id: "attempts",
      label: "Attempts used",
      value: String(MOCK_MY_QUIZ_ATTEMPTS.length + 1),
      hint: "1 graded · 1 practice retake in progress",
    },
    {
      id: "best",
      label: "Best score",
      value: formatPoints(gradedAttempt.score, gradedAttempt.maxScore),
      hint: `${formatPercent(((gradedAttempt.score ?? 0) / gradedAttempt.maxScore) * 100)} on Quiz 1`,
    },
    {
      id: "time",
      label: "Time spent",
      value: formatDuration(gradedTimeMs + sitting.timeSpentMs),
      hint: "Includes the sitting in progress",
    },
    {
      id: "correct",
      label: "Questions correct",
      value: `${correctCount} of ${MOCK_MY_QUIZ_RESPONSES.length}`,
      hint: `${partialCount} answered part-correct`,
    },
  ]

  // -------------------------------------------------------- in-progress state
  const answeredCount = sitting.answeredQuestionIds.length
  const hasQuestions = sittingQuestions.length > 0
  const currentQuestion =
    sittingQuestions.find((question) => !sitting.answeredQuestionIds.includes(question.id)) ??
    sittingQuestions[0]

  // --------------------------------------------------------------- attempts
  const attemptRows: AttemptRow[] = [
    {
      id: sitting.id,
      label: `${sitting.title} · practice retake ${sitting.attemptNumber}`,
      detail: `Adaptive retake · ${sittingQuestions.length} questions`,
      state: "in-progress",
      stateLabel: `In progress · ${answeredCount} of ${sittingQuestions.length} answered`,
      score: formatPoints(null, sitting.maxScore),
      submitted: "Not submitted yet",
      time: formatDuration(sitting.timeSpentMs),
    },
    ...MOCK_MY_QUIZ_ATTEMPTS.map<AttemptRow>((attempt) => ({
      id: attempt.id,
      label: `${attempt.assessmentTitle} · attempt ${attempt.attemptNumber}`,
      detail: "Graded sitting",
      state: attempt.state,
      score: formatPoints(attempt.score, attempt.maxScore),
      submitted:
        attempt.submittedAt === null ? "Not submitted" : formatDateTime(attempt.submittedAt),
      time: formatDuration(attempt.timeSpentMs),
    })),
  ]

  const attemptColumns: Column<AttemptRow>[] = [
    {
      id: "attempt",
      header: "Attempt",
      cell: (row) => (
        <div className="min-w-0">
          <p className="font-medium">{row.label}</p>
          <p className="text-xs text-muted-foreground">{row.detail}</p>
        </div>
      ),
    },
    {
      id: "state",
      header: "State",
      cell: (row) => <StatusPill status={row.state} label={row.stateLabel} dot />,
    },
    {
      id: "score",
      header: "Score",
      align: "right",
      cell: (row) => <span className="font-mono tabular-nums">{row.score}</span>,
    },
    {
      id: "submitted",
      header: "Submitted",
      hideBelow: "lg",
      cell: (row) => <span className="font-mono text-xs tabular-nums">{row.submitted}</span>,
    },
    {
      id: "time",
      header: "Time spent",
      align: "right",
      hideBelow: "sm",
      cell: (row) => <span className="font-mono tabular-nums">{row.time}</span>,
    },
  ]

  // ------------------------------------------------- post-submission results
  const responseRows: ResponseRow[] = MOCK_QUIZ_QUESTIONS.map((question) => {
    const response: QuizResponse | undefined = MOCK_MY_QUIZ_RESPONSES.find(
      (entry) => entry.questionId === question.id,
    )
    return {
      id: question.id,
      question,
      // A question with no response record was never attempted: it is reported
      // as "not answered", never as incorrect.
      outcome: response?.outcome ?? "UNANSWERED",
      yourAnswer: optionSummary(question, response?.selectedOptionIds ?? []),
      correctAnswer: optionSummary(
        question,
        question.options.filter((option) => option.isCorrect).map((option) => option.id),
      ),
      pointsAwarded: response?.pointsAwarded ?? 0,
      maxPoints: question.points,
      explanation: question.explanation,
    }
  })

  const responseColumns: Column<ResponseRow>[] = [
    {
      id: "question",
      header: "Question",
      className: "max-w-96 whitespace-normal",
      cell: (row) => (
        <div className="min-w-0 space-y-1">
          <p className="font-medium text-pretty">{row.question.prompt}</p>
          <p className="text-xs text-muted-foreground">
            Q{row.question.order} · {row.question.topic}
          </p>
          <p className="text-xs text-muted-foreground text-pretty">
            <span className="font-medium text-foreground">Explanation: </span>
            {row.explanation}
          </p>
        </div>
      ),
    },
    {
      id: "your-answer",
      header: "Your answer",
      className: "max-w-72 whitespace-normal",
      cell: (row) => (
        <span
          className={row.outcome === "UNANSWERED" ? "text-xs text-muted-foreground" : "text-xs"}
        >
          {row.yourAnswer}
        </span>
      ),
    },
    {
      id: "correct-answer",
      header: "Correct answer",
      className: "max-w-72 whitespace-normal",
      cell: (row) => <span className="text-xs">{row.correctAnswer}</span>,
    },
    {
      id: "result",
      header: "Result",
      cell: (row) => (
        <StatusPill
          status={OUTCOME_STATUS[row.outcome].status}
          label={OUTCOME_STATUS[row.outcome].label}
          dot
        />
      ),
    },
    {
      id: "points",
      header: "Points",
      align: "right",
      hideBelow: "sm",
      cell: (row) => (
        <span className="font-mono tabular-nums">
          {formatPoints(row.pointsAwarded, row.maxPoints)}
        </span>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Mockup index", href: "/mockup" },
          { label: "Student workspace", href: "/mockup/student" },
          { label: "Quizzes" },
        ]}
        eyebrow={`${MOCK_COURSE.code} · ${MOCK_COURSE.term}`}
        title="Quizzes"
        description="Attempts, per-question feedback, and explanations."
        actions={
          <>
            <Button type="button">Resume practice attempt</Button>
            <Link href="/mockup/student/retake" className={buttonVariants({ variant: "outline" })}>
              Start retake
            </Link>
          </>
        }
      />

      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map((kpi) => (
            <StatCard
              key={kpi.id}
              label={kpi.label}
              value={kpi.value}
              hint={kpi.hint}
              icon={KPI_ICONS[kpi.id]}
            />
          ))}
        </div>

        <SectionCard
          title={`In progress — ${sitting.title} (practice retake)`}
          description="You have not submitted this sitting, so this card holds only the question, the options and your own draft selections. Your answer, the correct answer and the explanation appear on the results card below once you submit."
          action={<StatusPill status="in-progress" label="Answers hidden until submission" />}
        >
          <div className="space-y-4">
            <div className="space-y-0.5">
              <MetricRow
                label="Attempt"
                value={`Practice retake ${sitting.attemptNumber}`}
                hint="Adaptive practice does not use up a graded attempt"
              />
              <MetricRow
                label="Time remaining"
                value={
                  <span className="font-mono tabular-nums">
                    {formatDuration(sitting.timeRemainingMs)}
                  </span>
                }
                hint={`Started ${formatDateTime(sitting.startedAt)} · closes ${formatDateTime(sitting.expiresAt)}`}
              />
              <MetricRow
                label="Progress"
                value={
                  <span className="font-mono tabular-nums">
                    {answeredCount} of {sittingQuestions.length} answered
                  </span>
                }
                hint={
                  sitting.flaggedQuestionIds.length === 0
                    ? "No questions flagged"
                    : `${sitting.flaggedQuestionIds.length} flagged to revisit`
                }
              />
            </div>

            <ProgressBar
              value={answeredCount}
              max={sittingQuestions.length}
              label="Questions answered"
              valueText={`${answeredCount} / ${sittingQuestions.length}`}
            />

            <ol className="flex flex-wrap gap-2">
              {sittingQuestions.map((question, index) => {
                const answered = sitting.answeredQuestionIds.includes(question.id)
                const flagged = sitting.flaggedQuestionIds.includes(question.id)
                return (
                  <li
                    key={question.id}
                    className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5"
                  >
                    <span className="font-mono text-xs tabular-nums">Q{index + 1}</span>
                    <StatusPill
                      status={answered ? "submitted" : "queued"}
                      label={
                        answered
                          ? "Answered"
                          : hasQuestions && currentQuestion.id === question.id
                            ? "Current"
                            : "Not answered"
                      }
                      className="text-[0.65rem]"
                    />
                    {flagged && (
                      <>
                        <Flag className="size-3.5 text-muted-foreground" aria-hidden="true" />
                        <span className="sr-only">Flagged to revisit</span>
                      </>
                    )}
                  </li>
                )
              })}
            </ol>

            {!hasQuestions ? (
              <EmptyState
                title="Nothing to answer"
                description="This sitting has no questions attached to it yet."
              />
            ) : (
              /*
               * The question is mapped explicitly so only the fields a student
               * may see before submitting reach the client component: the answer
               * key (`isCorrect`), the distractor rationales and the explanation
               * are all dropped here.
               */
              <InProgressQuestion
                question={{
                  id: currentQuestion.id,
                  order: currentQuestion.order,
                  prompt: currentQuestion.prompt,
                  type: currentQuestion.type,
                  points: currentQuestion.points,
                  topic: currentQuestion.topic,
                  options: currentQuestion.options.map((option) => ({
                    id: option.id,
                    label: option.label,
                    text: option.text,
                  })),
                }}
                selectedOptionIds={sitting.selections[currentQuestion.id] ?? []}
                flagged={sitting.flaggedQuestionIds.includes(currentQuestion.id)}
              />
            )}

            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
              <Button type="button" disabled>
                Submit attempt
              </Button>
              <p className="text-xs text-muted-foreground">
                Mockup only — submitting is disabled, so the results card below stays a finished
                example of the post-submission state.
              </p>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Attempts"
          description={
            unreleasedQuizzes.length === 0
              ? "Every sitting of a quiz, graded and in progress."
              : `Every sitting of a quiz, graded and in progress. ${unreleasedQuizzes
                  .map((quiz) => quiz.title)
                  .join(", ")} has not been released to students yet, so no sitting exists for it.`
          }
        >
          <DataTable
            caption="Your quiz attempts"
            columns={attemptColumns}
            rows={attemptRows}
            getRowId={(row) => row.id}
            empty={
              <EmptyState
                size="sm"
                title="No attempts yet"
                description="A sitting appears here as soon as you start one."
              />
            }
          />
        </SectionCard>

        <SectionCard
          title={`Per-question results — ${gradedAttempt.assessmentTitle} (submitted)`}
          description="This card only exists after a sitting is submitted. It shows your answer, the correct answer, the worked explanation, and the points awarded for each question."
          action={<StatusPill status="published" label="Released to you" />}
          footer={
            <div className="w-full">
              <MetricRow
                label="Points from these results"
                value={
                  <span className="font-mono tabular-nums">
                    {formatPoints(MOCK_MY_QUIZ_RESPONSE_TOTAL, gradedAttempt.maxScore)}
                  </span>
                }
                hint={`Released sitting score ${formatPoints(
                  gradedAttempt.score,
                  gradedAttempt.maxScore,
                )} — the two agree because the points are derived from these answers`}
              />
            </div>
          }
        >
          <DataTable
            caption="Per-question results for Quiz 1"
            columns={responseColumns}
            rows={responseRows}
            getRowId={(row) => row.id}
            empty={
              <EmptyState
                size="sm"
                title="No results yet"
                description="Nothing has been submitted for this sitting, so no answer key is shown."
              />
            }
          />
        </SectionCard>
      </div>
    </>
  )
}

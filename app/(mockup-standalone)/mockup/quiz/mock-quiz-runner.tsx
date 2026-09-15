"use client"

import Link from "next/link"
import { useState } from "react"
import { ArrowLeft, ArrowRight, ClipboardCheck, Clock, Flag } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ProgressBar } from "@/components/ui/progress-bar"
import { SectionCard } from "@/components/ui/section-card"
import { StatusPill } from "@/components/ui/status-pill"
import {
  MOCK_ASSESSMENTS,
  MOCK_COURSE,
  MOCK_QUIZ_QUESTIONS,
  formatDuration,
  formatRelativeTime,
} from "@/lib/mock"
import { cn } from "@/lib/utils"

/** Published questions only — a draft item is not part of a live attempt. */
const QUESTIONS = MOCK_QUIZ_QUESTIONS.filter((question) => question.state === "published").sort(
  (a, b) => a.order - b.order,
)

const ASSESSMENT = MOCK_ASSESSMENTS.find((assessment) => assessment.id === "asm_quiz1")

/**
 * A fixed attempt clock. The mockup never reads `Date.now()` in render: the
 * timer is derived from constants so the server and the browser agree.
 */
const TIME_LIMIT_MS = 45 * 60 * 1000
const ELAPSED_MS = 12 * 60 * 1000
const LAST_SAVED_AT = "2026-09-15T13:24:00.000Z"

const LOW_TIME_MS = 5 * 60 * 1000

/**
 * The standalone quiz-taking screen.
 *
 * Focused by design: no sidebar, no course navigation, one question at a time.
 * The pre-submission state is honest — selected options are shown, but no
 * correctness, marks, or explanations are revealed anywhere on the page.
 */
export function MockQuizRunner() {
  const [answers, setAnswers] = useState<Record<string, string[]>>({})
  const [flagged, setFlagged] = useState<Record<string, boolean>>({})
  const [currentIndex, setCurrentIndex] = useState(0)
  const [submitted, setSubmitted] = useState(false)

  const total = QUESTIONS.length
  const question = QUESTIONS[currentIndex]
  const isMultiple = question.type === "MULTIPLE_SELECT"
  const selected = answers[question.id] ?? []
  const answeredCount = QUESTIONS.filter((item) => (answers[item.id]?.length ?? 0) > 0).length
  const remainingMs = TIME_LIMIT_MS - ELAPSED_MS
  const isFlagged = Boolean(flagged[question.id])

  function toggleOption(optionId: string) {
    setAnswers((previous) => {
      const current = previous[question.id] ?? []
      if (isMultiple) {
        return {
          ...previous,
          [question.id]: current.includes(optionId)
            ? current.filter((id) => id !== optionId)
            : [...current, optionId],
        }
      }
      return { ...previous, [question.id]: [optionId] }
    })
  }

  function goTo(index: number) {
    setCurrentIndex(Math.min(Math.max(index, 0), total - 1))
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4 sm:px-6 lg:px-8">
          <Link
            href="/mockup/student/quizzes"
            className="flex shrink-0 items-center gap-1.5 rounded-lg px-1.5 py-1 text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Quizzes</span>
            <span className="sr-only sm:hidden">Leave the quiz and return to quizzes</span>
          </Link>

          <div className="min-w-0">
            <h1 className="truncate text-sm font-medium">
              {ASSESSMENT?.title ?? "Quiz 1 — Linear Equations"}
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              {MOCK_COURSE.code} · {MOCK_COURSE.section} · attempt 1
            </p>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-3">
            <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
              <Clock className="size-3.5" aria-hidden="true" />
              {formatDuration(remainingMs)} remaining
            </span>
            <StatusPill status="in-progress" dot label="In progress" />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        <p className="mb-6 rounded-lg border border-dashed border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          Mockup of the standalone quiz screen. Answers stay on this page, and no correctness or
          marks are revealed before submission.
        </p>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <SectionCard
            title={`Question ${question.order} of ${total}`}
            description={`${question.points} point${question.points === 1 ? "" : "s"} · ${question.topic}`}
            action={
              <Button
                type="button"
                variant={isFlagged ? "secondary" : "outline"}
                size="sm"
                aria-pressed={isFlagged}
                onClick={() =>
                  setFlagged((previous) => ({ ...previous, [question.id]: !previous[question.id] }))
                }
              >
                <Flag className="size-3.5" aria-hidden="true" />
                {isFlagged ? "Flagged" : "Flag for review"}
              </Button>
            }
            footer={
              <div className="flex w-full flex-wrap items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => goTo(currentIndex - 1)}
                  disabled={currentIndex === 0}
                >
                  <ArrowLeft className="size-4" aria-hidden="true" />
                  Previous
                </Button>
                <p className="order-last w-full text-xs text-muted-foreground sm:order-none sm:w-auto">
                  {isMultiple ? "Select every option that applies." : "Select one option."}
                </p>
                {currentIndex < total - 1 ? (
                  <Button type="button" onClick={() => goTo(currentIndex + 1)}>
                    Next
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Button>
                ) : (
                  <Button type="button" onClick={() => setSubmitted(true)}>
                    <ClipboardCheck className="size-4" aria-hidden="true" />
                    Review and submit
                  </Button>
                )}
              </div>
            }
          >
            <fieldset className="space-y-4">
              <legend className="text-lg leading-snug font-medium text-balance">
                {question.prompt}
              </legend>
              <ul className="space-y-2">
                {question.options.map((option) => {
                  const isSelected = selected.includes(option.id)
                  return (
                    <li key={option.id}>
                      <label
                        className={cn(
                          "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                          isSelected
                            ? "border-primary bg-primary/5"
                            : "border-border hover:bg-muted/50",
                        )}
                      >
                        <input
                          type={isMultiple ? "checkbox" : "radio"}
                          name={question.id}
                          value={option.id}
                          checked={isSelected}
                          onChange={() => toggleOption(option.id)}
                          className="mt-0.5 size-4 shrink-0 accent-primary"
                        />
                        <span className="font-mono text-xs text-muted-foreground">
                          {option.label}
                        </span>
                        <span className="text-sm">{option.text}</span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            </fieldset>
          </SectionCard>

          <aside aria-label="Attempt summary" className="space-y-6">
            <SectionCard title="Attempt" description={`${answeredCount} of ${total} answered`}>
              <div className="space-y-4">
                <ProgressBar
                  label="Answered"
                  value={answeredCount}
                  max={total}
                  valueText={`${answeredCount} of ${total}`}
                />
                <ProgressBar
                  label="Time elapsed"
                  value={ELAPSED_MS}
                  max={TIME_LIMIT_MS}
                  tone={remainingMs <= LOW_TIME_MS ? "warning" : "primary"}
                  valueText={`${formatDuration(remainingMs)} left`}
                />

                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="size-3.5" aria-hidden="true" />
                  Autosaved {formatRelativeTime(LAST_SAVED_AT)}
                </p>

                <nav aria-label="Question navigator" className="space-y-2">
                  <ol className="grid grid-cols-6 gap-2">
                    {QUESTIONS.map((item, index) => {
                      const isAnswered = (answers[item.id]?.length ?? 0) > 0
                      const itemFlagged = Boolean(flagged[item.id])
                      const isCurrent = index === currentIndex
                      const state = [
                        `question ${item.order}`,
                        isAnswered ? "answered" : "not answered",
                        itemFlagged ? "flagged" : null,
                        isCurrent ? "current" : null,
                      ]
                        .filter(Boolean)
                        .join(", ")
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => goTo(index)}
                            aria-current={isCurrent ? "true" : undefined}
                            aria-label={state}
                            title={state}
                            className={cn(
                              "flex size-9 items-center justify-center rounded-lg border font-mono text-sm tabular-nums transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                              isCurrent
                                ? "border-primary bg-primary text-primary-foreground"
                                : isAnswered
                                  ? "border-border bg-muted text-foreground"
                                  : "border-dashed border-border text-muted-foreground",
                              itemFlagged &&
                                !isCurrent &&
                                "border-warning text-warning-foreground dark:text-warning",
                            )}
                          >
                            {item.order}
                          </button>
                        </li>
                      )
                    })}
                  </ol>
                  <p className="text-xs text-muted-foreground">
                    Solid tiles are answered; dashed tiles are not. A flagged question has an amber
                    outline.
                  </p>
                </nav>
              </div>
            </SectionCard>

            <SectionCard title="Submit">
              {submitted ? (
                <div className="space-y-3">
                  <StatusPill status="submitted" dot label="Submitted" />
                  <p className="text-sm text-muted-foreground text-pretty">
                    Your answers would now be locked and sent for marking. This mockup reveals no
                    correctness: marks and feedback appear once the teacher publishes results.
                  </p>
                  <Button type="button" variant="outline" onClick={() => setSubmitted(false)}>
                    Review answers
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground text-pretty">
                    Answers are kept as a draft until you submit. Nothing is graded before then.
                  </p>
                  <Button type="button" className="w-full" onClick={() => setSubmitted(true)}>
                    Submit attempt
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    {answeredCount === total
                      ? "Every question has an answer."
                      : `${total - answeredCount} question${total - answeredCount === 1 ? "" : "s"} still unanswered.`}
                  </p>
                </div>
              )}
            </SectionCard>
          </aside>
        </div>
      </main>
    </div>
  )
}

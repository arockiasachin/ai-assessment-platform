"use client"

import { useState } from "react"
import { CheckCircle2, ListChecks, Loader2, XCircle } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatDateTime, trimNumber } from "@/lib/format"

/**
 * Per-question quiz evidence for the review queue (TN-52).
 *
 * `GET /api/teacher/quiz-attempts/[attemptId]` returns each question's outcome **with the answer
 * key** and its docstring says it exists "so they can grade" — but no screen called it. This is
 * that caller: it finds the student's latest graded attempt for the assessment, then shows what
 * they answered, what was correct, and what the auto-scorer awarded, so a teacher reviewing an
 * auto-scored quiz can judge it rather than trusting a single aggregate score.
 *
 * Two requests, only on demand. A queue of twenty items makes none until a teacher opens one.
 */

type AttemptSummary = {
  id: string
  studentId: string
  attemptNumber: number
  score: number | null
  maxScore: number | null
  submittedAt: string | null
  isLate: boolean
}

type AttemptResponse = {
  questionId: string
  prompt: string
  selectedOptionId: string | null
  selectedText: string | null
  answerText: string | null
  isCorrect: boolean | null
  pointsAwarded: number | null
  maxPoints: number
  rationale: string | null
  needsManualReview: boolean
  correctOptionId: string
  correctText: string
  explanation: string | null
}

type AttemptDetail = {
  attempt: AttemptSummary
  responses: AttemptResponse[]
}

export function TeacherQuizAttemptEvidence({
  assessmentId,
  studentId,
}: {
  assessmentId: string
  studentId: string
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [detail, setDetail] = useState<AttemptDetail | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function toggle() {
    const next = !open
    setOpen(next)
    if (!next || loaded) return
    setLoading(true)
    setError(null)
    try {
      const listResponse = await fetch(
        `/api/teacher/quiz-attempts?assessmentId=${encodeURIComponent(assessmentId)}`,
        { cache: "no-store" },
      )
      const listData = (await listResponse.json()) as {
        attempts?: AttemptSummary[]
        message?: string
      }
      if (!listResponse.ok) {
        setError(listData.message ?? "Unable to load the attempt.")
        return
      }
      const latest = (listData.attempts ?? [])
        .filter((attempt) => attempt.studentId === studentId)
        .sort((a, b) => b.attemptNumber - a.attemptNumber)[0]
      if (!latest) {
        setNote("No graded quiz attempt is recorded for this student on this assessment.")
        setLoaded(true)
        return
      }

      const detailResponse = await fetch(`/api/teacher/quiz-attempts/${latest.id}`, {
        cache: "no-store",
      })
      const detailData = (await detailResponse.json()) as {
        detail?: AttemptDetail
        message?: string
      }
      if (!detailResponse.ok || !detailData.detail) {
        setError(detailData.message ?? "Unable to load the attempt.")
        return
      }
      setDetail(detailData.detail)
      setLoaded(true)
    } catch {
      setError("Unable to load the attempt.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-md border border-border/70 bg-background">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => void toggle()}
        aria-expanded={open}
        className="w-full justify-start"
      >
        {loading ? <Loader2 className="animate-spin" /> : <ListChecks />}
        {open ? "Hide attempt evidence" : "Show attempt evidence (answer key)"}
      </Button>

      {open && (
        <div className="space-y-3 border-t border-border/60 p-3">
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {!error && loading && <p className="text-sm text-muted-foreground">Loading attempt…</p>}
          {!error && !loading && note && <p className="text-sm text-muted-foreground">{note}</p>}
          {!error && !loading && detail && (
            <>
              <p className="text-xs text-muted-foreground">
                Attempt {detail.attempt.attemptNumber} ·{" "}
                {detail.attempt.score !== null && detail.attempt.maxScore !== null
                  ? `${trimNumber(detail.attempt.score)} / ${trimNumber(detail.attempt.maxScore)}`
                  : "not scored"}{" "}
                ·{" "}
                {detail.attempt.submittedAt
                  ? `submitted ${formatDateTime(detail.attempt.submittedAt)}`
                  : "not submitted"}
                {detail.attempt.isLate ? " · late" : ""}
              </p>
              <ul className="space-y-2">
                {detail.responses.map((response, index) => (
                  <li
                    key={response.questionId}
                    className="rounded border border-border/70 bg-muted/20 p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="text-sm font-medium">
                        {index + 1}. {response.prompt}
                      </p>
                      <span className="flex items-center gap-1.5">
                        {response.isCorrect === true && (
                          <Badge
                            variant="outline"
                            className="border-emerald-500/30 text-emerald-700 dark:text-emerald-400"
                          >
                            <CheckCircle2 /> Correct
                          </Badge>
                        )}
                        {response.isCorrect === false && (
                          <Badge
                            variant="outline"
                            className="border-destructive/30 text-destructive"
                          >
                            <XCircle /> Incorrect
                          </Badge>
                        )}
                        {response.needsManualReview && (
                          <Badge variant="secondary">Needs review</Badge>
                        )}
                        <Badge variant="outline">
                          {trimNumber(response.pointsAwarded ?? 0)} /{" "}
                          {trimNumber(response.maxPoints)}
                        </Badge>
                      </span>
                    </div>
                    <p className="mt-2 text-sm">
                      <span className="text-muted-foreground">Answered: </span>
                      {response.selectedText ?? response.answerText?.trim() ?? (
                        <span className="text-muted-foreground">no answer</span>
                      )}
                    </p>
                    <p className="text-sm">
                      <span className="text-muted-foreground">Correct: </span>
                      {response.correctText || <span className="text-muted-foreground">—</span>}
                    </p>
                    {response.explanation && (
                      <p className="mt-1 text-xs text-muted-foreground">{response.explanation}</p>
                    )}
                    {response.rationale && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Grader: {response.rationale}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}

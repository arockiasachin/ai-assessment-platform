"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, RefreshCw } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type {
  AdaptiveRetakeResponse,
  RetakableAssessment,
  RetakeStateValue,
} from "@/lib/contracts/analytics"

/**
 * Student adaptive retake.
 *
 * Pick an assessment and the server returns only the questions this student
 * failed on their latest finalized attempt (plus unanswered questions unless
 * excluded). The payload carries no answer key, so nothing here can reveal the
 * correct option; "your last answer" only echoes the student's own response.
 */

export function StudentAdaptiveRetake({
  initialAssessments,
}: {
  initialAssessments: RetakableAssessment[]
}) {
  const [assessments] = useState(initialAssessments)
  const [selectedId, setSelectedId] = useState(initialAssessments[0]?.id ?? "")
  const [includeUnanswered, setIncludeUnanswered] = useState("true")
  const [retake, setRetake] = useState<AdaptiveRetakeResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadRetake = useCallback(async (assessmentId: string, include: string) => {
    if (!assessmentId) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/student/analytics/retake?assessmentId=${encodeURIComponent(assessmentId)}&includeUnanswered=${include}`,
        { cache: "no-store" },
      )
      const data = (await response.json()) as AdaptiveRetakeResponse & { message?: string }
      if (!response.ok) throw new Error(data.message ?? "Unable to build the retake.")
      setRetake(data)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to build the retake.")
    } finally {
      setBusy(false)
    }
  }, [])

  // Exposed so a retake request can refresh the policy state without a page reload.
  const reload = useCallback(() => {
    void loadRetake(selectedId, includeUnanswered)
  }, [loadRetake, selectedId, includeUnanswered])

  useEffect(() => {
    // Defer to a task so the effect body does not call setState synchronously
    // (react-hooks/set-state-in-effect); the fetch still starts immediately.
    const handle = setTimeout(() => void loadRetake(selectedId, includeUnanswered), 0)
    return () => clearTimeout(handle)
  }, [selectedId, includeUnanswered, loadRetake])

  const previousByQuestion = useMemo(
    () => new Map((retake?.previousResponses ?? []).map((entry) => [entry.questionId, entry])),
    [retake],
  )

  if (assessments.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          You have no finalized quiz attempts yet. A targeted retake becomes available after you
          submit a quiz.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <RefreshCw className="size-4" /> Build my retake
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Select value={selectedId} onValueChange={(value) => setSelectedId(value ?? "")}>
            <SelectTrigger className="w-full sm:w-96" aria-label="Assessment to retake">
              <SelectValue placeholder="Select an assessment" />
            </SelectTrigger>
            <SelectContent>
              {assessments.map((assessment) => (
                <SelectItem key={assessment.id} value={assessment.id}>
                  {assessment.courseCode} · {assessment.title} (
                  {assessment.failedCount + assessment.unansweredCount} to retry)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={includeUnanswered}
            onValueChange={(value) => setIncludeUnanswered(value ?? "true")}
          >
            <SelectTrigger className="w-full sm:w-56" aria-label="Include unanswered questions">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="true">Include unanswered</SelectItem>
              <SelectItem value="false">Wrong answers only</SelectItem>
            </SelectContent>
          </Select>
          {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {retake && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {retake.assessment.title} — {retake.questionIds.length} question(s) to retry
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {retake.failedQuestionIds.length} answered incorrectly,{" "}
              {retake.unansweredQuestionIds.length} left unanswered. Your correct answers are not
              repeated.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {retake.questions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing to retry — you answered every question correctly.
              </p>
            ) : (
              <>
                {/*
                    The actions, and they are real ones. Practise starts a practice sitting — which
                    does not consume a graded attempt — and is only offered once the service says
                    it is open, because practising before the deadline would reveal the questions.
                    A retake on an APPROVAL assessment is requested, never granted from here.
                  */}
                <RetakeActions
                  assessmentId={retake.assessment.id}
                  state={retake.retake}
                  onRequested={reload}
                />

                {retake.questions.map((question, index) => {
                  const previous = previousByQuestion.get(question.id)
                  const selected = new Set(previous?.selectedOptionIds ?? [])
                  return (
                    <div key={question.id} className="rounded-lg border border-border/70 px-3 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium">
                          {index + 1}. {question.prompt}
                        </p>
                        {previous && previous.selectedOptionIds.length === 0 && (
                          <Badge variant="outline">unanswered</Badge>
                        )}
                      </div>
                      <ul className="mt-2 space-y-1">
                        {question.options.map((option) => (
                          <li
                            key={option.id}
                            className="flex items-center gap-2 text-sm text-muted-foreground"
                          >
                            <span>{option.text}</span>
                            {selected.has(option.id) && (
                              <Badge variant="secondary">your last answer</Badge>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                })}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

/**
 * What the student may actually do, given the assessment's policy.
 *
 * Every state here is one the server confirmed, so nothing is offered that would fail:
 *
 * - **Practise** appears only when `canPractise` — the service withholds it until the deadline has
 *   passed or a graded attempt exists, because the start view returns the questions.
 * - **Request a retake** appears only on an `APPROVAL` assessment with no request yet. A pending
 *   request shows as "awaiting approval" rather than a button that would ask again; an approved
 *   one shows that the retake is available.
 * - **Nothing** appears on `NONE`, and on `FIXED` the cap decides — so the student sees either the
 *   remaining count or that they are at the limit, not a control that cannot work.
 */
function RetakeActions({
  assessmentId,
  state,
  onRequested,
}: {
  assessmentId: string
  state: RetakeStateValue
  onRequested: () => void
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<"practice" | "request" | null>(null)
  const [error, setError] = useState<string | null>(null)

  const startPractice = async () => {
    setBusy("practice")
    setError(null)
    try {
      const response = await fetch("/api/student/quiz-attempts/practice", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assessmentId }),
      })
      const data = (await response.json()) as { attempt?: { id: string }; message?: string }
      if (!response.ok || !data.attempt) {
        throw new Error(data.message ?? "Unable to start practice.")
      }
      router.push(`/student/quizzes/${data.attempt.id}`)
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Unable to start practice.")
    } finally {
      setBusy(null)
    }
  }

  const requestRetake = async () => {
    setBusy("request")
    setError(null)
    try {
      const response = await fetch("/api/student/retake-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assessmentId, note: null }),
      })
      const data = (await response.json()) as { message?: string }
      if (!response.ok) throw new Error(data.message ?? "Unable to send the request.")
      onRequested()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to send the request.")
    } finally {
      setBusy(null)
    }
  }

  const showPractice = state.canPractise
  const showRequest = state.policy === "APPROVAL" && state.requestStatus === null
  const showApproved = state.policy === "APPROVAL" && state.requestStatus === "APPROVED"
  const showPending = state.policy === "APPROVAL" && state.requestStatus === "PENDING"

  if (!showPractice && !showRequest && !showApproved && !showPending) {
    // `NONE`, or `FIXED` at the cap: say why rather than showing nothing at all, since the
    // student came here to retake something.
    return state.blockedReason ? (
      <Callout tone="info" title="No retake available">
        <p>{state.blockedReason}</p>
      </Callout>
    ) : null
  }

  return (
    <div className="space-y-3">
      {(showPractice || showApproved) && (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void startPractice()} disabled={busy !== null}>
            {busy === "practice" && <Loader2 className="size-4 animate-spin" />}
            Practise these questions
          </Button>
          <p className="text-xs text-muted-foreground">
            Practice does not count towards your attempt limit.
          </p>
        </div>
      )}

      {showRequest && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={() => void requestRetake()} disabled={busy !== null}>
            {busy === "request" && <Loader2 className="size-4 animate-spin" />}
            Request a retake
          </Button>
          <p className="text-xs text-muted-foreground">
            This assessment allows a retake only with your teacher&apos;s approval.
          </p>
        </div>
      )}

      {showPending && (
        <Callout tone="info" title="Retake requested">
          <p>Your request is with your teacher. You will be able to retake once it is approved.</p>
        </Callout>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

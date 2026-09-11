"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2, RefreshCw } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { AdaptiveRetakeResponse, RetakableAssessment } from "@/lib/contracts/analytics"

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
            <SelectTrigger className="w-full sm:w-96">
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
            <SelectTrigger className="w-full sm:w-56">
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
              retake.questions.map((question, index) => {
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
              })
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

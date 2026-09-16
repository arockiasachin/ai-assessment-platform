"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Flag, RefreshCw, SlidersHorizontal, Sparkles, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { StatusPill } from "@/components/ui/status-pill"
import { GRADE_SOURCE_LABEL, REVIEW_STATE_LABEL, REVIEW_STATE_TO_STATUS } from "@/lib/labels"
import type { EvaluationCandidate, ReviewQueueItem } from "@/lib/rubric-grading/contracts"

/**
 * Teacher review queue for descriptive grading.
 *
 * AI never publishes here: the only controls are accept, override (with a
 * reason), reject, and flag. The server enforces that too, so this component is
 * presentation plus a thin fetch wrapper. Data arrives from a Server Component
 * and is refreshed with `router.refresh()` after every decision.
 */

type Decision =
  | { action: "accept" }
  | { action: "reject"; reason?: string }
  | { action: "flag"; notes?: string }
  | { action: "override"; points: number; reason: string }

// The app themes via `prefers-color-scheme`, so the `.dark`-scoped Tailwind
// `dark:` variant never activates; the explicit media variant keeps this chip
// readable on a dark page.
function confidenceTone(confidence: number): string {
  return confidence < 0.6
    ? "border-destructive/30 bg-destructive/10 text-destructive"
    : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
}

export function TeacherReviewQueue({
  items,
  candidates,
}: {
  items: ReviewQueueItem[]
  candidates: EvaluationCandidate[]
}) {
  const router = useRouter()
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [overrideOpen, setOverrideOpen] = useState<Record<string, boolean>>({})
  const [overridePoints, setOverridePoints] = useState<Record<string, string>>({})
  const [overrideReason, setOverrideReason] = useState<Record<string, string>>({})
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({})
  const [flagNotes, setFlagNotes] = useState<Record<string, string>>({})

  function pairKey(item: ReviewQueueItem): string {
    return `${item.assessment.id}:${item.student.id}`
  }

  async function postJson(url: string, body: unknown, key: string, successMessage: string) {
    setBusyKey(key)
    setMessage(null)
    setError(null)
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = (await response.json()) as { message?: string }
      if (!response.ok) {
        setError(data.message ?? "Unable to complete the request.")
        return
      }
      setMessage(successMessage)
      router.refresh()
    } catch {
      setError("Unable to complete the request.")
    } finally {
      setBusyKey(null)
    }
  }

  function decide(item: ReviewQueueItem, decision: Decision) {
    const key = pairKey(item)
    void postJson(
      `/api/teacher/reviews/${item.assessment.id}/${item.student.id}`,
      decision,
      key,
      decision.action === "reject"
        ? "Suggestion rejected. Nothing was published."
        : decision.action === "flag"
          ? "Flagged for closer review."
          : "Decision recorded.",
    )
  }

  function approve(item: ReviewQueueItem) {
    decide(item, { action: "accept" })
  }

  function override(item: ReviewQueueItem) {
    const key = pairKey(item)
    const points = Number(overridePoints[key])
    const reason = (overrideReason[key] ?? "").trim()
    if (!Number.isFinite(points) || points < 0) {
      setError("Override points must be a non-negative number.")
      return
    }
    if (!reason) {
      setError("An override reason is required and is used for calibration.")
      return
    }
    decide(item, { action: "override", points, reason })
  }

  function evaluate(candidate: EvaluationCandidate) {
    void postJson(
      "/api/teacher/reviews/evaluate",
      { submissionId: candidate.submissionId },
      candidate.submissionId,
      "AI evaluation recorded as a draft. Nothing is published.",
    )
  }

  return (
    <div className="space-y-6">
      {message && (
        <div
          role="status"
          className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400"
        >
          {message}
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      <Card className="border-primary/20 bg-gradient-to-br from-primary/10 via-background to-background shadow-sm">
        <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Badge
              variant="outline"
              className="mb-2 w-fit gap-1.5 border-primary/30 bg-background/70 text-primary"
            >
              <Sparkles className="size-3.5" />
              Rubric review queue
            </Badge>
            {/*
             * h2, not h3: `PageHeader` above is the page's `<h1>` and this page
             * renders no `SectionCard`, so the only heading emitter below the h1
             * is here — an h3 skipped a level. (The same defect was fixed on
             * student/assessments after the shell swap.)
             */}
            <h2 className="text-lg font-semibold tracking-tight">
              Approve AI suggestions criterion by criterion
            </h2>
            <p className="text-sm text-muted-foreground">
              Nothing publishes without an explicit accept or override. Model output can never
              overwrite a published grade.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => router.refresh()}
            disabled={busyKey !== null}
          >
            <RefreshCw />
            Refresh
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base tracking-tight">
            Submissions ready to evaluate ({candidates.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {candidates.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No rubric-bearing submissions yet. Author a rubric first.
            </p>
          )}
          {candidates.map((candidate) => (
            <div
              key={candidate.submissionId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/70 bg-background px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {candidate.student.fullName} · {candidate.assessment.title}
                </p>
                <p className="text-xs text-muted-foreground">
                  {candidate.student.registerNumber} · rubric {candidate.assessment.rubricMaxPoints}{" "}
                  points
                  {candidate.hasSuggestions ? " · has AI suggestions" : ""}
                  {candidate.reviewStatus ? ` · ${candidate.reviewStatus}` : ""}
                  {candidate.gradePublished ? " · published" : ""}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant={candidate.hasSuggestions ? "outline" : "default"}
                onClick={() => evaluate(candidate)}
                disabled={busyKey !== null}
              >
                <Sparkles />
                {candidate.hasSuggestions ? "Re-run AI" : "Evaluate"}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <h2 className="text-sm font-semibold tracking-tight">Needs review ({items.length})</h2>
        {items.length === 0 && (
          <Card className="border-border/70 shadow-sm">
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Nothing is waiting for review.
            </CardContent>
          </Card>
        )}

        {items.map((item) => {
          const key = pairKey(item)
          const busy = busyKey === key
          const published = item.grade?.isPublished ?? false
          return (
            <Card key={key} className="border-border/70 shadow-sm">
              <CardHeader className="border-b border-border/60 bg-muted/15">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base tracking-tight">
                      {item.student.fullName} · {item.assessment.title}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {item.assessment.courseCode} · {item.assessment.courseName} ·{" "}
                      {item.assessment.className} · {item.student.registerNumber}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Mapped to the shared vocabulary rather than printing the
                        raw enum: `REVIEW_STATE_LABEL` and `GRADE_SOURCE_LABEL`
                        exist for exactly these two enums. */}
                    <StatusPill
                      status={REVIEW_STATE_TO_STATUS[item.review.status]}
                      label={REVIEW_STATE_LABEL[item.review.status]}
                      dot
                    />
                    <Badge variant="outline">
                      {item.grade
                        ? `${item.grade.points}/${item.grade.maxPoints} · ${GRADE_SOURCE_LABEL[item.grade.source]}`
                        : "No draft"}
                    </Badge>
                    {published && (
                      <Badge
                        variant="outline"
                        className="border-emerald-500/30 text-emerald-700 dark:text-emerald-400"
                      >
                        Published
                      </Badge>
                    )}
                  </div>
                </div>
                {item.flags.length > 0 && (
                  <ul className="mt-2 list-inside list-disc text-xs text-amber-700 dark:text-amber-400">
                    {item.flags.map((flag) => (
                      <li key={flag}>{flag}</li>
                    ))}
                  </ul>
                )}
              </CardHeader>

              <CardContent className="space-y-3 pt-4">
                {item.suggestions.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No per-criterion suggestions recorded yet.
                  </p>
                )}
                {item.suggestions.map((suggestion) => (
                  <div
                    key={suggestion.id}
                    className="rounded-md border border-border/70 bg-background p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium">
                        {suggestion.criterionLabel ?? "Overall"} · {suggestion.suggestedPoints}
                        {suggestion.maxPoints !== null ? `/${suggestion.maxPoints}` : ""}
                      </p>
                      <Badge variant="outline" className={confidenceTone(suggestion.confidence)}>
                        confidence {suggestion.confidence.toFixed(2)}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">{suggestion.rationale}</p>
                    {suggestion.evidence && (
                      <blockquote className="mt-2 border-l-2 border-primary/40 pl-3 text-sm italic">
                        “{suggestion.evidence}”
                      </blockquote>
                    )}
                    <p className="mt-2 text-xs text-muted-foreground">
                      {suggestion.model} · {suggestion.promptVersion} · {suggestion.latencyMs}ms
                    </p>
                  </div>
                ))}

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => approve(item)}
                    disabled={busy || item.suggestions.length === 0}
                  >
                    <Check />
                    Accept
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setOverrideOpen((prev) => ({ ...prev, [key]: !prev[key] }))}
                    disabled={busy}
                  >
                    <SlidersHorizontal />
                    Override
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      decide(item, { action: "flag", notes: flagNotes[key]?.trim() || undefined })
                    }
                    disabled={busy}
                  >
                    <Flag />
                    Flag
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={() =>
                      decide(item, {
                        action: "reject",
                        reason: rejectReason[key]?.trim() || undefined,
                      })
                    }
                    disabled={busy}
                  >
                    <X />
                    Reject
                  </Button>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor={`flag-${key}`}>Flag note</Label>
                    <Input
                      id={`flag-${key}`}
                      value={flagNotes[key] ?? ""}
                      onChange={(event) =>
                        setFlagNotes((prev) => ({ ...prev, [key]: event.target.value }))
                      }
                      placeholder="Why this needs a closer look"
                      maxLength={2000}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor={`reject-${key}`}>Reject reason</Label>
                    <Input
                      id={`reject-${key}`}
                      value={rejectReason[key] ?? ""}
                      onChange={(event) =>
                        setRejectReason((prev) => ({ ...prev, [key]: event.target.value }))
                      }
                      placeholder="Why the suggestion is rejected"
                      maxLength={2000}
                    />
                  </div>
                </div>

                {overrideOpen[key] && (
                  <div className="grid gap-3 rounded-md border border-violet-500/30 bg-violet-500/5 p-3 sm:grid-cols-[140px_1fr_auto]">
                    <div className="grid gap-1.5">
                      <Label htmlFor={`override-points-${key}`}>Override points</Label>
                      <Input
                        id={`override-points-${key}`}
                        type="number"
                        min={0}
                        value={overridePoints[key] ?? ""}
                        onChange={(event) =>
                          setOverridePoints((prev) => ({ ...prev, [key]: event.target.value }))
                        }
                        placeholder="0"
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor={`override-reason-${key}`}>Override reason</Label>
                      <Input
                        id={`override-reason-${key}`}
                        value={overrideReason[key] ?? ""}
                        onChange={(event) =>
                          setOverrideReason((prev) => ({ ...prev, [key]: event.target.value }))
                        }
                        placeholder="Recorded for calibration"
                        maxLength={2000}
                      />
                    </div>
                    <div className="flex items-end">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => override(item)}
                        disabled={busy}
                      >
                        Publish override
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

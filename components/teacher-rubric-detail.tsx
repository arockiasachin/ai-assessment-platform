"use client"

import { useState } from "react"
import { BookOpen, Loader2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

/**
 * The rubric behind a review item (TN-37).
 *
 * `GET /api/teacher/reviews/[assessmentId]/[studentId]` has always returned the full rubric —
 * each criterion's description and its level descriptors — but nothing called it, so the
 * descriptors an override should be judged against were unreachable. The queue already shows the
 * per-criterion *suggestions*; this adds the scale they were scored on.
 *
 * Fetched on demand rather than with the page: a queue of twenty items should not make twenty
 * rubric reads to render a button.
 */

type RubricLevel = {
  label: string
  descriptor?: string
  points: number
}

type RubricCriterion = {
  id: string
  label: string
  description: string | null
  weight: number
  maxPoints: number
  levels: RubricLevel[]
}

type Rubric = {
  id: string
  title: string
  description: string | null
  maxPoints: number | null
  promptVersion: string
  criteria: RubricCriterion[]
}

type DetailResponse = {
  success?: boolean
  rubric?: Rubric | null
  message?: string
}

export function TeacherRubricDetail({
  assessmentId,
  studentId,
}: {
  assessmentId: string
  studentId: string
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [rubric, setRubric] = useState<Rubric | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function toggle() {
    const next = !open
    setOpen(next)
    if (!next || loaded) return
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/teacher/reviews/${assessmentId}/${studentId}`, {
        cache: "no-store",
      })
      const data = (await response.json()) as DetailResponse
      if (!response.ok) {
        setError(data.message ?? "Unable to load the rubric detail.")
        return
      }
      setRubric(data.rubric ?? null)
      setLoaded(true)
    } catch {
      setError("Unable to load the rubric detail.")
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
        {loading ? <Loader2 className="animate-spin" /> : <BookOpen />}
        {open ? "Hide rubric detail" : "Show rubric detail"}
      </Button>

      {open && (
        <div className="space-y-3 border-t border-border/60 p-3">
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {!error && loading && <p className="text-sm text-muted-foreground">Loading rubric…</p>}
          {!error && !loading && !rubric && (
            <p className="text-sm text-muted-foreground">
              This assessment has no rubric attached, so there are no criterion descriptors to show.
            </p>
          )}
          {!error && !loading && rubric && (
            <>
              <div>
                <p className="text-sm font-medium">{rubric.title}</p>
                <p className="text-xs text-muted-foreground">
                  {rubric.maxPoints !== null ? `${rubric.maxPoints} points · ` : ""}
                  prompt {rubric.promptVersion}
                </p>
                {rubric.description && (
                  <p className="mt-1 text-sm text-muted-foreground">{rubric.description}</p>
                )}
              </div>
              <ul className="space-y-2">
                {rubric.criteria.map((criterion) => (
                  <li
                    key={criterion.id}
                    className="rounded border border-border/70 bg-muted/20 p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium">{criterion.label}</p>
                      <Badge variant="outline">
                        {criterion.maxPoints} pts · weight {criterion.weight}
                      </Badge>
                    </div>
                    {criterion.description && (
                      <p className="mt-1 text-sm text-muted-foreground">{criterion.description}</p>
                    )}
                    {criterion.levels.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {criterion.levels.map((level, index) => (
                          <li key={`${criterion.id}:${index}`} className="text-xs">
                            <span className="font-medium">{level.label}</span>
                            <span className="text-muted-foreground"> · {level.points} pts</span>
                            {level.descriptor ? (
                              <span className="text-muted-foreground"> — {level.descriptor}</span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
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

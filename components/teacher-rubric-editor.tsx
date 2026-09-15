"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Save, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { RubricResponse, TeacherAssessmentSummary } from "@/lib/rubric-grading/contracts"

/**
 * Weighted-rubric authoring for teachers.
 *
 * The server is the source of truth: the assessment list arrives as a Server
 * Component prop, and every save is validated again on the server (coherence,
 * ownership, and the published-grade freeze). This component only shapes the
 * form.
 */

type CriterionDraft = {
  label: string
  description: string
  weight: string
  maxPoints: string
}

function emptyCriterion(): CriterionDraft {
  return { label: "", description: "", weight: "1", maxPoints: "5" }
}

function toDraft(rubric: RubricResponse | null, fallbackTitle: string) {
  if (!rubric) {
    return {
      title: fallbackTitle,
      description: "",
      criteria: [emptyCriterion()],
    }
  }
  return {
    title: rubric.title,
    description: rubric.description ?? "",
    criteria: rubric.criteria.map((criterion) => ({
      label: criterion.label,
      description: criterion.description ?? "",
      weight: String(criterion.weight),
      maxPoints: String(criterion.maxPoints),
    })),
  }
}

export function TeacherRubricEditor({
  initialAssessments,
}: {
  initialAssessments: TeacherAssessmentSummary[]
}) {
  const router = useRouter()
  const first = initialAssessments[0] ?? null
  const firstDraft = toDraft(first?.rubric ?? null, first?.title ?? "")

  const [assessments, setAssessments] = useState(initialAssessments)
  const [selectedId, setSelectedId] = useState(first?.id ?? "")
  const [title, setTitle] = useState(firstDraft.title)
  const [description, setDescription] = useState(firstDraft.description)
  const [criteria, setCriteria] = useState<CriterionDraft[]>(firstDraft.criteria)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const selected = assessments.find((assessment) => assessment.id === selectedId) ?? null

  const totalPoints = criteria.reduce((total, criterion) => {
    const value = Number(criterion.maxPoints)
    return total + (Number.isFinite(value) ? value : 0)
  }, 0)

  function selectAssessment(id: string) {
    const next = assessments.find((assessment) => assessment.id === id) ?? null
    const draft = toDraft(next?.rubric ?? null, next?.title ?? "")
    setSelectedId(id)
    setTitle(draft.title)
    setDescription(draft.description)
    setCriteria(draft.criteria)
    setMessage(null)
    setError(null)
  }

  function updateCriterion(index: number, patch: Partial<CriterionDraft>) {
    setCriteria((prev) =>
      prev.map((criterion, position) =>
        position === index ? { ...criterion, ...patch } : criterion,
      ),
    )
  }

  async function save() {
    if (!selected) {
      setError("Select an assessment first.")
      return
    }
    setIsSaving(true)
    setMessage(null)
    setError(null)
    try {
      const response = await fetch("/api/teacher/rubrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assessmentId: selected.id,
          title,
          description: description.trim() || undefined,
          criteria: criteria.map((criterion) => ({
            label: criterion.label,
            description: criterion.description.trim() || undefined,
            weight: Number(criterion.weight),
            maxPoints: Number(criterion.maxPoints),
          })),
        }),
      })
      const data = (await response.json()) as {
        message?: string
        rubric?: RubricResponse
      }
      if (!response.ok || !data.rubric) {
        setError(data.message ?? "Unable to save the rubric.")
        return
      }
      const savedRubric = data.rubric
      setAssessments((prev) =>
        prev.map((assessment) =>
          assessment.id === selected.id ? { ...assessment, rubric: savedRubric } : assessment,
        ),
      )
      setMessage("Rubric saved. Grades cannot publish without your approval.")
      /*
       * The read-only summary above this editor is a Server Component rendered
       * from the same server payload, so it would still show the pre-save
       * criteria. Refresh it so the two cannot contradict each other on screen.
       */
      router.refresh()
    } catch {
      setError("Unable to save the rubric.")
    } finally {
      setIsSaving(false)
    }
  }

  if (assessments.length === 0) {
    return (
      <Card className="border-border/70 shadow-sm">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          You have no assessments to attach a rubric to yet.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card className="border-primary/20 bg-gradient-to-br from-primary/10 via-background to-background shadow-sm">
        <CardContent className="pt-6">
          <Badge variant="outline" className="mb-2 w-fit border-primary/30 text-primary">
            Weighted rubric authoring
          </Badge>
          <p className="text-sm text-muted-foreground">
            The rubric is the binding grading contract. Each criterion carries a weight, a point
            ceiling, and a descriptor the model must score against.
          </p>
        </CardContent>
      </Card>

      {message && (
        <div
          role="status"
          className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 [@media(prefers-color-scheme:dark)]:text-emerald-400"
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

      <Card className="border-border/70 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base tracking-tight">Assessment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:max-w-xl">
            <Label htmlFor="rubric-assessment">Assessment</Label>
            <Select value={selectedId} onValueChange={(value) => selectAssessment(value ?? "")}>
              <SelectTrigger id="rubric-assessment">
                <SelectValue placeholder="Choose an assessment" />
              </SelectTrigger>
              <SelectContent>
                {assessments.map((assessment) => (
                  <SelectItem key={assessment.id} value={assessment.id}>
                    {assessment.title}
                    {assessment.rubric ? " (rubric)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selected && (
              <p className="text-xs text-muted-foreground">
                {selected.courseCode} · {selected.courseName} · {selected.className} · max{" "}
                {selected.maxMarks} marks
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="rubric-title">Rubric title</Label>
              <Input
                id="rubric-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={300}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rubric-description">Description</Label>
              <Input
                id="rubric-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={4000}
                placeholder="What this rubric measures"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base tracking-tight">Criteria</CardTitle>
          <Badge variant="outline">{totalPoints} points total</Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          {criteria.map((criterion, index) => (
            <div
              key={index}
              className="space-y-3 rounded-lg border border-border/70 bg-muted/10 p-3"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor={`criterion-label-${index}`}>Criterion label</Label>
                  <Input
                    id={`criterion-label-${index}`}
                    value={criterion.label}
                    onChange={(event) => updateCriterion(index, { label: event.target.value })}
                    maxLength={200}
                    placeholder="Argument and reasoning"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`criterion-description-${index}`}>Descriptor</Label>
                  <Input
                    id={`criterion-description-${index}`}
                    value={criterion.description}
                    onChange={(event) =>
                      updateCriterion(index, { description: event.target.value })
                    }
                    maxLength={2000}
                    placeholder="What excellence looks like"
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                <div className="grid gap-2">
                  <Label htmlFor={`criterion-weight-${index}`}>Weight</Label>
                  <Input
                    id={`criterion-weight-${index}`}
                    type="number"
                    min={0.01}
                    step={0.01}
                    value={criterion.weight}
                    onChange={(event) => updateCriterion(index, { weight: event.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`criterion-points-${index}`}>Max points</Label>
                  <Input
                    id={`criterion-points-${index}`}
                    type="number"
                    min={0.5}
                    step={0.5}
                    value={criterion.maxPoints}
                    onChange={(event) => updateCriterion(index, { maxPoints: event.target.value })}
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={criteria.length <= 1}
                    onClick={() =>
                      setCriteria((prev) => prev.filter((_, position) => position !== index))
                    }
                    aria-label="Remove criterion"
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            </div>
          ))}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCriteria((prev) => [...prev, emptyCriterion()])}
              disabled={criteria.length >= 50}
            >
              <Plus />
              Add criterion
            </Button>
            <Button type="button" onClick={save} disabled={isSaving || !selected}>
              <Save />
              {isSaving ? "Saving…" : "Save rubric"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

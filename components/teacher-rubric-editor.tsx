"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from "lucide-react"

import { AuthoringLifecycleBadge } from "@/components/authoring-lifecycle"
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
import { rubricLifecycle } from "@/lib/authoring-lifecycle-view"
import type { RubricResponse, TeacherAssessmentSummary } from "@/lib/rubric-grading/contracts"

/**
 * Weighted-rubric authoring for teachers.
 *
 * The server is the source of truth: the assessment list arrives as a Server
 * Component prop, and every save is validated again on the server (coherence,
 * ownership, and the published-grade freeze). This component only shapes the
 * form.
 */

type LevelDraft = {
  label: string
  descriptor: string
  points: string
}

type CriterionDraft = {
  label: string
  description: string
  weight: string
  maxPoints: string
  /** Behaviourally-anchored levels. Stored in `RubricCriterion.levelsJson`; authored here (TN-66). */
  levels: LevelDraft[]
}

function emptyCriterion(): CriterionDraft {
  return { label: "", description: "", weight: "1", maxPoints: "5", levels: [] }
}

function emptyLevel(): LevelDraft {
  return { label: "", descriptor: "", points: "" }
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
      levels: criterion.levels.map((level) => ({
        label: level.label,
        descriptor: level.descriptor ?? "",
        points: String(level.points),
      })),
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

  /**
   * TL-1: the freeze was computed on the server (`locked`) and enforced on save with a 409,
   * but nothing rendered it — so the only way to learn a rubric was frozen was to try to edit
   * it. The badge states it up front, and `isLocked` turns Save off rather than letting the
   * teacher fill in a form the server will reject.
   */
  const lifecycle = selected
    ? rubricLifecycle({ hasRubric: selected.rubric !== null, locked: selected.locked })
    : null
  const isLocked = selected?.locked === true

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

  /**
   * Move a criterion one position. Order is meaningful — the API stores each criterion's
   * index as `order`, and the rubric reads top-to-bottom — and there was no way to change
   * it once a criterion was added (TN-66).
   */
  function moveCriterion(index: number, delta: -1 | 1) {
    setCriteria((prev) => {
      const target = index + delta
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      const [moved] = next.splice(index, 1)
      next.splice(target, 0, moved)
      return next
    })
  }

  function updateLevel(criterionIndex: number, levelIndex: number, patch: Partial<LevelDraft>) {
    setCriteria((prev) =>
      prev.map((criterion, position) =>
        position === criterionIndex
          ? {
              ...criterion,
              levels: criterion.levels.map((level, levelPosition) =>
                levelPosition === levelIndex ? { ...level, ...patch } : level,
              ),
            }
          : criterion,
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
            // A level row the teacher added but left unlabelled is not a level; dropping
            // it here keeps a half-filled row from failing the whole save.
            levels: criterion.levels
              .filter((level) => level.label.trim() !== "")
              .map((level) => ({
                label: level.label.trim(),
                descriptor: level.descriptor.trim() || undefined,
                points: Number(level.points),
              })),
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

      <Card className="border-border/70 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base tracking-tight">Assessment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:max-w-xl">
            <Label htmlFor="rubric-assessment">Assessment</Label>
            <Select
              value={selectedId}
              onValueChange={(value) => selectAssessment(value ?? "")}
              // Base UI's trigger shows the raw assessment id without this map (TN-7); it
              // mirrors the popup options exactly, including the "(rubric)" suffix.
              items={assessments.map((assessment) => ({
                value: assessment.id,
                label: `${assessment.title}${assessment.rubric ? " (rubric)" : ""}`,
              }))}
            >
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
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  {selected.courseCode} · {selected.courseName} · {selected.className} · max{" "}
                  {selected.maxMarks} marks
                </p>
                {lifecycle && <AuthoringLifecycleBadge view={lifecycle} />}
              </div>
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
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  Criterion {index + 1}
                </span>
                {/* Order is stored as `order` and read top-to-bottom; there was no way to
                    change it once a criterion existed (TN-66). */}
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={index === 0}
                    onClick={() => moveCriterion(index, -1)}
                    aria-label={`Move criterion ${index + 1} up`}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={index === criteria.length - 1}
                    onClick={() => moveCriterion(index, 1)}
                    aria-label={`Move criterion ${index + 1} down`}
                  >
                    <ArrowDown />
                  </Button>
                </div>
              </div>
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

              {/* Levels. Stored in `levelsJson` and always read by the grader, but there was
                  no authoring surface at all, so the feature existed only for rubrics written
                  through the API (TN-66). */}
              <div className="space-y-2 rounded-md border border-border/60 bg-background/60 p-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    Levels ({criterion.levels.length})
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={criterion.levels.length >= 20}
                    onClick={() =>
                      updateCriterion(index, { levels: [...criterion.levels, emptyLevel()] })
                    }
                  >
                    <Plus />
                    Add level
                  </Button>
                </div>
                {criterion.levels.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No levels — the model scores against the criterion descriptor alone.
                  </p>
                ) : (
                  criterion.levels.map((level, levelIndex) => (
                    <div
                      key={levelIndex}
                      className="grid gap-2 sm:grid-cols-[1fr_2fr_5rem_auto] sm:items-center"
                    >
                      <Input
                        value={level.label}
                        onChange={(event) =>
                          updateLevel(index, levelIndex, { label: event.target.value })
                        }
                        maxLength={120}
                        placeholder="Label (e.g. Excellent)"
                        aria-label={`Criterion ${index + 1} level ${levelIndex + 1} label`}
                      />
                      <Input
                        value={level.descriptor}
                        onChange={(event) =>
                          updateLevel(index, levelIndex, { descriptor: event.target.value })
                        }
                        maxLength={2000}
                        placeholder="Behavioural descriptor"
                        aria-label={`Criterion ${index + 1} level ${levelIndex + 1} descriptor`}
                      />
                      <Input
                        type="number"
                        min={0}
                        step={0.5}
                        value={level.points}
                        onChange={(event) =>
                          updateLevel(index, levelIndex, { points: event.target.value })
                        }
                        placeholder="Points"
                        aria-label={`Criterion ${index + 1} level ${levelIndex + 1} points`}
                      />
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon-sm"
                        onClick={() =>
                          updateCriterion(index, {
                            levels: criterion.levels.filter(
                              (_, position) => position !== levelIndex,
                            ),
                          })
                        }
                        aria-label={`Remove criterion ${index + 1} level ${levelIndex + 1}`}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ))
                )}
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
            <div className="flex flex-col items-end gap-1">
              <Button type="button" onClick={save} disabled={isSaving || !selected || isLocked}>
                <Save />
                {isSaving ? "Saving…" : "Save rubric"}
              </Button>
              {isLocked && (
                <p role="status" className="text-xs text-muted-foreground">
                  Frozen — a grade has been published against this rubric, so it can no longer be
                  edited.
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

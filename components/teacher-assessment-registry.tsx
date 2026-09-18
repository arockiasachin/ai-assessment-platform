"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CheckCircle2, ClipboardList, Pencil, Trash2, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SectionCard } from "@/components/ui/section-card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ASSESSMENT_KIND_LABEL } from "@/lib/labels"
import { formatDate } from "@/lib/format"
import {
  RETAKE_POLICIES,
  RETAKE_POLICY_LABEL,
  describeRetakePolicy,
  describeRetakeSettingsProblem,
  type RetakePolicy,
} from "@/lib/quiz-attempts/retake-policy"
import type { TeacherAssessmentRow } from "@/lib/gradebook-db"

/**
 * The assessment registry (TN-39).
 *
 * The create form wrote a bare `Assessment` row and nothing could list, rename or remove one.
 * This is the list and its two write actions. It also says, per kind, what still has to be
 * authored — a `QUIZ` with no questions and a `CODE` task with no `CodeTask` are legitimate
 * staging states, but they must not look finished, which is the second half of the finding.
 *
 * Rows arrive as server props and the page is `force-dynamic`, so `router.refresh()` after a
 * mutation re-reads the truth rather than guessing at the new row in state.
 */

/** Where each kind's content is authored, or `null` when the kind has no body to author. */
function authoringHref(row: TeacherAssessmentRow): string | null {
  if (row.type === "QUIZ") return "/teacher/quiz-generation"
  if (row.type === "DESCRIPTIVE") return "/teacher/rubrics"
  if (row.type === "CODE") return `/teacher/code-tasks?assessmentId=${row.id}`
  return null
}

function ReadinessBadge({ row }: { row: TeacherAssessmentRow }) {
  if (row.type === "QUIZ") {
    return row.questionCount === 0 ? (
      <Badge variant="destructive">No questions yet</Badge>
    ) : (
      <Badge variant="outline">
        {row.questionCount} question{row.questionCount === 1 ? "" : "s"} ·{" "}
        {row.publishedQuestionCount} published
      </Badge>
    )
  }
  if (row.type === "DESCRIPTIVE") {
    return row.hasRubric ? (
      <Badge variant="outline">Rubric authored</Badge>
    ) : (
      <Badge variant="destructive">No rubric yet</Badge>
    )
  }
  if (row.type === "CODE") {
    return row.hasCodeTask ? (
      <Badge variant="outline">Code task configured</Badge>
    ) : (
      <Badge variant="destructive">No code task yet</Badge>
    )
  }
  return <Badge variant="secondary">No extra body required</Badge>
}

const RETAKE_POLICY_ITEMS = RETAKE_POLICIES.map((policy) => ({
  value: policy,
  label: RETAKE_POLICY_LABEL[policy],
}))

/**
 * Parse the form's text field into the count the pair rule takes, then ask the **same**
 * `describeRetakeSettingsProblem` the server enforces — so the sentence a teacher reads here is
 * the one the API would return, and the rule has one definition rather than two that can drift.
 * The server remains the authority; this only keeps Save from posting a call that would 400.
 *
 * `null` means the count is acceptable; a string is the sentence to show.
 */
function retakeCountProblem(policy: RetakePolicy, raw: string): string | null {
  if (policy === "NONE") return null
  const trimmed = raw.trim()
  const retakesAllowed = trimmed === "" ? null : Number(trimmed)
  if (retakesAllowed !== null && (!Number.isInteger(retakesAllowed) || retakesAllowed < 0)) {
    return "Enter a whole number of retakes (0 or more)."
  }
  return describeRetakeSettingsProblem({ policy, retakesAllowed })
}

export function TeacherAssessmentRegistry({ rows }: { rows: TeacherAssessmentRow[] }) {
  const router = useRouter()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<
    Record<
      string,
      {
        title: string
        date: string
        maxMarks: string
        retakePolicy: RetakePolicy
        retakesAllowed: string
      }
    >
  >({})

  const sorted = useMemo(() => rows, [rows])

  function draftFor(row: TeacherAssessmentRow) {
    return (
      drafts[row.id] ?? {
        title: row.title,
        date: row.dueDate.slice(0, 10),
        maxMarks: String(row.maxMarks),
        retakePolicy: row.retakePolicy,
        // A stored `null` is the empty field, not "0": the two mean different things (fall back
        // to the attempt cap versus no retakes), so the form must not blur them.
        retakesAllowed: row.retakesAllowed === null ? "" : String(row.retakesAllowed),
      }
    )
  }

  function setDraft(
    row: TeacherAssessmentRow,
    patch: Partial<{
      title: string
      date: string
      maxMarks: string
      retakePolicy: RetakePolicy
      retakesAllowed: string
    }>,
  ) {
    setDrafts((prev) => ({ ...prev, [row.id]: { ...draftFor(row), ...patch } }))
  }

  async function save(row: TeacherAssessmentRow) {
    const draft = draftFor(row)
    setBusyId(row.id)
    setMessage(null)
    setError(null)
    try {
      const response = await fetch(`/api/gradebook/assessments/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title.trim(),
          date: draft.date,
          maxMarks: Number(draft.maxMarks),
          retakePolicy: draft.retakePolicy,
          // An empty field is an explicit `null` (fall back to the attempt cap), and `NONE`
          // cannot carry a count at all — the server normalises that too, but sending the
          // coherent pair keeps the audit's before/after honest.
          retakesAllowed:
            draft.retakePolicy === "NONE" || draft.retakesAllowed.trim() === ""
              ? null
              : Number(draft.retakesAllowed),
        }),
      })
      const data = (await response.json()) as { message?: string }
      if (!response.ok) {
        setError(data.message ?? "Unable to update the assessment.")
        return
      }
      setMessage("Assessment updated.")
      setEditingId(null)
      router.refresh()
    } catch {
      setError("Unable to update the assessment.")
    } finally {
      setBusyId(null)
    }
  }

  async function remove(row: TeacherAssessmentRow) {
    setBusyId(row.id)
    setMessage(null)
    setError(null)
    try {
      const response = await fetch(`/api/gradebook/assessments/${row.id}`, { method: "DELETE" })
      const data = (await response.json()) as { message?: string }
      if (!response.ok) {
        setError(data.message ?? "Unable to delete the assessment.")
        return
      }
      setMessage("Assessment deleted.")
      setConfirmingId(null)
      router.refresh()
    } catch {
      setError("Unable to delete the assessment.")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <SectionCard
      title={`Your assessments (${sorted.length})`}
      description="Every assessment you created or teach. Each kind says what still has to be authored before it is deliverable."
    >
      {message && (
        <p
          role="status"
          className="mb-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400"
        >
          {message}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mb-3 rounded-md border border-destructive/60 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      {sorted.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No assessments yet"
          description="Create one above; it will appear here with what still needs authoring."
        />
      ) : (
        <div className="space-y-3">
          {sorted.map((row) => {
            const editing = editingId === row.id
            const confirming = confirmingId === row.id
            const busy = busyId === row.id
            const href = authoringHref(row)
            const draft = draftFor(row)
            const retakeError = retakeCountProblem(draft.retakePolicy, draft.retakesAllowed)
            return (
              <Card key={row.id} className="border-border/70 shadow-sm">
                <CardHeader className="border-b border-border/60 bg-muted/15 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="text-base tracking-tight">{row.title}</CardTitle>
                      <p className="text-xs text-muted-foreground">
                        {row.offeringLabel} · due {formatDate(row.dueDate)} · {row.maxMarks} marks
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{ASSESSMENT_KIND_LABEL[row.type]}</Badge>
                      {row.releasedAt ? (
                        <Badge
                          variant="outline"
                          className="border-emerald-500/30 text-emerald-700 dark:text-emerald-400"
                        >
                          <CheckCircle2 /> Released
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Not released</Badge>
                      )}
                      <ReadinessBadge row={row} />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 pt-4">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      {row.gradedCount} released mark{row.gradedCount === 1 ? "" : "s"}
                    </span>
                    <span>
                      {row.submissionCount} submission{row.submissionCount === 1 ? "" : "s"}
                    </span>
                    {href && (
                      <Link href={href} className="text-primary underline-offset-4 hover:underline">
                        Author{" "}
                        {row.type === "QUIZ"
                          ? "questions"
                          : row.type === "DESCRIPTIVE"
                            ? "the rubric"
                            : "the code task"}{" "}
                        →
                      </Link>
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Retakes:{" "}
                    {describeRetakePolicy(
                      row.retakePolicy,
                      row.effectiveMaxAttempts,
                      row.retakesAllowed,
                    )}
                  </p>

                  {editing ? (
                    <>
                      <div className="grid gap-3 rounded-md border border-border/70 bg-muted/10 p-3 sm:grid-cols-[1fr_auto_auto_auto]">
                        <div className="grid gap-1.5">
                          <Label htmlFor={`registry-title-${row.id}`}>Title</Label>
                          <Input
                            id={`registry-title-${row.id}`}
                            value={draft.title}
                            onChange={(event) => setDraft(row, { title: event.target.value })}
                          />
                        </div>
                        <div className="grid gap-1.5">
                          <Label htmlFor={`registry-date-${row.id}`}>Due date</Label>
                          <Input
                            id={`registry-date-${row.id}`}
                            type="date"
                            value={draft.date}
                            onChange={(event) => setDraft(row, { date: event.target.value })}
                          />
                        </div>
                        <div className="grid gap-1.5">
                          <Label htmlFor={`registry-marks-${row.id}`}>Max marks</Label>
                          <Input
                            id={`registry-marks-${row.id}`}
                            type="number"
                            min={1}
                            value={draft.maxMarks}
                            disabled={row.gradedCount > 0 || row.submissionCount > 0}
                            onChange={(event) => setDraft(row, { maxMarks: event.target.value })}
                          />
                        </div>
                        <div className="flex items-end gap-2">
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => void save(row)}
                            disabled={busy || retakeError !== null}
                          >
                            Save
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setEditingId(null)}
                            disabled={busy}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>

                      {/*
                      The retake settings (SN-35), beside the other per-assessment fields rather
                      than on a new page: this registry is where an assessment's settings already
                      live. The pair rule (`APPROVAL` needs a count of at least one) is stated
                      here and enforced again in `updateAssessmentForSessionUser`, which is the
                      authority — the client check only stops a form that would certainly 400.
                    */}
                      <div className="grid gap-3 rounded-md border border-border/70 bg-muted/10 p-3 sm:grid-cols-2">
                        <div className="grid gap-1.5">
                          <Label htmlFor={`registry-retake-policy-${row.id}`}>Retake policy</Label>
                          <Select
                            value={draft.retakePolicy}
                            onValueChange={(value) =>
                              setDraft(row, { retakePolicy: (value ?? "FIXED") as RetakePolicy })
                            }
                            items={RETAKE_POLICY_ITEMS}
                          >
                            <SelectTrigger
                              id={`registry-retake-policy-${row.id}`}
                              aria-label="Retake policy"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {RETAKE_POLICIES.map((policy) => (
                                <SelectItem key={policy} value={policy}>
                                  {RETAKE_POLICY_LABEL[policy]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground">
                            {describeRetakePolicy(
                              draft.retakePolicy,
                              row.effectiveMaxAttempts,
                              draft.retakePolicy === "NONE" || draft.retakesAllowed.trim() === ""
                                ? null
                                : Number(draft.retakesAllowed),
                            )}
                          </p>
                        </div>
                        <div className="grid gap-1.5">
                          <Label htmlFor={`registry-retakes-allowed-${row.id}`}>
                            Retakes allowed
                          </Label>
                          <Input
                            id={`registry-retakes-allowed-${row.id}`}
                            type="number"
                            min={0}
                            placeholder={
                              draft.retakePolicy === "FIXED"
                                ? `Uses the attempt cap (${row.effectiveMaxAttempts})`
                                : undefined
                            }
                            value={draft.retakesAllowed}
                            disabled={draft.retakePolicy === "NONE"}
                            onChange={(event) =>
                              setDraft(row, { retakesAllowed: event.target.value })
                            }
                          />
                          {retakeError ? (
                            <p className="text-xs text-destructive">{retakeError}</p>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              Retakes after the first sitting. Leave blank to use the attempt cap.
                            </p>
                          )}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setEditingId(row.id)}
                        disabled={busy}
                      >
                        <Pencil /> Edit
                      </Button>
                      {confirming ? (
                        <>
                          <span className="text-xs text-destructive">
                            Delete this assessment and everything under it?
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            onClick={() => void remove(row)}
                            disabled={busy}
                          >
                            <Trash2 /> Confirm delete
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setConfirmingId(null)}
                            disabled={busy}
                          >
                            <X /> Keep
                          </Button>
                        </>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setConfirmingId(row.id)}
                          disabled={busy}
                        >
                          <Trash2 /> Delete
                        </Button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </SectionCard>
  )
}

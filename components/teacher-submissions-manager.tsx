"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, FileText, Search, Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { formatDateTime } from "@/lib/format"
import { ASSESSMENT_KIND_LABEL } from "@/lib/labels"
import type { TeacherSubmissionRow } from "@/lib/teacher-submissions"
import {
  feedbackDraftValue,
  scoreDraftValue,
  submissionBodyText,
  toSubmissionEditorItem,
  validateScoreInput,
  type SubmissionEditorItem,
} from "@/lib/teacher-submissions-view"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

function statusLabel(status: string) {
  if (status === "DRAFT") return "Draft"
  if (status === "SUBMITTED") return "Submitted"
  if (status === "RESUBMITTED") return "Resubmitted"
  if (status === "LATE") return "Late"
  if (status === "GRADED") return "Graded"
  return status
}

// The status chip needs explicit shades rather than the theme's `success`/`warning`
// tokens, which are tuned for solid fills and fail as text on their own tint — see
// `@/components/ui/tone`. `dark:` is correct here: the app maintains a `.dark` class on
// `<html>` (`theme-toggle.tsx`) and `globals.css` declares
// `@custom-variant dark (&:is(.dark *))`. An earlier version of this comment claimed the
// app themed via `prefers-color-scheme` and that `dark:` never activated, which was wrong
// and had led these classes to follow the OS instead of the user's choice.
function statusTone(status: string) {
  if (status === "GRADED")
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
  if (status === "LATE")
    return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
  if (status === "SUBMITTED" || status === "RESUBMITTED")
    return "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400"
  if (status === "DRAFT")
    return "border-slate-400/30 bg-slate-500/10 text-slate-700 dark:text-slate-300"
  return "border-border bg-muted/20 text-foreground"
}

/**
 * The grading editor for a teacher's submissions.
 *
 * ## It takes its rows as props, rather than fetching them
 *
 * It used to call `GET /api/teacher/assessments/submissions` in a mount effect — the P2 finding in
 * `docs/quality/a11y-perf-audit.md` — so the section painted "Loading submissions…" and then filled
 * in. Its sibling `student/assessments` was converted during the Wave 1 port; this one was deferred
 * because it renders *inside* `TeacherAssignmentsManager` rather than at a page root, so the rows
 * have to be threaded through two components instead of arriving as one page-level payload.
 *
 * ## The rows are read from props, not copied into state
 *
 * Only **edits** live in state (`scoreDrafts`, `feedbackDrafts`); a field with no entry in a draft
 * map renders the row's own value via `scoreDraftValue`. That is what allows `router.refresh()`
 * after a save to update the view: refreshed props re-render the same state, so there is no
 * props-into-state effect — the cascading-render pattern this repo lints as
 * `react-hooks/set-state-in-effect`.
 *
 * The alternative, copying rows into `useState` on mount, would have needed an effect to keep them in
 * sync, and would have made the post-save refresh silently do nothing.
 */
export function TeacherSubmissionsManager({ rows }: { rows: TeacherSubmissionRow[] }) {
  const router = useRouter()
  const [message, setMessage] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "graded">("all")
  const [savingId, setSavingId] = useState<string | null>(null)
  const [scoreDrafts, setScoreDrafts] = useState<Record<string, string>>({})
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<string, string>>({})

  const items = useMemo(() => rows.map(toSubmissionEditorItem), [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((item) => {
      if (statusFilter === "graded" && item.score === null) return false
      if (statusFilter === "pending" && item.score !== null) return false
      if (!q) return true
      const text = [
        item.student.fullName,
        item.student.registerNumber,
        item.assessment.title,
        item.assessment.courseName,
        item.assessment.courseCode,
      ]
        .join(" ")
        .toLowerCase()
      return text.includes(q)
    })
  }, [items, search, statusFilter])

  const summary = useMemo(
    () => ({
      total: items.length,
      graded: items.filter((item) => item.score !== null).length,
      pending: items.filter((item) => item.score === null).length,
    }),
    [items],
  )

  const save = async (item: SubmissionEditorItem) => {
    const submissionId = item.id
    const maxMarks = item.assessment.maxMarks
    setMessage(null)
    setSavingId(submissionId)

    try {
      // Validation is shared with the tests (`lib/teacher-submissions-view.ts`), so the rule the
      // button enforces is the rule that is asserted rather than a second, drifting copy.
      const validation = validateScoreInput(
        scoreDraftValue(item, scoreDrafts[submissionId]),
        maxMarks,
      )
      if (!validation.ok) {
        setMessage(validation.message)
        return
      }
      const score = validation.score

      const response = await fetch("/api/teacher/assessments/submissions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId,
          score,
          feedback: feedbackDrafts[submissionId] ?? "",
        }),
      })

      const data = (await response.json()) as { success?: boolean; message?: string }
      setMessage(data.message ?? (response.ok ? "Saved." : "Unable to save changes."))

      if (response.ok) {
        // Re-runs the server component, which re-reads the submissions and passes fresh props. The
        // drafts are left alone, so the teacher's own edit stays visible rather than being replaced
        // by a value that has not round-tripped yet.
        router.refresh()
      }
    } catch {
      setMessage("Unable to save changes.")
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="space-y-6">
      <Card className="border-primary/20 bg-gradient-to-br from-primary/10 via-background to-background shadow-sm">
        <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Badge
              variant="outline"
              className="mb-2 w-fit gap-1.5 border-primary/30 bg-background/70 text-primary"
            >
              <Sparkles className="size-3.5" />
              Submission studio
            </Badge>
            <h3 className="text-lg font-semibold tracking-tight">
              Review, grade, and give feedback quickly
            </h3>
            <p className="text-sm text-muted-foreground">
              Focused view of assignment submissions across your classes.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-md border border-border/70 bg-background/80 px-2 py-1.5 text-center">
              <p className="text-muted-foreground">Total</p>
              <p className="font-semibold text-foreground">{summary.total}</p>
            </div>
            <div className="rounded-md border border-border/70 bg-background/80 px-2 py-1.5 text-center">
              <p className="text-muted-foreground">Graded</p>
              <p className="font-semibold text-foreground">{summary.graded}</p>
            </div>
            <div className="rounded-md border border-border/70 bg-background/80 px-2 py-1.5 text-center">
              <p className="text-muted-foreground">Pending</p>
              <p className="font-semibold text-foreground">{summary.pending}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {message && (
        <div
          role="status"
          className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm"
        >
          {message}
        </div>
      )}

      <Card className="border-border/70 shadow-sm">
        <CardContent className="grid gap-3 pt-6 sm:grid-cols-3">
          <div className="relative sm:col-span-2">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by student, register number, or assessment"
              aria-label="Search submissions"
              className="pl-8"
            />
          </div>
          <Select
            value={statusFilter}
            onValueChange={(value) =>
              setStatusFilter((value as "all" | "pending" | "graded") ?? "all")
            }
          >
            <SelectTrigger aria-label="Filter by grading status">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All submissions</SelectItem>
              <SelectItem value="pending">Pending grading</SelectItem>
              <SelectItem value="graded">Graded</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {filtered.map((item) => (
          <Card key={item.id} className="overflow-hidden border-border/70 shadow-sm">
            <CardHeader className="border-b border-border/60 bg-muted/15">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base tracking-tight">
                    {item.assessment.title}
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {item.assessment.courseCode} · {item.assessment.courseName} ·{" "}
                    {item.assessment.className}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {item.student.fullName} ({item.student.registerNumber}) · {item.student.email}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{ASSESSMENT_KIND_LABEL[item.assessment.type]}</Badge>
                  <Badge variant={item.score === null ? "secondary" : "outline"}>
                    {item.score === null ? "Pending" : "Graded"}
                  </Badge>
                  <Badge variant="outline" className={statusTone(item.status)}>
                    {statusLabel(item.status)}
                  </Badge>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-3">
              <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-md border border-border/70 bg-background px-3 py-2">
                  <p className="text-xs text-muted-foreground">Due date</p>
                  <p className="mt-1 font-medium">{formatDateTime(item.assessment.dueDate)}</p>
                </div>
                <div className="rounded-md border border-border/70 bg-background px-3 py-2">
                  <p className="text-xs text-muted-foreground">Submitted</p>
                  <p className="mt-1 font-medium">{formatDateTime(item.submittedAt)}</p>
                </div>
                <div className="rounded-md border border-border/70 bg-background px-3 py-2">
                  <p className="text-xs text-muted-foreground">Current score</p>
                  <p className="mt-1 font-medium">
                    {item.score === null
                      ? "Not graded"
                      : `${item.score}/${item.assessment.maxMarks}`}
                  </p>
                </div>
                <div className="rounded-md border border-border/70 bg-background px-3 py-2">
                  <p className="text-xs text-muted-foreground">Status</p>
                  <p className="mt-1 inline-flex items-center gap-1.5 font-medium">
                    <CheckCircle2 className="size-4 text-primary" />
                    {statusLabel(item.status)}
                  </p>
                </div>
              </div>

              <div className="rounded-md border border-border/70 bg-background px-3 py-2 text-sm">
                <p className="mb-1 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <FileText className="size-3.5" />
                  Submission content
                </p>
                <p className="whitespace-pre-wrap">{submissionBodyText(item)}</p>
              </div>

              <div className="grid gap-3 lg:grid-cols-[140px_1fr_auto]">
                <Input
                  type="number"
                  min={0}
                  max={item.assessment.maxMarks}
                  value={scoreDraftValue(item, scoreDrafts[item.id])}
                  onChange={(event) =>
                    setScoreDrafts((prev) => ({ ...prev, [item.id]: event.target.value }))
                  }
                  aria-label={`Score for ${item.student.fullName} on ${item.assessment.title}`}
                  placeholder={`0-${item.assessment.maxMarks}`}
                  className="w-full"
                />
                <Input
                  value={feedbackDraftValue(item, feedbackDrafts[item.id])}
                  onChange={(event) =>
                    setFeedbackDrafts((prev) => ({ ...prev, [item.id]: event.target.value }))
                  }
                  aria-label={`Feedback for ${item.student.fullName} on ${item.assessment.title}`}
                  placeholder="Optional grading feedback"
                  maxLength={1000}
                  className="w-full"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => save(item)}
                  disabled={savingId === item.id}
                  className="w-full lg:w-auto"
                >
                  Save grading
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}

        {filtered.length === 0 && (
          <Card className="border-border/70 shadow-sm">
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No submissions match the current filter.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

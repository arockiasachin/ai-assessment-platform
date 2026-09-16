"use client"

import { useEffect, useMemo, useState } from "react"
import { CheckCircle2, FileText, Search, Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { formatDateTime } from "@/lib/format"
import { ASSESSMENT_KIND_LABEL } from "@/lib/labels"
import type { AssessmentType } from "@/lib/generated/prisma/enums"
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

type SubmissionItem = {
  id: string
  status: string
  contentText: string | null
  submittedAt: string | null
  gradedAt: string | null
  feedback: string | null
  student: {
    id: string
    fullName: string
    registerNumber: string
    email: string
  }
  assessment: {
    id: string
    title: string
    type: AssessmentType
    dueDate: string
    maxMarks: number
    courseCode: string
    courseName: string
    className: string
    term: string
    academicYear: number
  }
  score: number | null
}

function statusLabel(status: string) {
  if (status === "DRAFT") return "Draft"
  if (status === "SUBMITTED") return "Submitted"
  if (status === "RESUBMITTED") return "Resubmitted"
  if (status === "LATE") return "Late"
  if (status === "GRADED") return "Graded"
  return status
}

// The app themes via `prefers-color-scheme`, so the `.dark`-scoped Tailwind
// `dark:` variant never activates; the explicit media variant keeps the status
// chip readable on a dark page.
function statusTone(status: string) {
  if (status === "GRADED")
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 [@media(prefers-color-scheme:dark)]:text-emerald-400"
  if (status === "LATE")
    return "border-amber-500/30 bg-amber-500/10 text-amber-700 [@media(prefers-color-scheme:dark)]:text-amber-400"
  if (status === "SUBMITTED" || status === "RESUBMITTED")
    return "border-blue-500/30 bg-blue-500/10 text-blue-700 [@media(prefers-color-scheme:dark)]:text-blue-400"
  if (status === "DRAFT")
    return "border-slate-400/30 bg-slate-500/10 text-slate-700 [@media(prefers-color-scheme:dark)]:text-slate-300"
  return "border-border bg-muted/20 text-foreground"
}

export function TeacherSubmissionsManager() {
  const [items, setItems] = useState<SubmissionItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "graded">("all")
  const [savingId, setSavingId] = useState<string | null>(null)
  const [scoreDrafts, setScoreDrafts] = useState<Record<string, string>>({})
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<string, string>>({})

  const load = async () => {
    try {
      const response = await fetch("/api/teacher/assessments/submissions", { cache: "no-store" })
      if (!response.ok) {
        setError("Unable to load submissions.")
        return
      }
      const data = (await response.json()) as { submissions: SubmissionItem[] }
      setItems(data.submissions)
      setScoreDrafts(
        Object.fromEntries(
          data.submissions.map((row) => [row.id, row.score === null ? "" : String(row.score)]),
        ),
      )
      setFeedbackDrafts(
        Object.fromEntries(data.submissions.map((row) => [row.id, row.feedback ?? ""])),
      )
    } catch {
      setError("Unable to load submissions.")
    } finally {
      setIsLoading(false)
    }
  }

  const refresh = async () => {
    setError(null)
    setIsLoading(true)
    await load()
  }

  useEffect(() => {
    void load()
  }, [])

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

  const save = async (submissionId: string, maxMarks: number) => {
    setMessage(null)
    setSavingId(submissionId)

    try {
      const scoreRaw = scoreDrafts[submissionId] ?? ""
      const score = scoreRaw.trim() === "" ? null : Number(scoreRaw)

      if (score !== null && (!Number.isFinite(score) || score < 0 || score > maxMarks)) {
        setMessage(`Score must be between 0 and ${maxMarks}.`)
        return
      }

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
        await refresh()
      }
    } catch {
      setMessage("Unable to save changes.")
    } finally {
      setSavingId(null)
    }
  }

  if (isLoading) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Loading submissions…</p>
  }

  if (error) {
    return <p className="py-10 text-center text-sm text-destructive">{error}</p>
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
                <p className="whitespace-pre-wrap">
                  {item.contentText?.trim() || "No text submitted."}
                </p>
              </div>

              <div className="grid gap-3 lg:grid-cols-[140px_1fr_auto]">
                <Input
                  type="number"
                  min={0}
                  max={item.assessment.maxMarks}
                  value={scoreDrafts[item.id] ?? ""}
                  onChange={(event) =>
                    setScoreDrafts((prev) => ({ ...prev, [item.id]: event.target.value }))
                  }
                  aria-label={`Score for ${item.student.fullName} on ${item.assessment.title}`}
                  placeholder={`0-${item.assessment.maxMarks}`}
                  className="w-full"
                />
                <Input
                  value={feedbackDrafts[item.id] ?? ""}
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
                  onClick={() => save(item.id, item.assessment.maxMarks)}
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

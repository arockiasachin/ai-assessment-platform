"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import {
  BookOpenCheck,
  CalendarClock,
  ClipboardList,
  Eye,
  FileCheck2,
  Filter,
  Search,
  Sparkles,
  Target,
} from "lucide-react"
import { GradeBadge } from "@/components/grade-badge"
import { Badge } from "@/components/ui/badge"
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
import type { StudentAssessmentItem, StudentAssessmentsPayload } from "@/lib/student-assessments"

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function round(value: number, places = 1) {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

function dueTone(assessment: StudentAssessmentItem): "destructive" | "secondary" | "outline" {
  if (assessment.isPastDue) return "destructive"
  if (assessment.daysUntilDue <= 3) return "secondary"
  return "outline"
}

function dueLabel(assessment: StudentAssessmentItem) {
  if (assessment.daysUntilDue === 0) return "Due today"
  if (assessment.daysUntilDue === 1) return "Due tomorrow"
  if (assessment.daysUntilDue > 1) return `Due in ${assessment.daysUntilDue} days`
  return `${Math.abs(assessment.daysUntilDue)} days overdue`
}

function submissionLabel(state: StudentAssessmentItem["submissionState"]) {
  if (state === "graded") return "Graded"
  if (state === "submitted") return "Submitted"
  if (state === "resubmitted") return "Resubmitted"
  if (state === "late") return "Late submission"
  if (state === "draft") return "Draft"
  return "Not submitted"
}

function submissionTone(state: StudentAssessmentItem["submissionState"]) {
  if (state === "graded") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
  if (state === "submitted" || state === "resubmitted")
    return "border-blue-500/30 bg-blue-500/10 text-blue-700"
  if (state === "late") return "border-amber-500/30 bg-amber-500/10 text-amber-700"
  if (state === "draft") return "border-slate-400/30 bg-slate-500/10 text-slate-700"
  return "border-border bg-muted/20 text-foreground"
}

export function StudentAssessmentsView() {
  const [payload, setPayload] = useState<StudentAssessmentsPayload | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState<"all" | "Quiz" | "Assignment">("all")
  const [courseFilter, setCourseFilter] = useState<string>("all")
  const [statusFilter, setStatusFilter] = useState<"all" | "graded" | "pending" | "overdue">("all")
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [submissionDrafts, setSubmissionDrafts] = useState<Record<string, string>>({})
  const [savingSubmissionId, setSavingSubmissionId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    try {
      const response = await fetch("/api/student/assessments", { cache: "no-store" })
      if (!response.ok) {
        setError("Unable to load assessments right now.")
        return
      }
      const data = (await response.json()) as StudentAssessmentsPayload
      setPayload(data)
      setSubmissionDrafts(
        Object.fromEntries(data.assessments.map((item) => [item.id, item.submissionContent ?? ""])),
      )
    } catch {
      setError("Unable to load assessments right now.")
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

  const allAssessments = useMemo(() => payload?.assessments ?? [], [payload])

  const courseOptions = useMemo(
    () =>
      Array.from(
        new Map(allAssessments.map((item) => [item.courseId, item.courseName])).entries(),
      ).map(([id, name]) => ({
        id,
        name,
      })),
    [allAssessments],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()

    return allAssessments.filter((item) => {
      if (typeFilter !== "all" && item.type !== typeFilter) return false
      if (courseFilter !== "all" && item.courseId !== courseFilter) return false

      if (statusFilter === "graded" && item.percentage === null) return false
      if (statusFilter === "pending" && item.percentage !== null) return false
      if (statusFilter === "overdue" && !item.isPastDue) return false

      if (!q) return true
      const text = [item.title, item.courseName, item.courseCode, item.className, item.teacherName]
        .join(" ")
        .toLowerCase()
      return text.includes(q)
    })
  }, [allAssessments, courseFilter, search, statusFilter, typeFilter])

  const summary = useMemo(() => {
    const graded = allAssessments.filter((item) => item.percentage !== null)
    const avg =
      graded.length > 0
        ? graded.reduce((sum, item) => sum + (item.percentage ?? 0), 0) / graded.length
        : null

    const upcoming = allAssessments.filter(
      (item) => item.daysUntilDue >= 0 && item.daysUntilDue <= 7,
    ).length

    return {
      total: allAssessments.length,
      graded: graded.length,
      average: avg,
      upcoming,
    }
  }, [allAssessments])

  if (isLoading) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Loading assessments…</p>
  }

  if (error || !payload) {
    return (
      <p className="py-10 text-center text-sm text-destructive">
        {error ?? "Unable to load assessments."}
      </p>
    )
  }

  const submitAssignment = async (
    assessmentId: string,
    action: "saveDraft" | "submit" | "resubmit",
  ) => {
    const content = submissionDrafts[assessmentId] ?? ""
    setMessage(null)
    setError(null)
    setSavingSubmissionId(assessmentId)

    try {
      const response = await fetch(`/api/student/assessments/${assessmentId}/submission`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentText: content, action }),
      })

      const data = (await response.json()) as { success?: boolean; message?: string }

      if (!response.ok) {
        setError(data.message ?? "Unable to submit assignment.")
        return
      }

      setMessage(data.message ?? "Submission updated.")
      await refresh()
    } catch {
      setError("Unable to submit assignment.")
    } finally {
      setSavingSubmissionId(null)
    }
  }

  return (
    <div className="space-y-6">
      {message && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-md border border-destructive/60 bg-destructive/10 px-3 py-2 text-sm text-destructive">
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
              Assessment hub
            </Badge>
            <h3 className="text-lg font-semibold tracking-tight">
              Track every assessment with full detail
            </h3>
            <p className="text-sm text-muted-foreground">
              Inspect scores, due windows, feedback, and course context in one place.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <div className="rounded-md border border-border/70 bg-background/80 px-2 py-1.5 text-center">
              <p className="text-muted-foreground">Total</p>
              <p className="font-semibold text-foreground">{summary.total}</p>
            </div>
            <div className="rounded-md border border-border/70 bg-background/80 px-2 py-1.5 text-center">
              <p className="text-muted-foreground">Graded</p>
              <p className="font-semibold text-foreground">{summary.graded}</p>
            </div>
            <div className="rounded-md border border-border/70 bg-background/80 px-2 py-1.5 text-center">
              <p className="text-muted-foreground">Average</p>
              <p className="font-semibold text-foreground">
                {summary.average === null ? "—" : `${round(summary.average)}%`}
              </p>
            </div>
            <div className="rounded-md border border-border/70 bg-background/80 px-2 py-1.5 text-center">
              <p className="text-muted-foreground">Due in 7d</p>
              <p className="font-semibold text-foreground">{summary.upcoming}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-sm">
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-2 text-base tracking-tight">
            <Filter className="size-4 text-primary" />
            Filter and explore
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="relative xl:col-span-2">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by title, course, class, or teacher"
              className="pl-8"
            />
          </div>

          <Select
            value={typeFilter}
            onValueChange={(value) =>
              setTypeFilter((value as "all" | "Quiz" | "Assignment") ?? "all")
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="Quiz">Quiz</SelectItem>
              <SelectItem value="Assignment">Assignment</SelectItem>
            </SelectContent>
          </Select>

          <Select value={courseFilter} onValueChange={(value) => setCourseFilter(value ?? "all")}>
            <SelectTrigger>
              <SelectValue placeholder="Course" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All courses</SelectItem>
              {courseOptions.map((course) => (
                <SelectItem key={course.id} value={course.id}>
                  {course.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={statusFilter}
            onValueChange={(value) =>
              setStatusFilter((value as "all" | "graded" | "pending" | "overdue") ?? "all")
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="graded">Graded</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {filtered.map((assessment) => {
          const isExpanded = Boolean(expanded[assessment.id])
          const tone = dueTone(assessment)

          return (
            <Card key={assessment.id} className="overflow-hidden border-border/70 shadow-sm">
              <CardContent className="p-0">
                <button
                  type="button"
                  className="flex w-full flex-col gap-3 px-4 py-4 text-left sm:flex-row sm:items-start sm:justify-between"
                  onClick={() =>
                    setExpanded((prev) => ({ ...prev, [assessment.id]: !prev[assessment.id] }))
                  }
                >
                  <div className="space-y-1">
                    <p className="font-semibold tracking-tight">{assessment.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {assessment.courseCode} · {assessment.courseName} · {assessment.className}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {assessment.term} {assessment.academicYear} · Teacher:{" "}
                      {assessment.teacherName}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <Badge variant={tone}>{dueLabel(assessment)}</Badge>
                    <Badge variant="outline">{assessment.type}</Badge>
                    <Badge variant="outline" className={submissionTone(assessment.submissionState)}>
                      {submissionLabel(assessment.submissionState)}
                    </Badge>
                    <GradeBadge pct={assessment.percentage} />
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-border/70 bg-muted/10 px-4 py-4">
                    <div className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-lg border border-border/70 bg-background px-3 py-2">
                        <p className="text-xs text-muted-foreground">Due date</p>
                        <p className="mt-1 font-medium">{formatDateTime(assessment.dueDate)}</p>
                      </div>
                      <div className="rounded-lg border border-border/70 bg-background px-3 py-2">
                        <p className="text-xs text-muted-foreground">Your score</p>
                        <p className="mt-1 font-medium">
                          {assessment.score === null
                            ? "Not graded"
                            : `${assessment.score}/${assessment.maxMarks} (${round(assessment.percentage ?? 0)}%)`}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border/70 bg-background px-3 py-2">
                        <p className="text-xs text-muted-foreground">Class average</p>
                        <p className="mt-1 font-medium">
                          {assessment.classAveragePercentage === null
                            ? "—"
                            : `${round(assessment.classAveragePercentage)}%`}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border/70 bg-background px-3 py-2">
                        <p className="text-xs text-muted-foreground">Quiz questions</p>
                        <p className="mt-1 font-medium">
                          {assessment.type === "Quiz" ? assessment.quizQuestionCount : "N/A"}
                        </p>
                      </div>
                    </div>

                    {assessment.feedback && (
                      <div className="mt-3 rounded-lg border border-border/70 bg-background px-3 py-2 text-sm">
                        <p className="text-xs font-medium text-muted-foreground">
                          Teacher feedback
                        </p>
                        <p className="mt-1">{assessment.feedback}</p>
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      {assessment.type === "Quiz" ? (
                        <Link href="/quiz" className="inline-flex">
                          <Button size="sm" variant="outline">
                            <BookOpenCheck className="size-4" />
                            Open quiz center
                          </Button>
                        </Link>
                      ) : (
                        <div className="w-full space-y-2">
                          <textarea
                            value={submissionDrafts[assessment.id] ?? ""}
                            onChange={(event) =>
                              setSubmissionDrafts((prev) => ({
                                ...prev,
                                [assessment.id]: event.target.value,
                              }))
                            }
                            placeholder="Write your assignment submission details..."
                            className="min-h-24 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                            maxLength={4000}
                            readOnly={assessment.submissionState === "graded"}
                          />
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>{submissionLabel(assessment.submissionState)}</span>
                            <span>{(submissionDrafts[assessment.id] ?? "").length}/4000</span>
                          </div>
                          <div className="grid gap-2 sm:flex sm:flex-wrap">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void submitAssignment(assessment.id, "saveDraft")}
                              disabled={
                                savingSubmissionId === assessment.id ||
                                assessment.submissionState === "graded"
                              }
                              className="w-full sm:w-auto"
                            >
                              Save draft
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                void submitAssignment(
                                  assessment.id,
                                  assessment.submissionState === "not_submitted" ||
                                    assessment.submissionState === "draft"
                                    ? "submit"
                                    : "resubmit",
                                )
                              }
                              disabled={
                                savingSubmissionId === assessment.id ||
                                assessment.submissionState === "graded"
                              }
                              className="w-full sm:w-auto"
                            >
                              <FileCheck2 className="size-4" />
                              {assessment.submissionState === "not_submitted" ||
                              assessment.submissionState === "draft"
                                ? "Submit assignment"
                                : "Resubmit assignment"}
                            </Button>
                          </div>
                        </div>
                      )}
                      <Button size="sm" variant="outline" disabled>
                        <Eye className="size-4" />
                        Detailed rubric soon
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}

        {filtered.length === 0 && (
          <Card className="border-border/70 shadow-sm">
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No assessments match the current filters.
            </CardContent>
          </Card>
        )}
      </div>

      <Card className="border-border/70 shadow-sm">
        <CardContent className="grid gap-3 py-5 sm:grid-cols-3">
          <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
            <p className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <ClipboardList className="size-3.5" />
              Grading detail
            </p>
            <p className="mt-1 text-sm">
              Every score is normalized against max marks for accurate percentage comparisons.
            </p>
          </div>
          <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
            <p className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Target className="size-3.5" />
              Status tracking
            </p>
            <p className="mt-1 text-sm">
              See whether each item is graded, submitted, overdue, or still pending work.
            </p>
          </div>
          <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
            <p className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <CalendarClock className="size-3.5" />
              Deadline visibility
            </p>
            <p className="mt-1 text-sm">Due-window badges help prioritize what to complete next.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { BookOpenCheck, Download, FileUp, ListChecks, PlusCircle, Sparkles } from "lucide-react"
import { useGradebook } from "@/components/gradebook-provider"
import { isOfferingClosed } from "@/lib/offering-window"
import { Button, buttonVariants } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { TeacherSubmissionsManager } from "@/components/teacher-submissions-manager"
import type { TeacherSubmissionRow } from "@/lib/teacher-submissions"
import type { CreateAssessmentRequest } from "@/lib/contracts"
import { ASSESSMENT_KIND_LABEL } from "@/lib/labels"

type QuizImportResponse = {
  success: boolean
  message: string
  /** Every problem the import found, in question order. Absent on success. */
  errors?: string[]
  assessment?: {
    id: string
    title: string
    courseName: string
    questionCount: number
    /** True when the questions were appended to an existing quiz. */
    appended?: boolean
  }
}

type AssignmentCreateResponse = {
  success: boolean
  message?: string
  /** False when an identical assessment already existed (idempotent create). */
  created?: boolean
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10)
}

/** Every kind the schema holds, in a stable order for the create menu. */
const ASSESSMENT_KINDS: readonly CreateAssessmentRequest["type"][] = [
  "QUIZ",
  "ASSIGNMENT",
  "DESCRIPTIVE",
  "CODE",
  "GROUP_PROJECT",
]

export function TeacherAssignmentsManager({
  submissionRows,
}: {
  /**
   * The submissions queue's rows, fetched on the server by `app/(dashboard)/teacher/assignments/page.tsx`.
   * Threaded through this component rather than fetched by the queue itself, because the queue renders
   * inside this one rather than at a page root — see the note on `TeacherSubmissionsManager`.
   */
  submissionRows: TeacherSubmissionRow[]
}) {
  const { offerings, refresh } = useGradebook()
  /**
   * Offerings a new assessment can be authored into: the ones whose term has not
   * finished. A completed 2025 offering used to sit in the picker with no guard, so a
   * teacher could author into a closed term and see it appear in the current-term grid
   * and planner (TN-62). A term with no `endsOn` is unscheduled, not closed.
   */
  const openOfferings = useMemo(
    () => offerings.filter((offering) => !isOfferingClosed(offering.endsOn)),
    [offerings],
  )
  /**
   * The value→label map Base UI's `Select.Value` needs to render a label in the trigger
   * instead of the raw id (TN-7). It is the same data the popup options render, so the two
   * cannot disagree.
   */
  const offeringItems = useMemo(
    () =>
      openOfferings.map((offering) => ({
        value: offering.id,
        label: `${offering.courseName} — ${offering.className} (${offering.term} ${offering.academicYear})`,
      })),
    [openOfferings],
  )
  const kindItems = useMemo(
    () => ASSESSMENT_KINDS.map((kind) => ({ value: kind, label: ASSESSMENT_KIND_LABEL[kind] })),
    [],
  )
  const router = useRouter()

  const [offeringId, setOfferingId] = useState("")
  const [assignmentTitle, setAssignmentTitle] = useState("")
  const [assignmentDate, setAssignmentDate] = useState(todayIsoDate())
  const [assignmentMaxMarks, setAssignmentMaxMarks] = useState("50")
  /**
   * The kind of assessment to create.
   *
   * Every kind the schema holds is offered. This used to be hardcoded to `"Assignment"`, so three
   * of the five kinds — descriptive, code and group project — could not be authored at all, even
   * though the app reads and grades them everywhere.
   */
  const [assignmentKind, setAssignmentKind] =
    useState<CreateAssessmentRequest["type"]>("ASSIGNMENT")
  const [isSavingAssignment, setIsSavingAssignment] = useState(false)

  const [quizFileName, setQuizFileName] = useState("")
  const [quizPayload, setQuizPayload] = useState<{ questions?: unknown[] } | null>(null)
  const [quizOfferingId, setQuizOfferingId] = useState("")
  const [isImportingQuiz, setIsImportingQuiz] = useState(false)

  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /**
   * The per-question problems the import route returns. Held separately from
   * `error` so the card can show a checklist rather than one line; an import can
   * fail several questions at once.
   */
  const [quizErrors, setQuizErrors] = useState<string[]>([])

  // Derive the effective offering rather than syncing it into state via an effect.
  const selectedOfferingId = offeringId || openOfferings[0]?.id || ""
  // The quiz import targets its own offering: a teacher may import a quiz while
  // the assignment form is pointed at a different class.
  const quizSelectedOfferingId = quizOfferingId || openOfferings[0]?.id || ""

  const canCreateAssignment = useMemo(() => {
    const max = Number(assignmentMaxMarks)
    return (
      Boolean(assignmentTitle.trim()) &&
      Boolean(selectedOfferingId) &&
      Number.isFinite(max) &&
      // The API's schema takes an integer; without this the raw zod message
      // ("Invalid input: expected int, received number") reached the teacher (TN-61).
      Number.isInteger(max) &&
      max > 0
    )
  }, [assignmentMaxMarks, assignmentTitle, selectedOfferingId])

  const maxMarksIsWhole = useMemo(() => {
    if (assignmentMaxMarks.trim() === "") return true
    const max = Number(assignmentMaxMarks)
    return Number.isFinite(max) && Number.isInteger(max)
  }, [assignmentMaxMarks])

  const importedQuestionCount = useMemo(() => {
    if (!quizPayload?.questions) return 0
    return Array.isArray(quizPayload.questions) ? quizPayload.questions.length : 0
  }, [quizPayload])

  const createAssignment = async () => {
    if (!canCreateAssignment) return

    setError(null)
    setMessage(null)
    setIsSavingAssignment(true)

    try {
      const response = await fetch("/api/gradebook/assessments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: assignmentTitle.trim(),
          offeringId: selectedOfferingId,
          type: assignmentKind,
          date: assignmentDate,
          maxMarks: Number(assignmentMaxMarks),
        }),
      })

      const data = (await response.json()) as AssignmentCreateResponse
      if (!response.ok) {
        setError(data.message ?? "Unable to create assessment.")
        return
      }

      setMessage(
        data.created === false
          ? "An identical assessment already existed — nothing was duplicated."
          : "Assessment created. Add its questions, rubric or code task below.",
      )
      setAssignmentTitle("")
      setAssignmentDate(todayIsoDate())
      setAssignmentMaxMarks("50")
      await refresh()
      // Re-run the server component so the registry list below reflects the new row.
      router.refresh()
    } catch {
      setError("Unable to create assessment.")
    } finally {
      setIsSavingAssignment(false)
    }
  }

  const onQuizFileChange = async (file: File | null) => {
    if (!file) {
      setQuizFileName("")
      setQuizPayload(null)
      return
    }

    setError(null)
    setQuizErrors([])
    setMessage(null)

    try {
      const content = await file.text()
      const parsed = JSON.parse(content) as { questions?: unknown[] }
      setQuizFileName(file.name)
      setQuizPayload(parsed)
    } catch {
      setQuizFileName(file.name)
      setQuizPayload(null)
      setError("Uploaded file is not valid JSON.")
    }
  }

  const importQuizFromJson = async () => {
    if (!quizPayload || !quizSelectedOfferingId) return

    setError(null)
    setQuizErrors([])
    setMessage(null)
    setIsImportingQuiz(true)

    try {
      const response = await fetch("/api/teacher/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...quizPayload, offeringId: quizSelectedOfferingId }),
      })

      const data = (await response.json()) as QuizImportResponse
      if (!response.ok || !data.success || !data.assessment) {
        setError(data.message || "Unable to import quiz.")
        setQuizErrors(data.errors ?? [])
        return
      }

      const { assessment } = data
      setMessage(
        assessment.appended
          ? `Added ${assessment.questionCount} question${assessment.questionCount === 1 ? "" : "s"} to ${assessment.title} in ${assessment.courseName}.`
          : `Quiz created: ${assessment.title} (${assessment.questionCount} questions) for ${assessment.courseName}.`,
      )
      setQuizFileName("")
      setQuizPayload(null)
      await refresh()
    } catch {
      setError("Unable to import quiz.")
    } finally {
      setIsImportingQuiz(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card className="border-primary/20 bg-gradient-to-br from-primary/10 via-background to-background shadow-sm">
        <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Badge
              variant="outline"
              className="mb-2 w-fit gap-1.5 border-primary/30 bg-background/70 text-primary"
            >
              <Sparkles className="size-3.5" />
              Assessment studio
            </Badge>
            <p className="text-sm font-semibold">
              Create assessments and import quiz packs from JSON
            </p>
            <p className="text-xs text-muted-foreground">
              Everything you publish here is scoped to your teacher-owned offerings.
            </p>
          </div>
          <Badge variant="secondary" className="w-fit">
            {offerings.length} class offerings
          </Badge>
        </CardContent>
      </Card>

      {message && (
        <p
          role="status"
          className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400"
        >
          {message}
        </p>
      )}
      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/60 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {quizErrors.length > 0 ? (
            <>
              <p className="font-medium">The quiz could not be imported:</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {quizErrors.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </>
          ) : (
            <p>{error}</p>
          )}
        </div>
      )}

      <Card className="border-border/70 shadow-sm">
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-2 text-base">
            <BookOpenCheck className="size-4 text-primary" />
            Create assessment
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Create a standard assessment for a selected course.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="assignment-title">Title</Label>
              <Input
                id="assignment-title"
                value={assignmentTitle}
                onChange={(event) => setAssignmentTitle(event.target.value)}
                placeholder="e.g. Week 4 Problem Set"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="assignment-offering">Class offering</Label>
              <Select
                value={selectedOfferingId}
                onValueChange={(value) => setOfferingId(value ?? "")}
                items={offeringItems}
              >
                <SelectTrigger id="assignment-offering">
                  <SelectValue placeholder="Select an offering" />
                </SelectTrigger>
                <SelectContent>
                  {openOfferings.map((offering) => (
                    <SelectItem key={offering.id} value={offering.id}>
                      {offering.courseName} — {offering.className} ({offering.term}{" "}
                      {offering.academicYear})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="assignment-kind">Type</Label>
              <Select
                value={assignmentKind}
                onValueChange={(value) =>
                  setAssignmentKind((value as CreateAssessmentRequest["type"]) ?? "ASSIGNMENT")
                }
                items={kindItems}
              >
                <SelectTrigger id="assignment-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSESSMENT_KINDS.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {ASSESSMENT_KIND_LABEL[kind]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="assignment-date">Due date</Label>
              <Input
                id="assignment-date"
                type="date"
                value={assignmentDate}
                onChange={(event) => setAssignmentDate(event.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="assignment-max-marks">Max marks</Label>
              <Input
                id="assignment-max-marks"
                type="number"
                min={1}
                step={1}
                value={assignmentMaxMarks}
                onChange={(event) => setAssignmentMaxMarks(event.target.value)}
              />
              {!maxMarksIsWhole && (
                <p className="text-xs text-destructive" role="alert">
                  Max marks must be a whole number.
                </p>
              )}
            </div>
          </div>

          <Button
            type="button"
            onClick={createAssignment}
            disabled={!canCreateAssignment || isSavingAssignment}
          >
            <PlusCircle className="size-4" />
            {isSavingAssignment ? "Creating..." : "Create assessment"}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-sm">
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-2 text-base">
            <ListChecks className="size-4 text-primary" />
            Import quiz JSON
          </CardTitle>
          <CardDescription>
            Upload JSON and create a quiz assessment with questions in one action. The blank
            template shows the shortest accepted shape.
          </CardDescription>
          <CardAction>
            <a
              href="/quiz-template.json"
              download="quiz-template.json"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Download className="size-4" />
              Download template
            </a>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="quiz-offering">Class offering</Label>
            <Select
              value={quizSelectedOfferingId}
              onValueChange={(value) => setQuizOfferingId(value ?? "")}
              items={offeringItems}
            >
              <SelectTrigger id="quiz-offering">
                <SelectValue placeholder="Select an offering" />
              </SelectTrigger>
              <SelectContent>
                {openOfferings.map((offering) => (
                  <SelectItem key={offering.id} value={offering.id}>
                    {offering.courseName} — {offering.className} ({offering.term}{" "}
                    {offering.academicYear})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              The quiz is imported into this offering. A course taught in two classes is
              disambiguated by the offering, never by course name.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="quiz-json-file">Quiz file (.json)</Label>
            <Input
              id="quiz-json-file"
              type="file"
              accept="application/json,.json"
              onChange={(event) => void onQuizFileChange(event.target.files?.[0] ?? null)}
            />
          </div>

          <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
            <p>
              File:{" "}
              <span className="font-medium text-foreground">{quizFileName || "None selected"}</span>
            </p>
            <p>
              Detected questions:{" "}
              <span className="font-medium text-foreground">{importedQuestionCount}</span>
            </p>
          </div>

          <Button
            type="button"
            variant="secondary"
            onClick={importQuizFromJson}
            disabled={!quizPayload || !quizSelectedOfferingId || isImportingQuiz}
          >
            <FileUp className="size-4" />
            {isImportingQuiz ? "Importing..." : "Create quiz from JSON"}
          </Button>
        </CardContent>
      </Card>

      <TeacherSubmissionsManager rows={submissionRows} />
    </div>
  )
}

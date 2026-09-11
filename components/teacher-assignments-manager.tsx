"use client"

import { useEffect, useMemo, useState } from "react"
import { BookOpenCheck, FileUp, ListChecks, PlusCircle, Sparkles } from "lucide-react"
import { useGradebook } from "@/components/gradebook-provider"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { TeacherSubmissionsManager } from "@/components/teacher-submissions-manager"

type QuizImportResponse = {
  success: boolean
  message: string
  assessment?: {
    id: string
    title: string
    courseName: string
    questionCount: number
  }
}

type AssignmentCreateResponse = {
  success: boolean
  message?: string
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10)
}

export function TeacherAssignmentsManager() {
  const { courses, refresh } = useGradebook()

  const [courseId, setCourseId] = useState("")
  const [assignmentTitle, setAssignmentTitle] = useState("")
  const [assignmentDate, setAssignmentDate] = useState(todayIsoDate())
  const [assignmentMaxMarks, setAssignmentMaxMarks] = useState("50")
  const [isSavingAssignment, setIsSavingAssignment] = useState(false)

  const [quizFileName, setQuizFileName] = useState("")
  const [quizPayload, setQuizPayload] = useState<{ questions?: unknown[] } | null>(null)
  const [isImportingQuiz, setIsImportingQuiz] = useState(false)

  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!courseId && courses.length > 0) {
      setCourseId(courses[0].id)
    }
  }, [courseId, courses])

  const canCreateAssignment = useMemo(() => {
    const max = Number(assignmentMaxMarks)
    return Boolean(assignmentTitle.trim()) && Boolean(courseId) && Number.isFinite(max) && max > 0
  }, [assignmentMaxMarks, assignmentTitle, courseId])

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
          courseId,
          type: "Assignment",
          date: assignmentDate,
          maxMarks: Number(assignmentMaxMarks),
        }),
      })

      const data = (await response.json()) as AssignmentCreateResponse
      if (!response.ok) {
        setError(data.message ?? "Unable to create assignment.")
        return
      }

      setMessage("Assignment created.")
      setAssignmentTitle("")
      setAssignmentDate(todayIsoDate())
      setAssignmentMaxMarks("50")
      await refresh()
    } catch {
      setError("Unable to create assignment.")
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
    if (!quizPayload) return

    setError(null)
    setMessage(null)
    setIsImportingQuiz(true)

    try {
      const response = await fetch("/api/teacher/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(quizPayload),
      })

      const data = (await response.json()) as QuizImportResponse
      if (!response.ok || !data.success || !data.assessment) {
        setError(data.message || "Unable to import quiz.")
        return
      }

      setMessage(
        `Quiz created: ${data.assessment.title} (${data.assessment.questionCount} questions) for ${data.assessment.courseName}.`,
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
            <Badge variant="outline" className="mb-2 w-fit gap-1.5 border-primary/30 bg-background/70 text-primary">
              <Sparkles className="size-3.5" />
              Assessment studio
            </Badge>
            <p className="text-sm font-semibold">Create assignments and import quiz packs from JSON</p>
            <p className="text-xs text-muted-foreground">Everything you publish here is scoped to your teacher-owned offerings.</p>
          </div>
          <Badge variant="secondary" className="w-fit">
            {courses.length} available courses
          </Badge>
        </CardContent>
      </Card>

      {message && <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">{message}</p>}
      {error && <p className="rounded-md border border-destructive/60 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      <Card className="border-border/70 shadow-sm">
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-2 text-base">
            <BookOpenCheck className="size-4 text-primary" />
            Create assignment
          </CardTitle>
          <p className="text-sm text-muted-foreground">Create a standard assignment for a selected course.</p>
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
              <Label>Course</Label>
              <Select value={courseId} onValueChange={(value) => setCourseId(value ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder="Select course" />
                </SelectTrigger>
                <SelectContent>
                  {courses.map((course) => (
                    <SelectItem key={course.id} value={course.id}>
                      {course.name}
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
                value={assignmentMaxMarks}
                onChange={(event) => setAssignmentMaxMarks(event.target.value)}
              />
            </div>
          </div>

          <Button type="button" onClick={createAssignment} disabled={!canCreateAssignment || isSavingAssignment}>
            <PlusCircle className="size-4" />
            {isSavingAssignment ? "Creating..." : "Create assignment"}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-sm">
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-2 text-base">
            <ListChecks className="size-4 text-primary" />
            Import quiz JSON
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Upload JSON and create a quiz assessment with questions in one action.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
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
            <p>File: <span className="font-medium text-foreground">{quizFileName || "None selected"}</span></p>
            <p>Detected questions: <span className="font-medium text-foreground">{importedQuestionCount}</span></p>
          </div>

          <Button type="button" variant="secondary" onClick={importQuizFromJson} disabled={!quizPayload || isImportingQuiz}>
            <FileUp className="size-4" />
            {isImportingQuiz ? "Importing..." : "Create quiz from JSON"}
          </Button>
        </CardContent>
      </Card>

      <TeacherSubmissionsManager />
    </div>
  )
}

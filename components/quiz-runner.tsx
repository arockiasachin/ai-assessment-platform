"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { ArrowLeft, CheckCircle2, XCircle, GraduationCap, Clock, RotateCcw, Trophy } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { useGradebook } from "@/components/gradebook-provider"
import {
  formatDate,
  initials,
  letterGrade,
  quizForAssessment,
  round,
  type Assessment,
} from "@/lib/gradebook"
import { cn } from "@/lib/utils"

type Stage = "select" | "taking" | "results"

export function QuizRunner() {
  const {
    students,
    assessments,
    quizzes,
    isLoading,
    selectedStudentId,
    setSelectedStudentId,
    setMark,
  } = useGradebook()

  const [stage, setStage] = useState<Stage>("select")
  const [activeId, setActiveId] = useState<string | null>(null)
  const [current, setCurrent] = useState(0)
  const [answers, setAnswers] = useState<Record<string, number>>({})

  const available = useMemo(
    () =>
      quizzes
        .map((q) => assessments.find((a) => a.id === q.assessmentId && a.type === "Quiz"))
        .filter((a): a is Assessment => Boolean(a)),
    [assessments, quizzes],
  )

  const quiz = activeId ? quizForAssessment(quizzes, activeId) : undefined
  const assessment = activeId ? assessments.find((a) => a.id === activeId) : undefined
  const student = students.find((s) => s.id === selectedStudentId) ?? students[0] ?? null

  function start(id: string) {
    setActiveId(id)
    setAnswers({})
    setCurrent(0)
    setStage("taking")
  }

  function reset() {
    setActiveId(null)
    setAnswers({})
    setCurrent(0)
    setStage("select")
  }

  const correctCount = useMemo(() => {
    if (!quiz) return 0
    return quiz.questions.reduce((n, q) => (answers[q.id] === q.correctIndex ? n + 1 : n), 0)
  }, [quiz, answers])

  if (isLoading) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Loading quizzes…</p>
  }

  if (!student) {
    return <p className="py-10 text-center text-sm text-muted-foreground">No students available.</p>
  }

  function submit() {
    if (!quiz || !assessment) return
    const pctCorrect = correctCount / quiz.questions.length
    const score = Math.round(pctCorrect * assessment.maxMarks)
    // Record the graded quiz straight into the shared gradebook.
    setMark(student.id, assessment.id, score)
    setStage("results")
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <GraduationCap className="size-5" />
            </div>
            <div>
              <h1 className="text-base font-semibold leading-none tracking-tight">Quiz Center</h1>
              <p className="mt-1 text-xs text-muted-foreground">Take an assessment</p>
            </div>
          </div>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <ArrowLeft className="size-4" />
            Dashboard
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        {stage === "select" && (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-balance">Available quizzes</h2>
                <p className="mt-1 text-sm text-muted-foreground text-pretty">
                  Pick a quiz to attempt. Your score is graded instantly and saved to the gradebook.
                </p>
              </div>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Taking as</span>
                <Select value={student.id} onValueChange={(v) => v && setSelectedStudentId(v)}>
                  <SelectTrigger className="w-52">
                    <SelectValue>{(value) => students.find((s) => s.id === value)?.name}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {students.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {available.map((a) => {
                const q = quizForAssessment(quizzes, a.id)!
                return (
                  <Card key={a.id} className="flex flex-col">
                    <CardHeader className="gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant="secondary">{a.courseName}</Badge>
                        <span className="text-xs text-muted-foreground">{formatDate(a.date)}</span>
                      </div>
                      <CardTitle className="text-base leading-snug text-pretty">{a.title}</CardTitle>
                    </CardHeader>
                    <CardContent className="mt-auto flex flex-col gap-4">
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          <Clock className="size-4" />
                          {q.questions.length} questions
                        </span>
                        <span>{a.maxMarks} marks</span>
                      </div>
                      <Button onClick={() => start(a.id)} className="w-full">
                        Start quiz
                      </Button>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </div>
        )}

        {stage === "taking" && quiz && assessment && (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Avatar className="size-7">
                    <AvatarFallback className="text-xs">{initials(student.name)}</AvatarFallback>
                  </Avatar>
                  <span className="text-sm text-muted-foreground">{student.name}</span>
                </div>
                <Badge variant="secondary">{assessment.courseName}</Badge>
              </div>
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-balance">{assessment.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Question {current + 1} of {quiz.questions.length}
                </p>
              </div>
              <Progress value={((current + 1) / quiz.questions.length) * 100} />
            </div>

            {(() => {
              const question = quiz.questions[current]
              const selected = answers[question.id]
              return (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg leading-snug text-pretty">{question.prompt}</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    {question.options.map((opt, i) => {
                      const active = selected === i
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setAnswers((prev) => ({ ...prev, [question.id]: i }))}
                          className={cn(
                            "flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors",
                            active
                              ? "border-primary bg-accent text-accent-foreground ring-1 ring-primary"
                              : "border-border bg-card hover:bg-muted/60",
                          )}
                        >
                          <span
                            className={cn(
                              "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                              active ? "border-primary bg-primary text-primary-foreground" : "border-border",
                            )}
                          >
                            {String.fromCharCode(65 + i)}
                          </span>
                          <span>{opt}</span>
                        </button>
                      )
                    })}
                  </CardContent>
                </Card>
              )
            })()}

            <div className="flex items-center justify-between gap-3">
              <Button
                variant="outline"
                onClick={() => setCurrent((c) => Math.max(0, c - 1))}
                disabled={current === 0}
              >
                Previous
              </Button>
              {current < quiz.questions.length - 1 ? (
                <Button
                  onClick={() => setCurrent((c) => Math.min(quiz.questions.length - 1, c + 1))}
                  disabled={answers[quiz.questions[current].id] === undefined}
                >
                  Next
                </Button>
              ) : (
                <Button
                  onClick={submit}
                  disabled={Object.keys(answers).length < quiz.questions.length}
                >
                  Submit quiz
                </Button>
              )}
            </div>
          </div>
        )}

        {stage === "results" && quiz && assessment && (
          <div className="flex flex-col gap-6">
            <Card className="overflow-hidden">
              <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
                <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Trophy className="size-7" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{assessment.title}</p>
                  <p className="mt-1 text-4xl font-bold tracking-tight">
                    {correctCount}
                    <span className="text-2xl text-muted-foreground">/{quiz.questions.length}</span>
                  </p>
                </div>
                {(() => {
                  const pct = round((correctCount / quiz.questions.length) * 100)
                  const score = Math.round((correctCount / quiz.questions.length) * assessment.maxMarks)
                  return (
                    <div className="flex items-center gap-2">
                      <Badge className="text-sm">{pct}%</Badge>
                      <Badge variant="secondary" className="text-sm">
                        Grade {letterGrade(pct)}
                      </Badge>
                      <Badge variant="secondary" className="text-sm">
                        {score}/{assessment.maxMarks} marks
                      </Badge>
                    </div>
                  )
                })()}
                <p className="max-w-sm text-sm text-muted-foreground text-pretty">
                  Saved to {student.name}&apos;s record. Review the answers below or head back to the dashboard.
                </p>
              </CardContent>
            </Card>

            <div className="flex flex-col gap-3">
              {quiz.questions.map((q, qi) => {
                const chosen = answers[q.id]
                const correct = chosen === q.correctIndex
                return (
                  <Card key={q.id}>
                    <CardContent className="flex flex-col gap-3 py-4">
                      <div className="flex items-start gap-2">
                        {correct ? (
                          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
                        ) : (
                          <XCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
                        )}
                        <p className="text-sm font-medium">
                          {qi + 1}. {q.prompt}
                        </p>
                      </div>
                      <div className="flex flex-col gap-1.5 pl-7 text-sm">
                        <p className="text-muted-foreground">
                          Your answer:{" "}
                          <span className={correct ? "text-success" : "text-destructive"}>
                            {chosen !== undefined ? q.options[chosen] : "—"}
                          </span>
                        </p>
                        {!correct && (
                          <p className="text-muted-foreground">
                            Correct answer: <span className="text-success">{q.options[q.correctIndex]}</span>
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>

            <div className="flex items-center justify-center gap-3">
              <Button variant="outline" onClick={reset} className="gap-1.5">
                <RotateCcw className="size-4" />
                Take another
              </Button>
              <Link href="/" className={cn(buttonVariants(), "gap-1.5")}>
                View dashboard
              </Link>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

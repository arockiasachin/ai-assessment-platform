"use client"

import { useState } from "react"
import { Loader2, Save, Send, Sparkles } from "lucide-react"

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
import type { OwnedQuizAssessmentSummary, QuizGenerationQuestionResponse } from "@/lib/contracts"

/**
 * Teacher quiz generation workspace.
 *
 * The server owns everything: the assessment list and the first assessment's
 * questions arrive as Server Component props, and every generate/save/publish
 * action re-validates ownership and shape on the server. Generated questions
 * arrive as `DRAFT`; only the explicit publish buttons publish them.
 */

type Counts = { draft: number; published: number }

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>
  } catch {
    return {}
  }
}

function messageFrom(data: Record<string, unknown>, fallback: string): string {
  return typeof data.message === "string" ? data.message : fallback
}

export function TeacherQuizGenerator({
  initialAssessments,
  initialQuestions,
  initialCounts,
}: {
  initialAssessments: OwnedQuizAssessmentSummary[]
  initialQuestions: QuizGenerationQuestionResponse[]
  initialCounts: Counts
}) {
  const first = initialAssessments[0] ?? null
  const [assessments] = useState(initialAssessments)
  const [selectedId, setSelectedId] = useState(first?.id ?? "")
  const [questions, setQuestions] = useState(initialQuestions)
  const [counts, setCounts] = useState(initialCounts)
  const [topic, setTopic] = useState("")
  const [questionCount, setQuestionCount] = useState("5")
  const [isGenerating, setIsGenerating] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selected = assessments.find((assessment) => assessment.id === selectedId) ?? null
  const draftIds = questions
    .filter((question) => question.state === "DRAFT")
    .map((question) => question.id)

  function applyList(next: QuizGenerationQuestionResponse[], nextCounts: Counts) {
    setQuestions(next)
    setCounts(nextCounts)
  }

  async function loadQuestions(assessmentId: string) {
    const response = await fetch(`/api/teacher/quiz/${assessmentId}`)
    const data = await readJson(response)
    if (!response.ok) {
      setError(messageFrom(data, "Unable to load questions."))
      return
    }
    applyList(
      (data.questions as QuizGenerationQuestionResponse[]) ?? [],
      (data.counts as Counts) ?? { draft: 0, published: 0 },
    )
  }

  async function selectAssessment(id: string) {
    setSelectedId(id)
    setMessage(null)
    setError(null)
    await loadQuestions(id)
  }

  function replaceQuestion(updated: QuizGenerationQuestionResponse) {
    setQuestions((prev) => {
      const next = prev.map((question) => (question.id === updated.id ? updated : question))
      setCounts({
        draft: next.filter((question) => question.state === "DRAFT").length,
        published: next.filter((question) => question.state === "PUBLISHED").length,
      })
      return next
    })
  }

  function updateQuestion(id: string, patch: Partial<QuizGenerationQuestionResponse>) {
    setQuestions((prev) =>
      prev.map((question) => (question.id === id ? { ...question, ...patch } : question)),
    )
  }

  function updateOption(
    questionId: string,
    optionId: string,
    patch: { text?: string; rationale?: string; isCorrect?: boolean },
  ) {
    setQuestions((prev) =>
      prev.map((question) =>
        question.id === questionId
          ? {
              ...question,
              options: question.options.map((option) =>
                option.id === optionId ? { ...option, ...patch } : option,
              ),
            }
          : question,
      ),
    )
  }

  function markCorrect(questionId: string, optionId: string) {
    setQuestions((prev) =>
      prev.map((question) =>
        question.id === questionId
          ? {
              ...question,
              options: question.options.map((option) => ({
                ...option,
                isCorrect: option.id === optionId,
              })),
            }
          : question,
      ),
    )
  }

  async function generate() {
    if (!selected) {
      setError("Select an assessment first.")
      return
    }
    if (topic.trim().length === 0) {
      setError("Describe the topic or lesson first.")
      return
    }
    setIsGenerating(true)
    setMessage(null)
    setError(null)
    try {
      const response = await fetch("/api/teacher/quiz/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assessmentId: selected.id,
          topic: topic.trim(),
          questionCount: Number(questionCount),
        }),
      })
      const data = await readJson(response)
      if (!response.ok) {
        setError(messageFrom(data, "Unable to generate questions."))
        return
      }
      setMessage(messageFrom(data, "Drafts created. Review, edit, then publish."))
      setTopic("")
      await loadQuestions(selected.id)
    } catch {
      setError("Unable to generate questions.")
    } finally {
      setIsGenerating(false)
    }
  }

  async function saveDraft(question: QuizGenerationQuestionResponse) {
    setBusyId(question.id)
    setMessage(null)
    setError(null)
    try {
      const response = await fetch(`/api/teacher/quiz/questions/${question.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: question.prompt,
          subtopic: question.subtopic ?? undefined,
          difficulty: question.difficulty ?? undefined,
          explanation: question.explanation ?? undefined,
          options: question.options.map((option) => ({
            text: option.text,
            isCorrect: option.isCorrect,
            rationale: option.rationale ?? "",
          })),
        }),
      })
      const data = await readJson(response)
      if (!response.ok) {
        setError(messageFrom(data, "Unable to save the draft."))
        return
      }
      const updated = data.question as QuizGenerationQuestionResponse | undefined
      if (updated) replaceQuestion(updated)
      setMessage("Draft saved.")
    } catch {
      setError("Unable to save the draft.")
    } finally {
      setBusyId(null)
    }
  }

  async function publish(questionIds: string[]) {
    if (!selected || questionIds.length === 0) return
    setBusyId("publish")
    setMessage(null)
    setError(null)
    try {
      const response = await fetch("/api/teacher/quiz/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assessmentId: selected.id, questionIds }),
      })
      const data = await readJson(response)
      if (!response.ok) {
        setError(messageFrom(data, "Unable to publish."))
        return
      }
      setMessage(messageFrom(data, "Published."))
      await loadQuestions(selected.id)
    } catch {
      setError("Unable to publish.")
    } finally {
      setBusyId(null)
    }
  }

  if (assessments.length === 0) {
    return (
      <Card className="border-border/70 shadow-sm">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          You have no quiz assessments yet. Create a quiz assessment first, then generate questions
          for it.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card className="border-primary/20 bg-gradient-to-br from-primary/10 via-background to-background shadow-sm">
        <CardContent className="pt-6">
          <Badge variant="outline" className="mb-2 w-fit border-primary/30 text-primary">
            Material-grounded generation
          </Badge>
          <p className="text-sm text-muted-foreground">
            Describe the topic; the system retrieves your course material and drafts questions with
            misconception-targeting distractors. Drafts stay hidden from students until you publish
            them.
          </p>
        </CardContent>
      </Card>

      {message && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
          {message}
        </div>
      )}
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card className="border-border/70 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base tracking-tight">Generate</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <div className="grid gap-2">
              <Label htmlFor="quiz-assessment">Quiz assessment</Label>
              <Select
                value={selectedId}
                onValueChange={(value) => void selectAssessment(value ?? "")}
              >
                <SelectTrigger id="quiz-assessment">
                  <SelectValue placeholder="Choose a quiz" />
                </SelectTrigger>
                <SelectContent>
                  {assessments.map((assessment) => (
                    <SelectItem key={assessment.id} value={assessment.id}>
                      {assessment.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selected && (
                <p className="text-xs text-muted-foreground">
                  {selected.courseCode} · {selected.courseName} · {selected.className} · max{" "}
                  {selected.maxMarks} marks · {selected.publishedCount} published
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="quiz-count">Questions (1-20)</Label>
              <Input
                id="quiz-count"
                type="number"
                min={1}
                max={20}
                value={questionCount}
                onChange={(event) => setQuestionCount(event.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="quiz-topic">Topic or lesson description</Label>
            <Input
              id="quiz-topic"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              maxLength={2000}
              placeholder="e.g. Newton's second law and orbital motion"
            />
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={() => void generate()}
              disabled={isGenerating || !selected}
            >
              {isGenerating ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {isGenerating ? "Generating…" : "Generate drafts"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base tracking-tight">
            Questions ({counts.draft} draft · {counts.published} published)
          </CardTitle>
          <Button
            type="button"
            size="sm"
            disabled={draftIds.length === 0 || busyId === "publish"}
            onClick={() => void publish(draftIds)}
          >
            {busyId === "publish" ? <Loader2 className="animate-spin" /> : <Send />}
            Publish all drafts
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {questions.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No questions yet. Generate drafts, then edit and publish them.
            </p>
          )}
          {questions.map((question) => {
            const locked = question.state === "PUBLISHED"
            return (
              <div
                key={question.id}
                className="space-y-3 rounded-lg border border-border/70 bg-muted/10 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge variant={locked ? "default" : "outline"}>{question.state}</Badge>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {question.subtopic ?? "untagged"} · difficulty {question.difficulty ?? "?"}
                    </span>
                    {locked ? (
                      <span className="text-xs text-muted-foreground">
                        Published — locked from edits
                      </span>
                    ) : (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busyId === question.id}
                          onClick={() => void saveDraft(question)}
                        >
                          {busyId === question.id ? <Loader2 className="animate-spin" /> : <Save />}
                          Save
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          disabled={busyId === "publish"}
                          onClick={() => void publish([question.id])}
                        >
                          <Send />
                          Publish
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
                  <div className="grid gap-2">
                    <Label htmlFor={`prompt-${question.id}`}>Prompt</Label>
                    <Input
                      id={`prompt-${question.id}`}
                      value={question.prompt}
                      disabled={locked}
                      onChange={(event) =>
                        updateQuestion(question.id, { prompt: event.target.value })
                      }
                      maxLength={2000}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor={`subtopic-${question.id}`}>Subtopic</Label>
                    <Input
                      id={`subtopic-${question.id}`}
                      value={question.subtopic ?? ""}
                      disabled={locked}
                      onChange={(event) =>
                        updateQuestion(question.id, { subtopic: event.target.value })
                      }
                      maxLength={200}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor={`difficulty-${question.id}`}>Difficulty (1-5)</Label>
                    <Input
                      id={`difficulty-${question.id}`}
                      type="number"
                      min={1}
                      max={5}
                      value={question.difficulty ?? ""}
                      disabled={locked}
                      onChange={(event) =>
                        updateQuestion(question.id, { difficulty: Number(event.target.value) })
                      }
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  {question.options.map((option) => (
                    <div key={option.id} className="grid gap-2 sm:grid-cols-[auto_1fr_1fr]">
                      <label className="flex items-center gap-1 text-xs text-muted-foreground">
                        <input
                          type="radio"
                          name={`correct-${question.id}`}
                          checked={option.isCorrect}
                          disabled={locked}
                          onChange={() => markCorrect(question.id, option.id)}
                        />
                        correct
                      </label>
                      <Input
                        aria-label="Option text"
                        value={option.text}
                        disabled={locked}
                        onChange={(event) =>
                          updateOption(question.id, option.id, { text: event.target.value })
                        }
                        maxLength={1000}
                      />
                      <Input
                        aria-label="Option rationale"
                        value={option.rationale ?? ""}
                        disabled={locked}
                        onChange={(event) =>
                          updateOption(question.id, option.id, { rationale: event.target.value })
                        }
                        maxLength={1000}
                        placeholder="Misconception this distractor targets"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}

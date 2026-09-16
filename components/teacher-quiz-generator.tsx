"use client"

import { useState } from "react"
import { CheckCircle2, Loader2, Plus, Save, Send, Sparkles, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { QuizSubtopicsPanel } from "@/components/quiz-subtopics-panel"
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
import type {
  GeneratedQuestionResponse,
  GenerationAssessmentSummary,
} from "@/lib/contracts/quiz-generation"
import type { SubtopicBreakdownValue } from "@/lib/contracts/analytics"

/**
 * Teacher quiz-generation workspace.
 *
 * The server is the source of truth: the assessment list and every generated
 * question arrive as Server Component props, and each mutation is re-validated
 * server-side (ownership, draft state, exactly one correct option). The answer
 * key is shown here because this is the authoring surface for the owning
 * teacher; it is never part of any student-facing payload.
 */

type OptionDraft = {
  id?: string
  text: string
  isCorrect: boolean
  rationale: string
}

type QuestionDraft = {
  prompt: string
  subtopic: string
  difficulty: string
  explanation: string
  options: OptionDraft[]
}

function toDraft(question: GeneratedQuestionResponse): QuestionDraft {
  return {
    prompt: question.prompt,
    subtopic: question.subtopic ?? "",
    difficulty: question.difficulty === null ? "" : String(question.difficulty),
    explanation: question.explanation ?? "",
    options: question.options.map((option) => ({
      id: option.id,
      text: option.text,
      isCorrect: option.id === question.correctOptionId,
      rationale: option.rationale ?? "",
    })),
  }
}

function replaceQuestion(
  questions: GeneratedQuestionResponse[],
  next: GeneratedQuestionResponse,
): GeneratedQuestionResponse[] {
  return questions.map((question) => (question.id === next.id ? next : question))
}

function QuestionEditor({
  question,
  onSaved,
}: {
  question: GeneratedQuestionResponse
  onSaved: (next: GeneratedQuestionResponse) => void
}) {
  const [draft, setDraft] = useState<QuestionDraft>(() => toDraft(question))
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

  const isDraft = question.status === "draft"

  function updateOption(index: number, patch: Partial<OptionDraft>) {
    setDraft((prev) => ({
      ...prev,
      options: prev.options.map((option, position) =>
        position === index ? { ...option, ...patch } : option,
      ),
    }))
  }

  function markCorrect(index: number) {
    setDraft((prev) => ({
      ...prev,
      options: prev.options.map((option, position) => ({
        ...option,
        isCorrect: position === index,
      })),
    }))
  }

  async function save() {
    setIsBusy(true)
    setStatus(null)
    setError(null)
    try {
      const response = await fetch(`/api/teacher/quiz-generation/${question.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: draft.prompt,
          subtopic: draft.subtopic.trim() || null,
          difficulty: draft.difficulty.trim() === "" ? null : Number(draft.difficulty),
          explanation: draft.explanation.trim() || null,
          options: draft.options.map((option) => ({
            ...(option.id ? { id: option.id } : {}),
            text: option.text,
            isCorrect: option.isCorrect,
            ...(option.rationale.trim() ? { rationale: option.rationale.trim() } : {}),
          })),
        }),
      })
      const data = (await response.json()) as {
        message?: string
        question?: GeneratedQuestionResponse
      }
      if (!response.ok || !data.question) {
        setError(data.message ?? "Unable to save the draft.")
        return
      }
      onSaved(data.question)
      setStatus("Draft saved.")
    } catch {
      setError("Unable to save the draft.")
    } finally {
      setIsBusy(false)
    }
  }

  async function publish() {
    setIsBusy(true)
    setStatus(null)
    setError(null)
    try {
      const response = await fetch("/api/teacher/quiz-generation/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assessmentId: question.assessmentId, questionIds: [question.id] }),
      })
      const data = (await response.json()) as {
        message?: string
        published?: GeneratedQuestionResponse[]
      }
      const published = data.published?.[0]
      if (!response.ok || !published) {
        setError(data.message ?? "Unable to publish the question.")
        return
      }
      onSaved(published)
      setStatus("Published. Students can now receive this question.")
    } catch {
      setError("Unable to publish the question.")
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border/70 bg-muted/10 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={isDraft ? "outline" : "default"}>{isDraft ? "Draft" : "Published"}</Badge>
        {question.subtopic && <Badge variant="secondary">{question.subtopic}</Badge>}
        {question.difficulty !== null && (
          <Badge variant="outline">difficulty {question.difficulty.toFixed(2)}</Badge>
        )}
        {question.model && <span className="text-xs text-muted-foreground">{question.model}</span>}
        {question.sourceChunkIds.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {question.sourceChunkIds.length} source chunk
            {question.sourceChunkIds.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor={`prompt-${question.id}`}>Prompt</Label>
        <textarea
          id={`prompt-${question.id}`}
          className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
          value={draft.prompt}
          disabled={!isDraft}
          onChange={(event) => setDraft((prev) => ({ ...prev, prompt: event.target.value }))}
        />
      </div>

      <div className="space-y-2" role="radiogroup" aria-labelledby={`options-label-${question.id}`}>
        <div className="flex items-center justify-between">
          <Label id={`options-label-${question.id}`}>
            Options — select the single correct answer
          </Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!isDraft || draft.options.length >= 5}
            onClick={() =>
              setDraft((prev) => ({
                ...prev,
                options: [...prev.options, { text: "", isCorrect: false, rationale: "" }],
              }))
            }
          >
            <Plus /> Add distractor
          </Button>
        </div>
        {draft.options.map((option, index) => (
          <div key={option.id ?? `new-${index}`} className="space-y-2 rounded-md border p-2">
            <div className="flex items-center gap-2">
              <input
                type="radio"
                name={`correct-${question.id}`}
                checked={option.isCorrect}
                disabled={!isDraft}
                onChange={() => markCorrect(index)}
                aria-label={`Mark option ${index + 1} correct`}
              />
              <Input
                value={option.text}
                disabled={!isDraft}
                aria-label={`Option ${index + 1} text`}
                placeholder={`Option ${index + 1}`}
                onChange={(event) => updateOption(index, { text: event.target.value })}
              />
              <Button
                type="button"
                variant="destructive"
                size="icon-sm"
                disabled={!isDraft || draft.options.length <= 4}
                onClick={() =>
                  setDraft((prev) => ({
                    ...prev,
                    options: prev.options.filter((_, position) => position !== index),
                  }))
                }
                aria-label="Remove option"
              >
                <Trash2 />
              </Button>
            </div>
            <Input
              value={option.rationale}
              disabled={!isDraft}
              aria-label={`Option ${index + 1} distractor rationale`}
              placeholder="Why would a student choose this? (misconception captured)"
              onChange={(event) => updateOption(index, { rationale: event.target.value })}
            />
          </div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-2">
          <Label htmlFor={`subtopic-${question.id}`}>Subtopic</Label>
          <Input
            id={`subtopic-${question.id}`}
            value={draft.subtopic}
            disabled={!isDraft}
            onChange={(event) => setDraft((prev) => ({ ...prev, subtopic: event.target.value }))}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`difficulty-${question.id}`}>Difficulty (0-1)</Label>
          <Input
            id={`difficulty-${question.id}`}
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={draft.difficulty}
            disabled={!isDraft}
            onChange={(event) => setDraft((prev) => ({ ...prev, difficulty: event.target.value }))}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`explanation-${question.id}`}>Explanation</Label>
          <Input
            id={`explanation-${question.id}`}
            value={draft.explanation}
            disabled={!isDraft}
            onChange={(event) => setDraft((prev) => ({ ...prev, explanation: event.target.value }))}
          />
        </div>
      </div>

      {status && (
        <p
          role="status"
          className="text-sm text-emerald-700 [@media(prefers-color-scheme:dark)]:text-emerald-400"
        >
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {isDraft && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={save} disabled={isBusy}>
            {isBusy ? <Loader2 className="animate-spin" /> : <Save />} Save draft
          </Button>
          <Button type="button" onClick={publish} disabled={isBusy}>
            <Send /> Publish question
          </Button>
        </div>
      )}
    </div>
  )
}

export function TeacherQuizGenerator({
  initialAssessments,
  initialQuestions,
  subtopicBreakdowns,
}: {
  initialAssessments: GenerationAssessmentSummary[]
  initialQuestions: GeneratedQuestionResponse[]
  /** Keyed by assessment id. Server-fetched, since the response counts need the database. */
  subtopicBreakdowns: Record<string, SubtopicBreakdownValue>
}) {
  const first = initialAssessments[0] ?? null
  const [questions, setQuestions] = useState(initialQuestions)
  const [selectedId, setSelectedId] = useState(first?.id ?? "")
  const [topic, setTopic] = useState("")
  const [questionCount, setQuestionCount] = useState("5")
  const [difficulty, setDifficulty] = useState("mixed")
  const [subtopics, setSubtopics] = useState("")
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)

  const selected = initialAssessments.find((assessment) => assessment.id === selectedId) ?? null

  const selectedQuestions = questions
    .filter((question) => question.assessmentId === selectedId)
    .sort((a, b) => a.order - b.order)
  const drafts = selectedQuestions.filter((question) => question.status === "draft")
  const published = selectedQuestions.filter((question) => question.status === "published")

  async function generate() {
    if (!selected || topic.trim().length === 0) {
      setError("Choose an assessment and describe a topic first.")
      return
    }
    setIsGenerating(true)
    setMessage(null)
    setError(null)
    try {
      const response = await fetch("/api/teacher/quiz-generation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assessmentId: selected.id,
          topic: topic.trim(),
          questionCount: Number(questionCount),
          difficulty,
          subtopics: subtopics
            .split(",")
            .map((value) => value.trim())
            .filter((value) => value.length > 0),
        }),
      })
      const data = (await response.json()) as {
        message?: string
        questions?: GeneratedQuestionResponse[]
      }
      if (!response.ok || !data.questions) {
        setError(data.message ?? "Unable to generate questions.")
        return
      }
      const created = data.questions
      setQuestions((prev) => [...prev, ...created])
      setMessage(
        `${created.length} draft question${created.length === 1 ? "" : "s"} generated. Review, edit, then publish.`,
      )
    } catch {
      setError("Unable to generate questions.")
    } finally {
      setIsGenerating(false)
    }
  }

  async function publishAllDrafts() {
    if (!selected || drafts.length === 0) return
    setMessage(null)
    setError(null)
    try {
      const response = await fetch("/api/teacher/quiz-generation/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assessmentId: selected.id,
          questionIds: drafts.map((question) => question.id),
        }),
      })
      const data = (await response.json()) as {
        message?: string
        published?: GeneratedQuestionResponse[]
      }
      if (!response.ok || !data.published) {
        setError(data.message ?? "Unable to publish the drafts.")
        return
      }
      let next = questions
      for (const question of data.published) {
        next = replaceQuestion(next, question)
      }
      setQuestions(next)
      setMessage(`${data.published.length} question(s) published.`)
    } catch {
      setError("Unable to publish the drafts.")
    }
  }

  if (initialAssessments.length === 0) {
    return (
      <Card className="border-border/70 shadow-sm">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          You have no assessments to generate questions for yet.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card className="border-primary/20 bg-gradient-to-br from-primary/10 via-background to-background shadow-sm">
        <CardContent className="pt-6">
          <Badge variant="outline" className="mb-2 w-fit border-primary/30 text-primary">
            <Sparkles /> Retrieval-grounded generation
          </Badge>
          <p className="text-sm text-muted-foreground">
            Questions are drafted from your indexed course material, tagged by subtopic and
            difficulty, and kept unpublished until you explicitly publish them.
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
          <CardTitle className="text-base tracking-tight">Generate drafts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:max-w-xl">
            <Label htmlFor="quiz-assessment">Assessment</Label>
            <Select value={selectedId} onValueChange={(value) => setSelectedId(value ?? "")}>
              <SelectTrigger id="quiz-assessment">
                <SelectValue placeholder="Choose an assessment" />
              </SelectTrigger>
              <SelectContent>
                {initialAssessments.map((assessment) => (
                  <SelectItem key={assessment.id} value={assessment.id}>
                    {assessment.title}
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

          <div className="grid gap-2">
            <Label htmlFor="quiz-topic">Topic or lesson description</Label>
            <textarea
              id="quiz-topic"
              className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm"
              value={topic}
              placeholder="e.g. Photosynthesis — light-dependent reactions and the Calvin cycle"
              onChange={(event) => setTopic(event.target.value)}
              maxLength={4000}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
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
            <div className="grid gap-2">
              <Label htmlFor="quiz-difficulty">Difficulty target</Label>
              <Select value={difficulty} onValueChange={(value) => setDifficulty(value ?? "mixed")}>
                <SelectTrigger id="quiz-difficulty">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="easy">Easy</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="hard">Hard</SelectItem>
                  <SelectItem value="mixed">Mixed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="quiz-subtopics">Subtopics (comma separated)</Label>
              <Input
                id="quiz-subtopics"
                value={subtopics}
                placeholder="light reactions, Calvin cycle"
                onChange={(event) => setSubtopics(event.target.value)}
              />
            </div>
          </div>

          <Button type="button" onClick={generate} disabled={isGenerating || !selected}>
            {isGenerating ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {isGenerating ? "Generating…" : "Generate draft questions"}
          </Button>
        </CardContent>
      </Card>

      {/* The topics this assessment covers. Rendered from the server-fetched breakdown, and
          deliberately a token list rather than a mastery chart — see the panel's docblock. */}
      <QuizSubtopicsPanel breakdown={subtopicBreakdowns[selectedId] ?? null} />

      {selected && (
        <Card className="border-border/70 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="text-base tracking-tight">
              Drafts ({drafts.length}) · Published ({published.length})
            </CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={publishAllDrafts}
              disabled={drafts.length === 0}
            >
              <CheckCircle2 /> Publish all drafts
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {selectedQuestions.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No generated questions yet for this assessment.
              </p>
            )}
            {selectedQuestions.map((question) => (
              <QuestionEditor
                key={`${question.id}-${question.updatedAt}`}
                question={question}
                onSaved={(next) => setQuestions((prev) => replaceQuestion(prev, next))}
              />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

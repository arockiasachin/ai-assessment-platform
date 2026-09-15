"use client"

import { useState } from "react"
import { Flag } from "lucide-react"

import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import type { QuizQuestion } from "@/lib/mock"

/**
 * The pre-submission shape of a question.
 *
 * Note what is absent: no `isCorrect`, no option `rationale`, no `explanation`.
 * `isCorrect` and `rationale` are fields of `QuestionOption`, so they can only
 * be dropped by mapping the fixture explicitly — which is exactly what the page
 * does before handing a question to this component. A client component rendered
 * on the student's screen before submission therefore *cannot* reveal an answer
 * key, because it was never given one.
 */
export type InProgressOption = {
  id: string
  label: string
  text: string
}

export type InProgressQuestionProps = {
  question: {
    id: string
    order: number
    prompt: string
    type: QuizQuestion["type"]
    points: number
    topic: string
    options: InProgressOption[]
  }
  /** The student's own current selections — never a correctness hint. */
  selectedOptionIds: string[]
  flagged: boolean
}

/**
 * One question of a sitting in progress.
 *
 * Genuinely interactive (radio/checkbox selection is local state) so a reviewer
 * can click through it, and deliberately says nothing about correctness: the
 * selections simply render as chosen, with no success/danger tone anywhere.
 */
export function InProgressQuestion({
  question,
  selectedOptionIds,
  flagged,
}: InProgressQuestionProps) {
  const [selected, setSelected] = useState<string[]>(selectedOptionIds)
  const multiple = question.type === "MULTIPLE_SELECT"

  function toggle(optionId: string) {
    setSelected((current) => {
      if (!multiple) return current.includes(optionId) ? [] : [optionId]
      return current.includes(optionId)
        ? current.filter((id) => id !== optionId)
        : [...current, optionId]
    })
  }

  return (
    <fieldset className="space-y-3">
      <legend className="space-y-1">
        <span className="block text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          Question {question.order} · {question.topic} · {question.points} points
        </span>
        <span className="block text-base font-medium text-pretty">{question.prompt}</span>
      </legend>

      {flagged && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Flag className="size-3.5" aria-hidden="true" />
          You flagged this question to come back to.
        </p>
      )}

      <ul className="space-y-2">
        {question.options.map((option) => {
          const inputId = `${question.id}-${option.id}`
          const isSelected = selected.includes(option.id)
          return (
            <li key={option.id}>
              <div
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3",
                  isSelected ? "border-primary bg-primary/5 dark:bg-primary/10" : "border-border",
                )}
              >
                <input
                  id={inputId}
                  name={question.id}
                  type={multiple ? "checkbox" : "radio"}
                  checked={isSelected}
                  onChange={() => toggle(option.id)}
                  className="mt-0.5 size-4 shrink-0 accent-primary focus-visible:ring-3 focus-visible:ring-ring/50"
                />
                <Label htmlFor={inputId} className="flex-1 cursor-pointer font-normal">
                  <span className="font-mono text-muted-foreground">{option.label}.</span>
                  <span className="text-pretty">{option.text}</span>
                </Label>
              </div>
            </li>
          )
        })}
      </ul>

      <p className="text-xs text-muted-foreground">
        {multiple ? "Select every option that applies." : "Select one option."} Nothing is marked
        correct or incorrect until you submit the sitting.
      </p>
    </fieldset>
  )
}

import * as React from "react"

import { cn } from "@/lib/utils"
import { parseTaskBrief, type BriefParagraph } from "@/lib/task-brief"

export type QuestionPromptProps = {
  /** Raw prompt text (`Question.prompt`, `CodeTask.instructions`, …), or `null`. */
  text: string | null | undefined
  /**
   * 1-based position, rendered as a muted "3." prefix when the prompt is one of
   * a numbered set (a retake list, an evidence list).
   */
  index?: number
  /**
   * Render the prompt as a heading at this level instead of a paragraph. Use it
   * where the surrounding card is already a heading (an `h2` `SectionCard`), so
   * the question is a real `h3` rather than an unmarked `<p>` — that is the
   * heading-outline half of this component.
   */
  as?: "p" | "h3" | "h4"
  /** Optional small label above the prompt, e.g. "Question". */
  label?: string
  /** Optional meta line under the prompt (marks, kind, attempt). */
  meta?: React.ReactNode
  /** Copy shown when there is no prompt text at all. */
  emptyText?: string
  className?: string
}

/** Inline `` `code` `` spans → `<code>`, matching the parser's single markup rule. */
function renderSegments(paragraph: BriefParagraph): React.ReactNode {
  return paragraph.segments.map((segment, index) =>
    segment.kind === "code" ? (
      <code
        key={`${paragraph.id}-${index}`}
        className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[0.9em] text-foreground"
      >
        {segment.value}
      </code>
    ) : (
      <span key={`${paragraph.id}-${index}`}>{segment.value}</span>
    ),
  )
}

/**
 * The one presentation for a question prompt or task brief.
 *
 * Prompts are plain text with backtick code spans (there is no markdown in the
 * repo and no renderer to add), so this **reuses the existing `parseTaskBrief`
 * parser** rather than writing a second one — the whole point is that a quiz
 * question, a retake question and a code brief read the same. The type scale is
 * the one the code and writing surfaces were deliberately moved to:
 * `text-base leading-7` with a `max-w-[65ch]` measure, so lines stop before the
 * pane's full width.
 *
 * Previously the quiz prompt was rendered twice — once in
 * `student-quiz-attempts.tsx` and again, independently, in
 * `student-adaptive-retake.tsx` — at `text-sm` with no measure. Both now render
 * this component.
 *
 * No hooks and no client-only APIs: safe in a Server Component and a client
 * island alike.
 */
export function QuestionPrompt({
  text,
  index,
  as,
  label,
  meta,
  emptyText = "No prompt was recorded.",
  className,
}: QuestionPromptProps) {
  const brief = parseTaskBrief(text)

  if (brief.paragraphs.length === 0) {
    return <p className={cn("text-base leading-7 text-muted-foreground", className)}>{emptyText}</p>
  }

  // A heading, when asked for, carries the first paragraph; the rest are body.
  const Heading = as ?? "p"
  const headingParagraph = as ? brief.paragraphs[0] : null
  const bodyParagraphs = as ? brief.paragraphs.slice(1) : brief.paragraphs

  const prefix =
    index === undefined ? null : (
      <span className="mr-1 text-muted-foreground tabular-nums" aria-hidden="true">
        {index}.
      </span>
    )

  return (
    <div className={cn("max-w-[65ch] space-y-5", className)}>
      {label && (
        <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          {label}
        </p>
      )}

      {headingParagraph && (
        <div className="space-y-1">
          <Heading className="text-base leading-7 font-medium text-foreground">
            {prefix}
            {renderSegments(headingParagraph)}
          </Heading>
          {meta && <div className="text-xs text-muted-foreground">{meta}</div>}
        </div>
      )}

      {bodyParagraphs.map((paragraph) => (
        <p key={paragraph.id} className="text-base leading-7 whitespace-pre-line text-foreground">
          {renderSegments(paragraph)}
        </p>
      ))}
    </div>
  )
}

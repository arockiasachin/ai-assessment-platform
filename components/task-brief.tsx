import { cn } from "@/lib/utils"
import { parseTaskBrief } from "@/lib/task-brief"

export type TaskBriefProps = {
  /** Raw instruction text (`CodeTask.instructions`), or `null` when none exists. */
  text: string | null | undefined
  className?: string
}

/**
 * Renders task instructions as readable prose.
 *
 * Instructions are plain text with backtick code spans (there is no markdown in
 * the repo and no renderer to add), so this pairs the pure `parseTaskBrief`
 * parser with a type scale that can actually be read:
 *
 * - `text-base leading-7`, not the old `text-sm` muted description;
 * - each blank-line-separated paragraph is its own block with `space-y-5`;
 * - the measure is capped near `65ch` so lines stop before the pane's full
 *   width, which is what made the old run-on line hard to follow;
 * - `` `code` `` renders as `<code>` so identifiers stand out from the prose.
 *
 * No hooks and no client-only APIs: it is safe in a Server Component and in a
 * client island alike.
 */
export function TaskBrief({ text, className }: TaskBriefProps) {
  const brief = parseTaskBrief(text)

  if (brief.paragraphs.length === 0) {
    return (
      <p className={cn("text-base leading-7 text-muted-foreground", className)}>
        No instructions were recorded for this task.
      </p>
    )
  }

  return (
    <div className={cn("max-w-[65ch] space-y-5", className)}>
      {brief.paragraphs.map((paragraph) => (
        <p key={paragraph.id} className="text-base leading-7 whitespace-pre-line text-foreground">
          {paragraph.segments.map((segment, index) =>
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
          )}
        </p>
      ))}
    </div>
  )
}

import { StatusPill } from "@/components/ui/status-pill"
import type { AuthoringLifecycleView } from "@/lib/authoring-lifecycle-view"
import { cn } from "@/lib/utils"

/**
 * The one lifecycle badge every authoring surface renders (TL-1).
 *
 * A teacher should not have to learn four vocabularies, so the pill, its tone and the line
 * under it are the same shape on `/teacher/assignments`, `/teacher/quiz-generation`,
 * `/teacher/code-tasks` and `/teacher/rubrics`. The **words** stay each engine's own — see
 * `lib/authoring-lifecycle-view.ts` for why "Released" and "Frozen" are not "Published".
 *
 * Presentational only, so it works inside both Server and Client Components.
 */
export function AuthoringLifecycleBadge({
  view,
  className,
}: {
  view: AuthoringLifecycleView
  className?: string
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <StatusPill status={view.status} label={view.label} dot />
      <p className="text-xs text-muted-foreground">{view.detail}</p>
    </div>
  )
}

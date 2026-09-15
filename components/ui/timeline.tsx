import { StatusDot, type StatusKey } from "@/components/ui/status-pill"
import { cn } from "@/lib/utils"

export type TimelineItem = {
  id: string
  title: React.ReactNode
  description?: React.ReactNode
  /** Pre-formatted timestamp or actor line. */
  meta?: string
  tone?: StatusKey
}

/**
 * Vertical activity/milestone list — audit entries, grading history, project
 * milestones.
 *
 * An ordered list (`<ol>`) because the sequence is the point, with `last:` rules
 * so the connector line stops at the final item.
 */
export function Timeline({ items, className }: { items: TimelineItem[]; className?: string }) {
  return (
    <ol className={cn("relative", className)}>
      {items.map((item, index) => (
        <li key={item.id} className="relative flex gap-3">
          <div className="flex flex-col items-center">
            <StatusDot status={item.tone ?? "active"} className="mt-1.5 size-2" />
            {index < items.length - 1 && (
              <span className="w-px flex-1 bg-border" aria-hidden="true" />
            )}
          </div>
          <div className={cn("min-w-0 flex-1", index < items.length - 1 && "pb-5")}>
            <div className="text-sm font-medium">{item.title}</div>
            {item.description && (
              <div className="mt-0.5 text-sm text-muted-foreground text-pretty">
                {item.description}
              </div>
            )}
            {item.meta && <div className="mt-1 text-xs text-muted-foreground">{item.meta}</div>}
          </div>
        </li>
      ))}
    </ol>
  )
}

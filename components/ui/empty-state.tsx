import { Inbox, type LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

export type EmptyStateProps = {
  title: string
  description?: string
  icon?: LucideIcon
  /** Primary action, e.g. `<Button>Generate questions</Button>`. */
  action?: React.ReactNode
  /** Secondary line, e.g. a link to documentation. */
  hint?: React.ReactNode
  size?: "default" | "sm"
  className?: string
}

/**
 * Standard "nothing here" panel. Use it instead of leaving blank space so every
 * empty collection explains what it is and what to do next.
 *
 * Rendered as a `<div>` (not a card) so it can live inside a `SectionCard`,
 * a `DataTable` body, or directly on the page without adding another frame.
 */
export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
  hint,
  size = "default",
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-6 text-center",
        size === "sm" ? "py-6" : "py-10",
        className,
      )}
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <p className="text-sm font-medium">{title}</p>
      {description && (
        <p className="max-w-md text-sm text-muted-foreground text-pretty">{description}</p>
      )}
      {action && <div className="mt-1">{action}</div>}
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}

import type { ElementType } from "react"
import type { LucideIcon } from "lucide-react"

import { TONE_PANEL, type Tone } from "@/components/ui/tone"
import { cn } from "@/lib/utils"

export type CalloutProps = {
  /** Semantic intent. Defaults to `info`. */
  tone?: Tone
  /** Optional short heading, e.g. "Flags raised on this submission". */
  title?: React.ReactNode
  /**
   * Optional leading icon. It inherits the tone's text colour, so it can never
   * drift out of contrast with the panel.
   */
  icon?: LucideIcon
  /** Optional trailing control (a link, a button) aligned with the title row. */
  action?: React.ReactNode
  /**
   * Heading level used for `title`. Defaults to `<p>` so a callout sitting
   * directly under the page `<h1>` cannot create a heading-order skip; pass
   * `"h3"` when the callout is inside a `SectionCard` (which supplies the `h2`).
   */
  titleAs?: "p" | "h2" | "h3" | "h4"
  /**
   * ARIA role. Defaults to `"note"` — correct for static guidance. Pass
   * `"status"` or `"alert"` for a result the user just triggered, so assistive
   * tech announces it.
   */
  role?: "note" | "status" | "alert"
  /** Body copy. */
  children?: React.ReactNode
  /**
   * Extra classes for the body wrapper. Use `"text-muted-foreground"` for long
   * explanatory prose where the tone colour should stay on the title only.
   */
  bodyClassName?: string
  className?: string
}

/**
 * A toned notice panel — the "read this before you trust the numbers" box.
 *
 * Before this existed, every page re-implemented it as
 * `rounded-lg border border-warning/40 bg-warning/10 p-3 dark:bg-warning/15`,
 * and each one had to remember the matching dark-mode text colour by hand. The
 * tint and the foreground now come from `TONE_PANEL` in one place, so the
 * measured pair travels with the background.
 *
 * `role="note"` marks it as a parenthetical for assistive tech without making it
 * a landmark or announcing it like a live region (it is static content, so
 * `role="status"` would be wrong).
 *
 * Server Component — no state, no effects.
 */
export function Callout({
  tone = "info",
  title,
  icon: Icon,
  action,
  titleAs = "p",
  role = "note",
  children,
  bodyClassName,
  className,
}: CalloutProps) {
  const Title: ElementType = titleAs
  const hasTitleRow = Boolean(title || Icon || action)

  return (
    <div role={role} className={cn("rounded-lg border p-3", TONE_PANEL[tone], className)}>
      {hasTitleRow && (
        <div className={cn("flex items-start gap-2", action && "justify-between")}>
          <div className="flex min-w-0 items-start gap-2">
            {Icon && <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
            {title && <Title className="text-sm font-medium text-balance">{title}</Title>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children && (
        <div className={cn("text-sm text-pretty", hasTitleRow && "mt-1", bodyClassName)}>
          {children}
        </div>
      )}
    </div>
  )
}

import type { ElementType } from "react"

import { Card, CardAction, CardContent, CardDescription, CardFooter } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export type SectionCardProps = {
  /** Rendered as a heading so the section is announced as one. Defaults to `<h2>`. */
  title?: string
  /**
   * Heading level used for `title`. Defaults to `<h2>`.
   *
   * Pass `"h3"` when the card sits inside a section that already supplies an `h2`
   * — a per-course card under a course heading — so the outline nests instead of
   * reading as a flat list of `h2`s. Mirrors `Callout`'s `titleAs`.
   */
  titleAs?: "h2" | "h3" | "h4"
  description?: string
  /** Right-aligned header control (a button, a link, a filter). */
  action?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  className?: string
  contentClassName?: string
}

/**
 * The one card a page body should be built from.
 *
 * This is what replaces the old double-nesting: `PageHeader` sits directly on
 * the background and content lives inside `SectionCard`s, so there is exactly
 * one frame between the page and its data.
 */
export function SectionCard({
  title,
  titleAs = "h2",
  description,
  action,
  children,
  footer,
  className,
  contentClassName,
}: SectionCardProps) {
  const hasHeader = Boolean(title || description || action)
  const Title: ElementType = titleAs

  return (
    <Card className={cn("gap-4", className)}>
      {hasHeader && (
        <div
          data-slot="card-header"
          className={cn(
            "grid items-start gap-1 px-(--card-spacing)",
            action && "grid-cols-[1fr_auto]",
            description && "grid-rows-[auto_auto]",
          )}
        >
          {title && (
            <Title data-slot="card-title" className="text-base leading-snug font-medium">
              {title}
            </Title>
          )}
          {description && <CardDescription>{description}</CardDescription>}
          {action && <CardAction>{action}</CardAction>}
        </div>
      )}

      <CardContent className={cn(contentClassName)}>{children}</CardContent>
      {footer && <CardFooter>{footer}</CardFooter>}
    </Card>
  )
}

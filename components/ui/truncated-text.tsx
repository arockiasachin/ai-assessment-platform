import { cn } from "@/lib/utils"

export type TruncatedTextProps = {
  children: React.ReactNode
  /**
   * Full value for the native tooltip. Defaults to `children` when it is a
   * plain string, so callers do not have to repeat `title={row.name}` by hand.
   */
  title?: string
  /** Maximum width before the ellipsis. */
  width?: "sm" | "md" | "lg"
  className?: string
}

/**
 * Width limits. One definition, because the pages had grown six hard-coded
 * values (`max-w-[15rem]`, `[16rem]`, `[18rem]` …) for the same job.
 */
const WIDTH: Record<NonNullable<TruncatedTextProps["width"]>, string> = {
  sm: "max-w-[12rem]",
  md: "max-w-[16rem]",
  lg: "max-w-[20rem]",
}

/**
 * A single-line value that truncates with an ellipsis instead of widening its
 * container — student and group names are the long-content case
 * (`Alexandria Catherine Montgomery-Worthington`).
 *
 * Rendered as a block so it takes effect inside a table cell, where the shared
 * `Table` primitive sets `whitespace-nowrap` and auto layout would otherwise
 * size the column to the longest name and push the table into horizontal
 * scroll. The `title` keeps the full value reachable on hover; table cells pass
 * the real string rather than the rendered node so screen readers still read the
 * complete name on the cell.
 */
export function TruncatedText({ children, title, width = "md", className }: TruncatedTextProps) {
  const tooltip = title ?? (typeof children === "string" ? children : undefined)

  return (
    <span className={cn("block truncate", WIDTH[width], className)} title={tooltip}>
      {children}
    </span>
  )
}

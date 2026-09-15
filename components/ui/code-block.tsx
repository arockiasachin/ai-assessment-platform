import { cn } from "@/lib/utils"

export type CodeBlockProps = {
  /** The code, usually a fixture string such as `MOCK_CODE_TASK_SKELETON`. */
  children: React.ReactNode
  /**
   * Wrap long lines instead of scrolling horizontally. Use for captured output
   * where the exact column is not the point; leave `false` for code, where a
   * wrapped line would misrepresent the source.
   */
  wrap?: boolean
  /** Cap the height and scroll vertically as well (`sm` = 8rem, `md` = 16rem). */
  maxHeight?: "sm" | "md"
  /** Tighter padding, for a block nested inside a disclosure. */
  dense?: boolean
  className?: string
}

/**
 * A block of code or captured output.
 *
 * `overflow-x-auto` is the point: three of the four blocks in the mockups had it
 * by hand and one had a subtly different rule, and a `<pre>` without it pushes
 * the whole page sideways. The monospace type, tinted surface and radius are
 * fixed here so the two code pages cannot drift apart again.
 */
export function CodeBlock({
  children,
  wrap = false,
  maxHeight,
  dense = false,
  className,
}: CodeBlockProps) {
  return (
    <pre
      data-slot="code-block"
      className={cn(
        "overflow-x-auto rounded-lg bg-muted font-mono text-xs text-foreground",
        dense ? "p-2" : "p-3",
        wrap ? "whitespace-pre-wrap" : "whitespace-pre",
        maxHeight === "sm" && "max-h-32 overflow-y-auto",
        maxHeight === "md" && "max-h-64 overflow-y-auto",
        className,
      )}
    >
      {children}
    </pre>
  )
}

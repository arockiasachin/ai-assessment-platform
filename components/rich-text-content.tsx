import type { ReactNode } from "react"

/**
 * Renders a submission body that is already sanitized HTML.
 *
 * ## The input contract
 *
 * The `html` prop **must** already have passed through `sanitizeSubmissionHtml`
 * (`lib/rich-text.ts`). Both server readers that feed a teacher view apply it —
 * `lib/teacher-submissions.ts` and `lib/rubric-grading/review-queue.ts` — so
 * this component never receives raw student input and deliberately does not
 * re-sanitize (which would drag `sanitize-html` into the client bundle). The
 * sanitize-on-render half of the rule lives in those readers, not here.
 *
 * ## Why plain text and HTML look different
 *
 * Legacy rows predate the editor and hold plain prose, which the reader
 * sanitizes into text with no tags. TipTap emits real HTML. A text node with no
 * tags needs `whitespace-pre-wrap` to keep its line breaks; doing that to real
 * HTML would also render the whitespace *between* tags, adding gaps. So the two
 * cases are styled differently, decided by whether any tag survived.
 */
export function RichTextContent({
  html,
  fallback = "No text submitted.",
  className,
}: {
  html: string | null | undefined
  fallback?: ReactNode
  className?: string
}) {
  const value = html?.trim() ?? ""

  if (!value) {
    return <p className={`text-sm text-muted-foreground ${className ?? ""}`.trim()}>{fallback}</p>
  }

  const hasMarkup = /<[a-z][\s\S]*>/i.test(value)

  return (
    <div
      className={[hasMarkup ? RICH_HTML_CLASSES : "whitespace-pre-wrap text-sm", className]
        .filter(Boolean)
        .join(" ")}
      dangerouslySetInnerHTML={{ __html: value }}
    />
  )
}

/**
 * Styling for sanitized submission HTML. Tailwind has no typography plugin here,
 * so the readable defaults for each tag the sanitizer allows are set explicitly.
 */
const RICH_HTML_CLASSES = [
  "text-sm",
  "[&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
  "[&_h1]:mt-3 [&_h1]:text-lg [&_h1]:font-semibold",
  "[&_h2]:mt-3 [&_h2]:text-base [&_h2]:font-semibold",
  "[&_h3]:mt-2 [&_h3]:text-sm [&_h3]:font-semibold",
  "[&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5",
  "[&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-primary/40 [&_blockquote]:pl-3 [&_blockquote]:italic",
  "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2 [&_pre]:font-mono [&_pre]:text-xs [&_pre]:whitespace-pre-wrap",
  "[&_code]:font-mono [&_code]:text-xs",
  "[&_a]:text-primary [&_a]:underline",
  "[&_hr]:my-2 [&_hr]:border-border",
  "[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse",
  "[&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left",
  "[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1",
].join(" ")

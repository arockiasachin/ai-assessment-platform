/**
 * A pure parser for task instructions.
 *
 * Instructions are stored as **plain text** (`CodeTask.instructions`) and the
 * repo has no markdown renderer — and deliberately does not add one. The only
 * markup authors actually use is a backtick code span around an identifier:
 *
 *     Implement `bfs_order(adjacency, start)` returning the visited order.
 *
 * So this module does exactly two things, and no more:
 *
 *  - splits the text on blank lines into **paragraphs**, so a wall of prose can
 *    be rendered as separate blocks instead of one run-on line;
 *  - splits each paragraph's inline `` `code` `` spans into typed segments, so
 *    identifiers can render as `<code>` rather than blending into the prose.
 *
 * It is pure and dependency-free so the display rule is unit-testable without a
 * DOM (the repo convention: testable display logic lives in `lib/`).
 *
 * A backtick that is never closed is left as literal text — an unbalanced span
 * is a typo in the instruction, not a licence to swallow the rest of the
 * paragraph.
 */

export type BriefSegment = {
  kind: "text" | "code"
  value: string
}

export type BriefParagraph = {
  /** Stable id for React keys; derived from the paragraph's position. */
  id: string
  segments: BriefSegment[]
}

export type TaskBrief = {
  paragraphs: BriefParagraph[]
}

const CODE_SPAN = /`([^`\n]+)`/g

/** Split one line/paragraph into text and `` `code` `` segments. */
export function parseBriefSegments(value: string): BriefSegment[] {
  const segments: BriefSegment[] = []
  let cursor = 0
  for (const match of value.matchAll(CODE_SPAN)) {
    const start = match.index ?? 0
    if (start > cursor) {
      segments.push({ kind: "text", value: value.slice(cursor, start) })
    }
    segments.push({ kind: "code", value: match[1] })
    cursor = start + match[0].length
  }
  if (cursor < value.length) {
    segments.push({ kind: "text", value: value.slice(cursor) })
  }
  return segments.filter((segment) => segment.value.length > 0)
}

/**
 * Parse instruction text into paragraphs of typed segments.
 *
 * `null`/`undefined` and whitespace-only input yield no paragraphs, so callers
 * can render their own empty state rather than an empty block.
 */
export function parseTaskBrief(input: string | null | undefined): TaskBrief {
  if (typeof input !== "string") return { paragraphs: [] }

  const text = input.replace(/\r\n?/g, "\n").trim()
  if (text.length === 0) return { paragraphs: [] }

  const paragraphs = text
    .split(/\n[ \t]*\n+/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .map((paragraph, index) => ({
      id: `brief-${index}`,
      segments: parseBriefSegments(paragraph),
    }))

  return { paragraphs }
}

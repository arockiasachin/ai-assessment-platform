import { estimateTokens } from "@/lib/llm"

export type TextChunk = {
  /** Zero-based position within the source document. */
  index: number
  content: string
  /** Character offset of the trimmed content in the normalized source. */
  start: number
  /** Exclusive character offset of the trimmed content in the normalized source. */
  end: number
  tokenCount: number
}

export type ChunkTextOptions = {
  /** Soft ceiling for a chunk before it is split. */
  maxChars?: number
  /** Characters of trailing context repeated at the start of the next chunk. */
  overlapChars?: number
  /** Merge a trailing chunk smaller than this into its predecessor. */
  minChars?: number
}

export const DEFAULT_MAX_CHARS = 1200
export const DEFAULT_OVERLAP_CHARS = 150

// Preference order for a natural split point, best first.
const BREAK_PATTERNS = ["\n\n", "\n", ". ", "! ", "? ", "; ", ", ", " "] as const

function findBreakIndex(segment: string): number {
  for (const pattern of BREAK_PATTERNS) {
    const index = segment.lastIndexOf(pattern)
    if (index > 0) {
      return index + pattern.length
    }
  }
  return -1
}

/**
 * Deterministic, dependency-free text chunker. It normalizes line endings,
 * prefers paragraph/sentence/word boundaries, and repeats a small overlap so
 * retrieval does not lose context that straddles a boundary.
 */
export function chunkText(input: string, options: ChunkTextOptions = {}): TextChunk[] {
  const maxChars = Math.max(1, options.maxChars ?? DEFAULT_MAX_CHARS)
  const overlapChars = Math.min(
    Math.max(0, options.overlapChars ?? DEFAULT_OVERLAP_CHARS),
    maxChars - 1,
  )
  const minChars = Math.max(0, options.minChars ?? 0)

  const text = input.replace(/\r\n?/g, "\n").trim()
  if (!text) return []

  if (text.length <= maxChars) {
    return [
      {
        index: 0,
        content: text,
        start: 0,
        end: text.length,
        tokenCount: estimateTokens(text),
      },
    ]
  }

  const chunks: TextChunk[] = []
  let cursor = 0

  while (cursor < text.length) {
    const hardEnd = Math.min(cursor + maxChars, text.length)
    let end = hardEnd

    if (hardEnd < text.length) {
      const boundary = findBreakIndex(text.slice(cursor, hardEnd))
      if (boundary > 0) end = cursor + boundary
    }

    const raw = text.slice(cursor, end)
    const leading = raw.length - raw.trimStart().length
    const trailing = raw.length - raw.trimEnd().length
    const content = raw.trim()

    if (content.length > 0) {
      chunks.push({
        index: chunks.length,
        content,
        start: cursor + leading,
        end: end - trailing,
        tokenCount: estimateTokens(content),
      })
    }

    if (end >= text.length) break

    const nextCursor = end - overlapChars
    cursor = nextCursor > cursor ? nextCursor : end
  }

  if (minChars > 0 && chunks.length > 1) {
    const last = chunks[chunks.length - 1]
    if (last.content.length < minChars) {
      const previous = chunks[chunks.length - 2]
      previous.content = `${previous.content}\n${last.content}`.trim()
      previous.end = last.end
      previous.tokenCount = estimateTokens(previous.content)
      chunks.pop()
    }
  }

  return chunks
}

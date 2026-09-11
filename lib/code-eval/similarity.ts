import type { CodeLanguage } from "@/lib/contracts/code-eval"

/**
 * Cohort code-similarity detection.
 *
 * This is a normalized-token shingling / Jaccard comparison, **not** a full
 * MOSS implementation (no winnowing fingerprints, no AST/PDG analysis, no
 * multi-language semantic normalization). It removes comments, collapses string
 * and numeric literals, tokenizes, builds overlapping k-gram shingles, and
 * scores two submissions by the Jaccard index of their shingle sets.
 *
 * It **flags** suspiciously similar pairs for human review. It never decides a
 * grade, never clears a pair on its own, and is never exposed to students.
 */

/** Overlap length of the token k-grams. */
export const SIMILARITY_SHINGLE_SIZE = 5

/** Jaccard score at or above which a pair is flagged for review. */
export const SIMILARITY_FLAG_THRESHOLD = 0.8

/** Submissions shorter than this produce too few shingles to be meaningful. */
export const SIMILARITY_MIN_TOKENS = 20

export type SimilarityEvidence = {
  method: string
  shingleSize: number
  sharedShingles: number
  totalShinglesA: number
  totalShinglesB: number
  tokenCountA: number
  tokenCountB: number
  threshold: number
}

export type SimilarityComparison = {
  similarity: number
  flagged: boolean
  evidence: SimilarityEvidence
}

const TWO_CHAR_OPERATORS = new Set([
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "**",
  "->",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  ":=",
  "::",
  "=>",
  "//",
  "<<",
  ">>",
])

/**
 * Remove comments while preserving newlines and string-literal contents. A
 * small scanner (not a regex) so `//` inside a string is not treated as a
 * comment.
 */
export function stripComments(source: string, language: CodeLanguage): string {
  let result = ""
  let index = 0
  const length = source.length

  const readString = (quote: string, triple: boolean): void => {
    result += quote
    if (triple) result += quote
    index += triple ? 3 : 1
    while (index < length) {
      if (source[index] === "\\") {
        result += source.slice(index, index + 2)
        index += 2
        continue
      }
      if (triple) {
        if (source.startsWith(quote + quote + quote, index)) {
          result += quote + quote + quote
          index += 3
          return
        }
      } else if (source[index] === quote) {
        result += quote
        index += 1
        return
      }
      if (!triple && source[index] === "\n") return
      result += source[index]
      index += 1
    }
  }

  if (language === "python") {
    while (index < length) {
      const char = source[index]
      if (char === "#") {
        while (index < length && source[index] !== "\n") index += 1
        continue
      }
      if (char === '"' || char === "'") {
        const triple = source.startsWith(char + char + char, index)
        readString(char, triple)
        continue
      }
      result += char
      index += 1
    }
    return result
  }

  while (index < length) {
    const char = source[index]
    if (char === "/" && source[index + 1] === "/") {
      while (index < length && source[index] !== "\n") index += 1
      continue
    }
    if (char === "/" && source[index + 1] === "*") {
      index += 2
      while (index < length && !(source[index] === "*" && source[index + 1] === "/")) index += 1
      index += 2
      continue
    }
    if (char === '"' || char === "'" || char === "`") {
      readString(char, false)
      continue
    }
    result += char
    index += 1
  }
  return result
}

function isIdentifierStart(char: string): boolean {
  return /[A-Za-z_$]/.test(char)
}

function isIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9_$]/.test(char)
}

function isDigit(char: string): boolean {
  return char >= "0" && char <= "9"
}

/**
 * Normalized token stream: comments removed, string literals collapsed to
 * `STR`, numeric literals collapsed to `NUM`, whitespace discarded.
 */
export function tokenizeSource(source: string, language: CodeLanguage): string[] {
  const scrubbed = stripComments(source, language)
  const tokens: string[] = []
  let index = 0
  const length = scrubbed.length

  while (index < length) {
    const char = scrubbed[index]
    if (/\s/.test(char)) {
      index += 1
      continue
    }
    if (char === '"' || char === "'" || char === "`") {
      const quote = char
      index += 1
      while (index < length) {
        if (scrubbed[index] === "\\") {
          index += 2
          continue
        }
        if (scrubbed[index] === quote) {
          index += 1
          break
        }
        index += 1
      }
      tokens.push("STR")
      continue
    }
    if (isDigit(char) || (char === "." && isDigit(scrubbed[index + 1] ?? ""))) {
      index += 1
      while (index < length && /[0-9._eExXa-fA-F]/.test(scrubbed[index])) index += 1
      tokens.push("NUM")
      continue
    }
    if (isIdentifierStart(char)) {
      const start = index
      index += 1
      while (index < length && isIdentifierPart(scrubbed[index])) index += 1
      tokens.push(scrubbed.slice(start, index))
      continue
    }
    const pair = scrubbed.slice(index, index + 2)
    if (TWO_CHAR_OPERATORS.has(pair)) {
      tokens.push(pair)
      index += 2
      continue
    }
    tokens.push(char)
    index += 1
  }

  return tokens
}

/** Overlapping k-gram shingles of a token stream. Short streams yield one shingle. */
export function shingleTokens(
  tokens: readonly string[],
  size = SIMILARITY_SHINGLE_SIZE,
): Set<string> {
  const shingles = new Set<string>()
  if (tokens.length === 0) return shingles
  if (tokens.length < size) {
    shingles.add(tokens.join(" "))
    return shingles
  }
  for (let index = 0; index + size <= tokens.length; index += 1) {
    shingles.add(tokens.slice(index, index + size).join(" "))
  }
  return shingles
}

/** Jaccard index of two shingle sets. Empty/empty is 0, not 1. */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const value of a) {
    if (b.has(value)) shared += 1
  }
  const union = a.size + b.size - shared
  if (union === 0) return 0
  return shared / union
}

export function compareSources(
  sourceA: string,
  sourceB: string,
  language: CodeLanguage,
  options: { threshold?: number; shingleSize?: number; minTokens?: number } = {},
): SimilarityComparison {
  const threshold = options.threshold ?? SIMILARITY_FLAG_THRESHOLD
  const shingleSize = options.shingleSize ?? SIMILARITY_SHINGLE_SIZE
  const minTokens = options.minTokens ?? SIMILARITY_MIN_TOKENS

  const tokensA = tokenizeSource(sourceA, language)
  const tokensB = tokenizeSource(sourceB, language)
  const shinglesA = shingleTokens(tokensA, shingleSize)
  const shinglesB = shingleTokens(tokensB, shingleSize)
  const similarity = Math.round(jaccard(shinglesA, shinglesB) * 1000) / 1000

  let shared = 0
  for (const value of shinglesA) {
    if (shinglesB.has(value)) shared += 1
  }

  const enoughTokens = Math.min(tokensA.length, tokensB.length) >= minTokens
  return {
    similarity,
    flagged: enoughTokens && similarity >= threshold,
    evidence: {
      method: "normalized-token-shingling-jaccard",
      shingleSize,
      sharedShingles: shared,
      totalShinglesA: shinglesA.size,
      totalShinglesB: shinglesB.size,
      tokenCountA: tokensA.length,
      tokenCountB: tokensB.length,
      threshold,
    },
  }
}

/**
 * Deterministic, dependency-free text similarity.
 *
 * Free-text quiz answers need a reproducible lexical signal: it is the offline
 * fallback when the semantic (LLM) grader is unavailable, and the offline
 * `mock` provider uses the *same* function so an end-to-end test under
 * `LLM_PROVIDER=mock` exercises real scoring rather than a fixed constant.
 *
 * The metric is the Dice coefficient over word sets, blended with word-bigram
 * Dice so that a paraphrase which reuses the same vocabulary still scores. It
 * is deliberately lexical — not semantic — so it can never be induced to award
 * full marks by an instruction embedded in the student's answer.
 */

/** Case-fold, straighten curly quotes, and collapse whitespace. */
export function normalizeText(input: string): string {
  return input
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

/**
 * Common function words carry little grading signal but would let two unrelated
 * answers share a token ("the") and score above zero. Removing them keeps the
 * lexical signal about content words, which is what a reference answer is made
 * of.
 */
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "has",
  "have",
  "in",
  "into",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "there",
  "these",
  "this",
  "to",
  "was",
  "were",
  "will",
  "with",
])

/** Lowercase content-word tokens; punctuation and stopwords are separators. */
export function tokenize(input: string): string[] {
  const tokens = normalizeText(input).match(/[a-z0-9]+/g) ?? []
  return tokens.filter((token) => !STOPWORDS.has(token))
}

function bigrams(tokens: readonly string[]): string[] {
  const result: string[] = []
  for (let index = 0; index + 1 < tokens.length; index += 1) {
    result.push(`${tokens[index]} ${tokens[index + 1]}`)
  }
  return result
}

/** Set Dice coefficient: `2|A∩B| / (|A| + |B|)`, in [0, 1]. */
export function diceCoefficient(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const setA = new Set(a)
  const setB = new Set(b)
  let intersection = 0
  for (const token of setA) {
    if (setB.has(token)) intersection += 1
  }
  const denominator = setA.size + setB.size
  return denominator === 0 ? 0 : (2 * intersection) / denominator
}

/**
 * Similarity of two free-text answers in [0, 1].
 *
 * An empty side is `0` (an unanswered or blank answer can never match). When
 * either side is a single token there are no bigrams, so the unigram Dice is
 * returned unchanged; otherwise unigrams dominate (`0.6`) with bigrams as the
 * ordering signal (`0.4`).
 */
export function textSimilarity(a: string, b: string): number {
  const tokensA = tokenize(a)
  const tokensB = tokenize(b)
  if (tokensA.length === 0 || tokensB.length === 0) return 0

  const unigram = diceCoefficient(tokensA, tokensB)
  const bigramA = bigrams(tokensA)
  const bigramB = bigrams(tokensB)
  if (bigramA.length === 0 || bigramB.length === 0) return clamp01(unigram)

  return clamp01(0.6 * unigram + 0.4 * diceCoefficient(bigramA, bigramB))
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

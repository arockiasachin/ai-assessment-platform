import { describe, expect, it } from "vitest"

import {
  SIMILARITY_MIN_TOKENS,
  compareSources,
  jaccard,
  nextSimilarityVerdict,
  shingleTokens,
  stripComments,
  tokenizeSource,
} from "@/lib/code-eval/similarity"

const ORIGINAL = `def add(a, b):
    total = a + b
    return total

def average(values):
    result = add(sum(values), 0) / len(values)
    return result
`

// A close copy: only comments and whitespace differ, which normalization erases.
const NEAR_COPY = `# rewritten by a student
def add(a, b):
    total=a+b
    return total

def average(values):
    result = add( sum(values), 0 ) / len(values)
    return result
`

const DIFFERENT = `def sort_values(values):
    items = list(values)
    for i in range(len(items)):
        for j in range(len(items) - 1 - i):
            if items[j] > items[j + 1]:
                items[j], items[j + 1] = items[j + 1], items[j]
    return items
`

describe("stripComments and tokenizeSource", () => {
  it("removes python comments but not comment markers inside strings", () => {
    const stripped = stripComments('x = "# not a comment"  # real comment\n', "python")
    expect(stripped).toContain("# not a comment")
    expect(stripped).not.toContain("real comment")
  })

  it("collapses string and numeric literals to STR and NUM", () => {
    const tokens = tokenizeSource('name = "Ada"  # comment\ncount = 42', "python")
    expect(tokens).toContain("STR")
    expect(tokens).toContain("NUM")
    expect(tokens).not.toContain("Ada")
    expect(tokens).not.toContain("42")
  })
})

describe("jaccard", () => {
  it("is 1 for identical sets, 0 for disjoint, and 0 when one side is empty", () => {
    expect(jaccard(new Set(["a", "b"]), new Set(["a", "b"]))).toBe(1)
    expect(jaccard(new Set(["a"]), new Set(["b"]))).toBe(0)
    expect(jaccard(new Set(), new Set(["a"]))).toBe(0)
  })
})

describe("compareSources", () => {
  it("flags a known-similar pair (comment/whitespace-only differences)", () => {
    const comparison = compareSources(ORIGINAL, NEAR_COPY, "python")
    expect(comparison.similarity).toBeGreaterThanOrEqual(0.8)
    expect(comparison.flagged).toBe(true)
    expect(comparison.evidence.method).toBe("normalized-token-shingling-jaccard")
    expect(comparison.evidence.tokenCountA).toBeGreaterThan(0)
    expect(comparison.evidence.sharedShingles).toBeGreaterThan(0)
  })

  it("does not flag a known-different pair", () => {
    const comparison = compareSources(ORIGINAL, DIFFERENT, "python")
    expect(comparison.similarity).toBeLessThan(0.4)
    expect(comparison.flagged).toBe(false)
  })

  it("never flags a pair below the minimum shingling size", () => {
    const tiny = "print(1)"
    const tokens = tokenizeSource(tiny, "python")
    expect(tokens.length).toBeLessThan(SIMILARITY_MIN_TOKENS)
    const comparison = compareSources(tiny, tiny, "python")
    expect(comparison.similarity).toBe(1)
    expect(comparison.flagged).toBe(false)
  })

  it("flags a pair when the caller lowers the threshold", () => {
    const comparison = compareSources(ORIGINAL, DIFFERENT, "python", { threshold: 0 })
    expect(comparison.flagged).toBe(true)
  })

  it("scores identical sources at 1", () => {
    expect(compareSources(ORIGINAL, ORIGINAL, "python").similarity).toBe(1)
  })
})

describe("shingleTokens", () => {
  it("builds overlapping k-grams and yields one shingle for short streams", () => {
    expect(shingleTokens(["a", "b", "c"], 2)).toEqual(new Set(["a b", "b c"]))
    expect(shingleTokens(["a"], 5)).toEqual(new Set(["a"]))
    expect(shingleTokens([], 5).size).toBe(0)
  })
})

describe("nextSimilarityVerdict", () => {
  it("keeps a human verdict so a re-scan cannot wipe it (TN-48)", () => {
    // The scan recomputes the score; the review is the teacher's. A FLAGGED pair whose
    // score drops, or a CLEARED pair whose score rises, keeps the recorded decision.
    expect(nextSimilarityVerdict("FLAGGED", false)).toBe("FLAGGED")
    expect(nextSimilarityVerdict("CLEARED", true)).toBe("CLEARED")
  })

  it("classifies a new or still-pending pair from the score", () => {
    expect(nextSimilarityVerdict(undefined, true)).toBe("FLAGGED")
    expect(nextSimilarityVerdict(undefined, false)).toBe("PENDING")
    expect(nextSimilarityVerdict("PENDING", true)).toBe("FLAGGED")
    expect(nextSimilarityVerdict("PENDING", false)).toBe("PENDING")
  })
})

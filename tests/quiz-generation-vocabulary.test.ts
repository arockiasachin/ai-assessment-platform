import { describe, expect, it } from "vitest"

import {
  cleanVocabulary,
  isInVocabulary,
  parseSubtopicVocabulary,
  partitionByVocabulary,
  resolveVocabulary,
} from "@/lib/quiz-generation/vocabulary"

/**
 * The course subtopic vocabulary.
 *
 * The behaviour worth pinning is the pair of refusals as much as the behaviour itself: this module
 * folds **case** (formatting, not meaning) and refuses everything else — stemming, fuzzy matching,
 * synonyms — because deciding meaning from string shape is the invented taxonomy
 * `lib/analytics/subtopics.ts` exists to avoid. A test asserting that `gradient` and
 * `gradient & intercept` stay distinct is as load-bearing as one asserting they are both kept.
 */

describe("parseSubtopicVocabulary", () => {
  it("reads a stored array, cleaning it", () => {
    expect(parseSubtopicVocabulary(["slope", " intercepts ", "slope"])).toEqual([
      "slope",
      "intercepts",
    ])
  })

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "slope"],
    ["a number", 42],
    ["an object", { slope: true }],
    ["an array of non-strings", [1, null, {}]],
  ])("returns an empty list for %s rather than throwing", (_label, value) => {
    // The column is unvalidated JSON, read on the generation path. A malformed value must mean
    // "undeclared", never a 500 mid-request.
    expect(parseSubtopicVocabulary(value)).toEqual([])
  })

  it("keeps the usable entries from a mixed array", () => {
    expect(parseSubtopicVocabulary(["slope", 42, null, "intercepts"])).toEqual([
      "slope",
      "intercepts",
    ])
  })
})

describe("cleanVocabulary", () => {
  it("trims, drops blanks, and de-duplicates exactly, preserving order", () => {
    expect(cleanVocabulary(["  slope  ", "", "   ", "intercepts", "slope"])).toEqual([
      "slope",
      "intercepts",
    ])
  })

  it("does not fold case in storage, because the list belongs to the teacher", () => {
    // Classification folds case; storage does not. Rewriting a teacher's `Slope` to `slope` would be
    // editing their list behind their back.
    expect(cleanVocabulary(["Slope", "slope"])).toEqual(["Slope", "slope"])
  })

  it("does not stem, split, or rephrase multi-word tags", () => {
    // `gradient & intercept` is one tag a teacher wrote, not two.
    expect(cleanVocabulary(["gradient & intercept"])).toEqual(["gradient & intercept"])
  })
})

describe("isInVocabulary", () => {
  it("matches a tag written in a different case — the one folding this does", () => {
    expect(isInVocabulary("Slope", ["slope"])).toBe(true)
    expect(isInVocabulary("SLOPE", ["slope", "intercepts"])).toBe(true)
    expect(isInVocabulary("slope", ["Slope"])).toBe(true)
  })

  it("ignores surrounding whitespace on either side", () => {
    expect(isInVocabulary(" slope ", ["slope"])).toBe(true)
    expect(isInVocabulary("slope", [" slope "])).toBe(true)
  })

  it("refuses to match near-duplicates that differ in meaning", () => {
    // The refusals are the point. Each of these would need a judgement about meaning.
    expect(isInVocabulary("slopes", ["slope"])).toBe(false)
    expect(isInVocabulary("gradient", ["gradient & intercept"])).toBe(false)
    expect(isInVocabulary("gradient & intercept", ["gradient"])).toBe(false)
    expect(isInVocabulary("solving equations", ["solving-equations"])).toBe(false)
    expect(isInVocabulary("slope of a line", ["slope"])).toBe(false)
  })
})

describe("partitionByVocabulary", () => {
  it("splits tags into declared and invented", () => {
    const result = partitionByVocabulary(
      ["slope", "Slope", "gradient & intercept"],
      ["slope", "intercepts"],
    )

    // Both spellings of the declared tag land in-vocabulary, and the invented one is reported.
    expect(result.inVocabulary).toEqual(["slope", "Slope"])
    expect(result.offVocabulary).toEqual(["gradient & intercept"])
  })

  it("reports everything as off-vocabulary when nothing is declared", () => {
    // An undeclared course has no controlled list. Calling its tags "in vocabulary" would invent the
    // list this module exists to make explicit.
    const result = partitionByVocabulary(["slope", "intercepts"], [])

    expect(result.inVocabulary).toEqual([])
    expect(result.offVocabulary).toEqual(["slope", "intercepts"])
  })

  it("preserves the original casing in what it reports", () => {
    const result = partitionByVocabulary(["Slope"], ["slope"])
    expect(result.inVocabulary).toEqual(["Slope"])
  })

  it("returns empty halves for no tags", () => {
    expect(partitionByVocabulary([], ["slope"])).toEqual({ inVocabulary: [], offVocabulary: [] })
  })
})

describe("resolveVocabulary", () => {
  it("lets a request that names tags declare them", () => {
    // How a teacher sets the list: the generation form already takes subtopics, so supplying them
    // defines the course's vocabulary rather than being a hint the next request cannot see.
    const result = resolveVocabulary({ requested: ["slope", "intercepts"], stored: [] })

    expect(result).toEqual({ vocabulary: ["slope", "intercepts"], declared: true })
  })

  it("lets a request replace a stored list, since the teacher is editing it", () => {
    const result = resolveVocabulary({ requested: ["graphs"], stored: ["slope", "intercepts"] })

    expect(result.vocabulary).toEqual(["graphs"])
    expect(result.declared).toBe(true)
  })

  it("falls back to the stored list when the request names none", () => {
    const result = resolveVocabulary({ requested: [], stored: ["slope", "intercepts"] })

    expect(result).toEqual({ vocabulary: ["slope", "intercepts"], declared: true })
  })

  it("stays undeclared when neither side names anything", () => {
    // Generation is then unconstrained, exactly as it was before this feature existed.
    expect(resolveVocabulary({ requested: [], stored: [] })).toEqual({
      vocabulary: [],
      declared: false,
    })
  })

  it("treats a request of blanks as naming nothing", () => {
    const result = resolveVocabulary({ requested: ["  ", ""], stored: ["slope"] })

    expect(result).toEqual({ vocabulary: ["slope"], declared: true })
  })
})

import { describe, expect, it } from "vitest"

import { groupSubtopicTokens, type QuestionTagInput } from "@/lib/analytics/subtopics"

/**
 * The subtopic token list.
 *
 * This module deliberately answers "which topics does this assessment cover" and not
 * "how well did the class do on each", because `Question.subtopic` is model-generated
 * free text with no vocabulary control. The tests pin the two properties that make
 * that honest: **no normalisation** (differing tags stay separate) and **untagged
 * questions are reported separately** rather than given a fabricated name.
 */

function question(overrides: Partial<QuestionTagInput> = {}): QuestionTagInput {
  return {
    id: "q1",
    subtopic: "slope",
    points: 2,
    responseCount: 3,
    ...overrides,
  }
}

describe("groupSubtopicTokens", () => {
  it("groups questions by tag", () => {
    const breakdown = groupSubtopicTokens([
      question({ id: "q1", subtopic: "slope" }),
      question({ id: "q2", subtopic: "slope" }),
      question({ id: "q3", subtopic: "systems of equations" }),
    ])

    expect(breakdown.distinctTags).toBe(2)
    expect(breakdown.tokens.map((token) => token.subtopic)).toEqual([
      "slope",
      "systems of equations",
    ])
  })

  it("counts questions, responses and marks per tag", () => {
    const breakdown = groupSubtopicTokens([
      question({ id: "q1", subtopic: "slope", points: 2, responseCount: 3 }),
      question({ id: "q2", subtopic: "slope", points: 5, responseCount: 4 }),
    ])

    expect(breakdown.tokens[0]).toEqual({
      subtopic: "slope",
      questionCount: 2,
      responseCount: 7,
      totalMarks: 7,
      // Undeclared by default: no vocabulary was passed, so nothing can be "in" one.
      inVocabulary: false,
    })
  })

  it("does not normalise case or whitespace", () => {
    // The property that makes this a token list rather than a taxonomy: merging these
    // would be inventing a controlled vocabulary in a string heuristic. They are three
    // tokens, and the UI must show three.
    const breakdown = groupSubtopicTokens([
      question({ id: "q1", subtopic: "slope" }),
      question({ id: "q2", subtopic: "Slope" }),
      question({ id: "q3", subtopic: " slope " }),
    ])

    expect(breakdown.distinctTags).toBe(3)
    expect(breakdown.tokens.map((token) => token.subtopic).sort()).toEqual([
      " slope ",
      "Slope",
      "slope",
    ])
  })

  it("reports untagged questions separately, never as a topic", () => {
    // Naming them "Uncategorised" would put a fabricated token in the list beside real
    // ones. They are counted, and that is all.
    const breakdown = groupSubtopicTokens([
      question({ id: "q1", subtopic: "slope", responseCount: 2 }),
      question({ id: "q2", subtopic: null, responseCount: 5 }),
      question({ id: "q3", subtopic: null, responseCount: 1 }),
    ])

    expect(breakdown.untagged).toEqual({ questionCount: 2, responseCount: 6 })
    expect(breakdown.distinctTags).toBe(1)
    expect(breakdown.tokens.map((token) => token.subtopic)).toEqual(["slope"])
  })

  it("treats a blank tag as untagged", () => {
    // The parser enforces min(1), but the column is plain text and a legacy row could
    // hold whitespace.
    const breakdown = groupSubtopicTokens([question({ subtopic: "   " })])
    expect(breakdown.distinctTags).toBe(0)
    expect(breakdown.untagged.questionCount).toBe(1)
  })

  it("orders by question count descending", () => {
    const breakdown = groupSubtopicTokens([
      question({ id: "q1", subtopic: "rare" }),
      question({ id: "q2", subtopic: "common" }),
      question({ id: "q3", subtopic: "common" }),
      question({ id: "q4", subtopic: "common" }),
    ])

    expect(breakdown.tokens.map((token) => token.subtopic)).toEqual(["common", "rare"])
  })

  it("breaks ties alphabetically, so the order does not depend on row order", () => {
    // Without a tie-break, two equally-sized topics would order by whatever `findMany`
    // returned and the page could flicker between renders.
    const forward = groupSubtopicTokens([
      question({ id: "q1", subtopic: "zebra" }),
      question({ id: "q2", subtopic: "apple" }),
    ])
    const reversed = groupSubtopicTokens([
      question({ id: "q2", subtopic: "apple" }),
      question({ id: "q1", subtopic: "zebra" }),
    ])

    expect(forward.tokens.map((token) => token.subtopic)).toEqual(["apple", "zebra"])
    expect(reversed.tokens.map((token) => token.subtopic)).toEqual(["apple", "zebra"])
  })

  it("returns an empty list for an assessment with no questions", () => {
    expect(groupSubtopicTokens([])).toEqual({
      tokens: [],
      untagged: { questionCount: 0, responseCount: 0 },
      distinctTags: 0,
      vocabulary: [],
      offVocabularyTags: [],
    })
  })

  it("flags declared tags and reports the invented ones", () => {
    // The reason the vocabulary exists. A tag from the course's declared list is curated; anything
    // else is the model inventing again, and the reader distinguishes them rather than presenting both
    // as equally authoritative.
    const breakdown = groupSubtopicTokens(
      [
        question({ id: "q1", subtopic: "slope" }),
        question({ id: "q2", subtopic: "intercepts" }),
        question({ id: "q3", subtopic: "gradient & intercept" }),
      ],
      ["slope", "intercepts"],
    )

    expect(breakdown.vocabulary).toEqual(["slope", "intercepts"])
    // Sorted, not insertion-ordered — compare as a set so the assertion is about the classification
    // rather than the token ordering, which has its own test.
    expect(
      breakdown.tokens
        .filter((token) => token.inVocabulary)
        .map((token) => token.subtopic)
        .sort(),
    ).toEqual(["intercepts", "slope"])
    expect(breakdown.offVocabularyTags).toEqual(["gradient & intercept"])
  })

  it("classifies a differently-cased tag as declared, and keeps its own spelling", () => {
    // Case is formatting, not meaning: `Slope` is the declared `slope` written differently. The token
    // still reports the casing that was stored.
    const breakdown = groupSubtopicTokens([question({ id: "q1", subtopic: "Slope" })], ["slope"])

    expect(breakdown.tokens[0].inVocabulary).toBe(true)
    expect(breakdown.tokens[0].subtopic).toBe("Slope")
    expect(breakdown.offVocabularyTags).toEqual([])
  })

  it("reports every tag as invented when the course declares nothing", () => {
    // An undeclared course has no controlled list, so claiming its tags are "in vocabulary" would
    // invent the very thing the vocabulary exists to make explicit.
    const breakdown = groupSubtopicTokens([question({ id: "q1", subtopic: "slope" })])

    expect(breakdown.vocabulary).toEqual([])
    expect(breakdown.offVocabularyTags).toEqual(["slope"])
  })

  it("keeps a zero-response token, because a tag with no responses is a real fact", () => {
    // Not the em-dash case: zero responses to a tagged question is knowable and worth
    // showing. Dropping it would hide that the generator tagged a question nobody has
    // answered yet.
    const breakdown = groupSubtopicTokens([question({ subtopic: "new topic", responseCount: 0 })])
    expect(breakdown.tokens[0].responseCount).toBe(0)
    expect(breakdown.tokens[0].questionCount).toBe(1)
  })

  it("does not mutate the question inputs", () => {
    const input = [
      question({ id: "q1", subtopic: "slope", points: 2, responseCount: 3 }),
      question({ id: "q2", subtopic: "slope", points: 4, responseCount: 1 }),
    ]
    const before = JSON.parse(JSON.stringify(input))
    groupSubtopicTokens(input)
    expect(JSON.parse(JSON.stringify(input))).toEqual(before)
  })

  it("does not mutate the array it is given", () => {
    const input = [question({ id: "q1" }), question({ id: "q2", subtopic: "other" })]
    const before = input.map((q) => q.id)
    groupSubtopicTokens(input)
    expect(input.map((q) => q.id)).toEqual(before)
  })
})

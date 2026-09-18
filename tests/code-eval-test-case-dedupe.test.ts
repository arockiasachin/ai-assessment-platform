import { describe, expect, it } from "vitest"

import { testCaseFingerprint, withoutDuplicateTestCases } from "@/lib/code-eval/test-case-dedupe"

type Case = {
  category: string
  name: string
  input: string | null
  expectedOutput: string | null
}

function testCase(overrides: Partial<Case> = {}): Case {
  return {
    category: "input-output",
    name: "adds two numbers",
    input: "1 2",
    expectedOutput: "3",
    ...overrides,
  }
}

describe("testCaseFingerprint", () => {
  it("ignores surrounding whitespace", () => {
    expect(testCaseFingerprint(testCase({ name: " x " }))).toBe(
      testCaseFingerprint(testCase({ name: "x" })),
    )
  })

  it("treats null and empty input as the same content, not a collision across fields", () => {
    const a = testCaseFingerprint({
      category: "unit",
      name: "f",
      input: null,
      expectedOutput: null,
    })
    const b = testCaseFingerprint({ category: "unit", name: "f", input: "", expectedOutput: "" })
    expect(a).toBe(b)

    // `("a", "b")` must not collide with `("ab", "")`.
    const ab = testCaseFingerprint({
      category: "input-output",
      name: "a",
      input: "b",
      expectedOutput: "",
    })
    const joined = testCaseFingerprint({
      category: "input-output",
      name: "ab",
      input: "",
      expectedOutput: "",
    })
    expect(ab).not.toBe(joined)
  })
})

describe("withoutDuplicateTestCases", () => {
  it("drops a draft that exactly repeats a case already on the task (TN-57)", () => {
    const existing = [testCase()]
    // A second Generate run returning the same case must not append it again.
    expect(withoutDuplicateTestCases([testCase()], existing)).toEqual([])
  })

  it("keeps a same-named draft whose expected output changed", () => {
    const existing = [testCase({ expectedOutput: "3" })]
    const revised = testCase({ expectedOutput: "3.0" })

    expect(withoutDuplicateTestCases([revised], existing)).toEqual([revised])
  })

  it("deduplicates within one batch as well", () => {
    const kept = withoutDuplicateTestCases(
      [testCase(), testCase({ name: "other" }), testCase()],
      [],
    )

    expect(kept).toHaveLength(2)
    expect(kept.map((entry) => entry.name)).toEqual(["adds two numbers", "other"])
  })

  it("preserves order and returns every genuinely new draft", () => {
    const existing = [testCase({ name: "old" })]
    const drafts = [testCase({ name: "new-1" }), testCase({ name: "new-2" })]

    expect(withoutDuplicateTestCases(drafts, existing)).toEqual(drafts)
  })
})

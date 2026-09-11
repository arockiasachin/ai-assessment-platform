import { describe, expect, it } from "vitest"

import { parseGeneratedTestCases } from "@/lib/code-eval/parsing"

const VALID = {
  testCases: [
    {
      name: "Greets the user",
      description: "prints hello",
      category: "input-output",
      input: "Ada\n",
      expectedOutput: "Hello, Ada\n",
      points: 2,
    },
    {
      name: "Adds two numbers",
      description: "calls add",
      category: "unit",
      input: JSON.stringify({ function: "add", args: [1, 2] }),
      expectedOutput: "3",
      points: 1,
    },
    {
      name: "Defines a function",
      description: "structure",
      category: "structure",
      input: JSON.stringify({ mustContain: ["def "] }),
      expectedOutput: null,
      points: 1,
    },
  ],
}

describe("parseGeneratedTestCases", () => {
  it("parses a valid object payload", () => {
    const drafts = parseGeneratedTestCases(JSON.stringify(VALID))
    expect(drafts).toHaveLength(3)
    expect(drafts[0]).toMatchObject({ category: "input-output", points: 2 })
    expect(drafts[2].expectedOutput).toBeNull()
  })

  it("parses fenced JSON and a bare array", () => {
    const fenced = parseGeneratedTestCases("```json\n" + JSON.stringify(VALID) + "\n```")
    expect(fenced).toHaveLength(3)
    const array = parseGeneratedTestCases(JSON.stringify(VALID.testCases))
    expect(array).toHaveLength(3)
  })

  it("defaults points to 1 when omitted", () => {
    const drafts = parseGeneratedTestCases(
      JSON.stringify({
        testCases: [{ name: "x", category: "input-output", input: "a", expectedOutput: "b" }],
      }),
    )
    expect(drafts[0].points).toBe(1)
  })

  it("rejects malformed JSON", () => {
    expect(() => parseGeneratedTestCases("not json")).toThrowError(/valid JSON/)
  })

  it("rejects a payload without a testCases array", () => {
    expect(() => parseGeneratedTestCases(JSON.stringify({ tests: [] }))).toThrowError(
      /testCases array/,
    )
  })

  it("rejects an input-output test without an expected output", () => {
    expect(() =>
      parseGeneratedTestCases(
        JSON.stringify({
          testCases: [{ name: "x", category: "input-output", input: "a" }],
        }),
      ),
    ).toThrowError(/expectedOutput/)
  })

  it("rejects a unit test whose input is not a function spec", () => {
    expect(() =>
      parseGeneratedTestCases(
        JSON.stringify({
          testCases: [{ name: "x", category: "unit", input: "not json", expectedOutput: "1" }],
        }),
      ),
    ).toThrowError(/unit input/)
  })

  it("rejects duplicate test names", () => {
    expect(() =>
      parseGeneratedTestCases(
        JSON.stringify({
          testCases: [
            { name: "same", category: "structure", input: "{}" },
            { name: "same", category: "structure", input: "{}" },
          ],
        }),
      ),
    ).toThrowError(/unique/)
  })

  it("rejects a shortfall against the requested count", () => {
    expect(() => parseGeneratedTestCases(JSON.stringify(VALID), { expectedCount: 5 })).toThrowError(
      /5 were requested/,
    )
  })
})

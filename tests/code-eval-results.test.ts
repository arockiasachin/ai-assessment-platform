import { describe, expect, it } from "vitest"

import {
  HARNESS_RESULT_SENTINEL,
  buildHarnessPayload,
  buildHarnessProgram,
} from "@/lib/code-eval/harness"
import {
  buildTestResults,
  computeCoverage,
  failureReason,
  measuredRuntimeMs,
  normalizeCategory,
  parseHarnessOutput,
  resolveRunStatus,
  summarizeResults,
} from "@/lib/code-eval/results"

const testCases = [
  { id: "t1", name: "Adds numbers", description: null, category: "unit", points: 2 },
  { id: "t2", name: "Prints greeting", description: "stdout", category: "input-output", points: 1 },
  { id: "t3", name: "No eval", description: null, category: "structure", points: 1 },
]

describe("parseHarnessOutput", () => {
  it("extracts the sentinel JSON even when student output precedes it", () => {
    const line = `${HARNESS_RESULT_SENTINEL}${JSON.stringify({
      tests: [
        {
          id: "t1",
          passed: true,
          stdout: "ok",
          stderr: "",
          message: "output matched",
          durationMs: 3,
        },
      ],
    })}`
    const results = parseHarnessOutput(`stray student output\n${line}\n`)
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ id: "t1", passed: true, message: "output matched" })
  })

  it("returns an empty list for output without a sentinel", () => {
    expect(parseHarnessOutput("no sentinel here")).toEqual([])
    expect(parseHarnessOutput("")).toEqual([])
  })

  it("returns an empty list for malformed sentinel JSON", () => {
    expect(parseHarnessOutput(`${HARNESS_RESULT_SENTINEL}{not json`)).toEqual([])
  })

  it("coerces missing fields to safe defaults", () => {
    const results = parseHarnessOutput(
      `${HARNESS_RESULT_SENTINEL}${JSON.stringify({ tests: [{}] })}`,
    )
    expect(results[0]).toEqual({
      id: "",
      passed: false,
      stdout: "",
      stderr: "",
      message: "",
      signal: null,
      durationMs: 0,
    })
  })
})

describe("buildTestResults", () => {
  it("reports per-test pass/fail with output and points", () => {
    const results = buildTestResults(
      [
        {
          id: "t1",
          passed: true,
          stdout: "42",
          stderr: "",
          message: "returned the expected value",
          durationMs: 5,
        },
        {
          id: "t2",
          passed: false,
          stdout: "hi",
          stderr: "boom",
          message: "output did not match",
          durationMs: 7,
        },
      ],
      testCases,
    )

    expect(results).toHaveLength(3)
    expect(results[0]).toMatchObject({ testCaseId: "t1", passed: true, earnedPoints: 2 })
    expect(results[1]).toMatchObject({
      testCaseId: "t2",
      passed: false,
      earnedPoints: 0,
      stderr: "boom",
    })
  })

  it("records tests the harness never reported as failures, never passes", () => {
    const results = buildTestResults([], testCases, { killedMessage: "killed" })
    expect(results.every((result) => !result.passed)).toBe(true)
    expect(results[0].message).toBe("killed")
    expect(results[0].earnedPoints).toBe(0)
  })
})

describe("summarizeResults", () => {
  it("counts passes, fails, and points, and only reports allPassed when every test passed", () => {
    const results = buildTestResults(
      [
        { id: "t1", passed: true, stdout: "", stderr: "", message: "", durationMs: 0 },
        { id: "t2", passed: false, stdout: "", stderr: "", message: "", durationMs: 0 },
        { id: "t3", passed: true, stdout: "", stderr: "", message: "", durationMs: 0 },
      ],
      testCases,
    )
    const summary = summarizeResults(results)
    expect(summary).toMatchObject({
      passedCount: 2,
      failedCount: 1,
      totalCount: 3,
      earnedPoints: 3,
      maxPoints: 4,
      allPassed: false,
    })
  })
})

describe("resolveRunStatus", () => {
  it("maps kills to TIMEOUT and memory exhaustion to ERROR", () => {
    expect(resolveRunStatus({ timedOut: true, memoryExceeded: true, allPassed: false })).toBe(
      "TIMEOUT",
    )
    expect(resolveRunStatus({ timedOut: false, memoryExceeded: true, allPassed: false })).toBe(
      "ERROR",
    )
    expect(resolveRunStatus({ timedOut: false, memoryExceeded: false, allPassed: true })).toBe(
      "PASSED",
    )
    expect(resolveRunStatus({ timedOut: false, memoryExceeded: false, allPassed: false })).toBe(
      "FAILED",
    )
  })
})

describe("normalizeCategory", () => {
  it("normalizes aliases and falls back to unit", () => {
    expect(normalizeCategory("input_output")).toBe("input-output")
    expect(normalizeCategory("IO")).toBe("input-output")
    expect(normalizeCategory("code quality")).toBe("code-quality")
    expect(normalizeCategory("structure")).toBe("structure")
    expect(normalizeCategory("nonsense")).toBe("unit")
    expect(normalizeCategory(42)).toBe("unit")
  })
})

describe("computeCoverage", () => {
  it("is executed/total and null when there are no tests", () => {
    expect(computeCoverage(2, 4)).toBe(0.5)
    expect(computeCoverage(0, 0)).toBeNull()
  })

  it("is null — not 0 — when nothing executed, because the run measured nothing (SN-34)", () => {
    // The sandbox-error run reported no harness results against three test cases; the page
    // rendered "Coverage 0%" from a measurement that never happened. A genuinely executed run
    // that failed every case still reports each case, so `executedCount` is non-zero there.
    expect(computeCoverage(0, 3)).toBeNull()
    expect(computeCoverage(1, 1)).toBe(1)
  })
})

describe("measuredRuntimeMs", () => {
  it("treats 0ms and null as not measured (SN-34)", () => {
    // A sandboxed run that executed takes a non-zero wall clock, so 0ms is the unexecuted run
    // the page used to render as "0ms".
    expect(measuredRuntimeMs({ runtimeMs: 0, totalCount: 3 })).toBeNull()
    expect(measuredRuntimeMs({ runtimeMs: null, totalCount: 3 })).toBeNull()
    expect(measuredRuntimeMs({ runtimeMs: 142, totalCount: 0 })).toBeNull()
    expect(measuredRuntimeMs({ runtimeMs: 142, totalCount: 3 })).toBe(142)
  })
})

describe("failureReason", () => {
  const base = {
    passed: false,
    message: "Not executed: the run ended before this test.",
    description: "Slope is 2.",
  }

  it("surfaces the failure cause even when the case has a description", () => {
    // The results table used to render `description ?? message`, so every case with a
    // description hid the reason the run actually failed (SN-33).
    expect(failureReason(base)).toBe("Not executed: the run ended before this test.")
  })

  it("says nothing for a pass, for the filler message, or for a duplicate of the description", () => {
    expect(failureReason({ ...base, passed: true })).toBeNull()
    expect(failureReason({ ...base, message: "Failed." })).toBeNull()
    expect(failureReason({ ...base, message: "Slope is 2." })).toBeNull()
    expect(failureReason({ ...base, message: "   " })).toBeNull()
  })
})

describe("harness program builders", () => {
  it("emits a sentinel and payload deterministically", () => {
    const program = buildHarnessProgram("python")
    expect(program).toContain(HARNESS_RESULT_SENTINEL)
    expect(buildHarnessProgram("python")).toBe(program)
    expect(buildHarnessProgram("javascript")).toContain(HARNESS_RESULT_SENTINEL)
  })

  it("serializes the payload as JSON", () => {
    const payload = buildHarnessPayload({
      language: "python",
      source: "print(1)",
      tests: [
        {
          id: "t1",
          name: "one",
          category: "input-output",
          input: "1",
          expectedOutput: "1",
          points: 1,
        },
      ],
      timeLimitMs: 1000,
    })
    expect(JSON.parse(payload).tests[0].id).toBe("t1")
  })
})

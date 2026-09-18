import { describe, expect, it } from "vitest"

import {
  applyStudentVisibility,
  HARNESS_RESULT_SENTINEL,
  stripHarnessFraming,
} from "@/lib/code-eval"
import type { TestResult } from "@/lib/contracts/code-eval"

/**
 * Pure coverage for the two rules the student code workspace adds:
 * hidden-case detail never reaches a student, and the harness's own framing is
 * never shown as if it were the student's console output.
 *
 * The database-backed half (that the submit pipeline actually applies both) is
 * in `tests/code-eval-free-run.test.ts`.
 */

function result(overrides: Partial<TestResult> & { testCaseId: string }): TestResult {
  return {
    name: overrides.name ?? "A case",
    description: overrides.description ?? "A description",
    category: "input-output",
    points: 1,
    earnedPoints: 0,
    passed: false,
    stdout: overrides.stdout ?? "observed output",
    stderr: overrides.stderr ?? "trace",
    message: overrides.message ?? "output did not match the expected result",
    durationMs: 3,
    ...overrides,
  }
}

describe("applyStudentVisibility", () => {
  it("reveals a visible case's input, expected and actual output", () => {
    const [visible] = applyStudentVisibility(
      [
        result({
          testCaseId: "case-1",
          name: "Echoes input",
          description: "Reads a number",
          passed: true,
          earnedPoints: 2,
          stdout: "7",
        }),
      ],
      [{ id: "case-1", input: "7\n", expectedOutput: "7\n", isHidden: false }],
    )

    expect(visible).toMatchObject({
      isHidden: false,
      input: "7\n",
      expectedOutput: "7\n",
      actualOutput: "7",
      passed: true,
      description: "Reads a number",
    })
  })

  it("nulls every detail field of a hidden case but keeps pass/fail", () => {
    const [hidden] = applyStudentVisibility(
      [
        result({
          testCaseId: "case-hidden",
          name: "Secret case",
          passed: true,
          earnedPoints: 3,
          stdout: "leaked output",
          stderr: "leaked trace",
          message: "output matched",
        }),
      ],
      [
        {
          id: "case-hidden",
          input: "secret input",
          expectedOutput: "secret expected",
          isHidden: true,
        },
      ],
    )

    expect(hidden).toMatchObject({
      testCaseId: "case-hidden",
      passed: true,
      earnedPoints: 3,
      isHidden: true,
      input: null,
      expectedOutput: null,
      actualOutput: null,
      stdout: "",
      stderr: "",
      message: "",
      description: null,
    })
    // The failure mode this exists to prevent: the expected output must not be
    // anywhere in the serialized payload, not merely absent from one field.
    expect(JSON.stringify(hidden)).not.toContain("secret expected")
    expect(JSON.stringify(hidden)).not.toContain("leaked output")
  })

  it("treats a result whose case no longer exists as hidden", () => {
    const [orphan] = applyStudentVisibility(
      [result({ testCaseId: "deleted-case", stdout: "orphan output" })],
      [{ id: "some-other-case", input: "x", expectedOutput: "y", isHidden: false }],
    )
    expect(orphan.isHidden).toBe(true)
    expect(orphan.input).toBeNull()
    expect(orphan.expectedOutput).toBeNull()
    expect(orphan.stdout).toBe("")
  })
})

describe("stripHarnessFraming", () => {
  it("removes the sentinel line and keeps any surrounding program output", () => {
    const stdout = `hello\n${HARNESS_RESULT_SENTINEL}{"tests":[{"id":"c1","stdout":"hidden-ish"}]}\n`
    const stripped = stripHarnessFraming(stdout)
    expect(stripped).toBe("hello")
    expect(stripped).not.toContain(HARNESS_RESULT_SENTINEL)
    expect(stripped).not.toContain("hidden-ish")
  })

  it("returns an empty string for absent stdout", () => {
    expect(stripHarnessFraming(null)).toBe("")
    expect(stripHarnessFraming("")).toBe("")
  })
})

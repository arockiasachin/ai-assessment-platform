import {
  TEST_CATEGORIES,
  testCategorySchema,
  testResultSchema,
  type TestCategory,
  type TestResult,
  type TestRunStatusValue,
} from "@/lib/contracts/code-eval"

import { HARNESS_RESULT_SENTINEL } from "./harness"

/**
 * Pure result parsing and aggregation.
 *
 * Everything here is deterministic and Docker-free so it is unit tested in the
 * fast suite; the executor feeds it raw container output. It never invents a
 * pass: a test case the harness did not report is recorded as a failure with an
 * explicit message.
 */

export type HarnessTestResult = {
  id: string
  passed: boolean
  stdout: string
  stderr: string
  message: string
  /** The signal that killed the executed program, e.g. `SIGKILL` on OOM. */
  signal?: string | null
  durationMs: number
}

/** The minimum a test case must expose for aggregation. */
export type ResultTestCase = {
  id: string
  name: string
  description: string | null
  category: string
  points: number
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function asFiniteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

/**
 * Normalize the free-text `TestCase.category` column (and model output) into the
 * four supported categories. Unknown values fall back to `unit`, the schema
 * default, rather than failing a run.
 */
export function normalizeCategory(value: unknown): TestCategory {
  if (typeof value !== "string") return "unit"
  const key = value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
  const aliases: Record<string, TestCategory> = {
    unit: "unit",
    unittest: "unit",
    "unit-test": "unit",
    "input-output": "input-output",
    inputoutput: "input-output",
    io: "input-output",
    structure: "structure",
    "code-quality": "code-quality",
    codequality: "code-quality",
    quality: "code-quality",
  }
  const normalized = aliases[key]
  if (normalized) return normalized
  const direct = testCategorySchema.safeParse(key)
  return direct.success ? direct.data : "unit"
}

/** A human-readable label for the contract response. */
export function categoryLabel(category: TestCategory): string {
  switch (category) {
    case "unit":
      return "Unit test"
    case "input-output":
      return "Input / output"
    case "structure":
      return "Structure"
    case "code-quality":
      return "Code quality signal"
  }
}

export function isSupportedCategory(value: string): value is TestCategory {
  return (TEST_CATEGORIES as readonly string[]).includes(value)
}

/**
 * Parse the harness's sentinel-terminated JSON line out of container stdout.
 *
 * SECURITY: only the harness may write the container's stdout. Untrusted
 * student code that manages to write a `__CODE_EVAL_RESULT__` line (for example
 * a trailing timer, or a direct `fs.writeSync(1, ...)` / `os.write(1, ...)`)
 * would otherwise be able to forge per-test pass/fail evidence. The harness
 * emits exactly one result line and nothing after it, so any deviation —
 * a second sentinel, or any non-empty output after it — is treated as
 * tampering: the parse fails closed and every test is reported as not executed.
 */
export function parseHarnessOutput(stdout: string): HarnessTestResult[] {
  if (!stdout) return []
  const lines = stdout.split(/\r?\n/)
  const sentinelLineIndexes: number[] = []
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].includes(HARNESS_RESULT_SENTINEL)) sentinelLineIndexes.push(index)
  }
  if (sentinelLineIndexes.length !== 1) return []
  const index = sentinelLineIndexes[0]
  if (lines.slice(index + 1).some((line) => line.trim() !== "")) return []
  const line = lines[index]
  const at = line.lastIndexOf(HARNESS_RESULT_SENTINEL)
  const raw = line.slice(at + HARNESS_RESULT_SENTINEL.length)
  try {
    const parsed: unknown = JSON.parse(raw)
    const tests = (parsed as { tests?: unknown })?.tests
    if (!Array.isArray(tests)) return []
    const results: HarnessTestResult[] = []
    for (const entry of tests) {
      if (!entry || typeof entry !== "object") continue
      const record = entry as Record<string, unknown>
      results.push({
        id: asString(record.id),
        passed: record.passed === true,
        stdout: asString(record.stdout),
        stderr: asString(record.stderr),
        message: asString(record.message),
        signal: typeof record.signal === "string" ? record.signal : null,
        durationMs: Math.max(0, Math.round(asFiniteNumber(record.durationMs))),
      })
    }
    return results
  } catch {
    return []
  }
}

/**
 * Merge harness output with the persisted test cases into per-test results.
 * Test cases the harness never reported (because the container was killed) are
 * emitted as failures so the report is always complete.
 */
export function buildTestResults(
  harnessResults: readonly HarnessTestResult[],
  testCases: readonly ResultTestCase[],
  options: { killedMessage?: string } = {},
): TestResult[] {
  const byId = new Map(harnessResults.map((result) => [result.id, result]))

  return testCases.map((testCase) => {
    const category = normalizeCategory(testCase.category)
    const observed = byId.get(testCase.id)
    if (!observed) {
      return testResultSchema.parse({
        testCaseId: testCase.id,
        name: testCase.name,
        description: testCase.description,
        category,
        points: testCase.points,
        earnedPoints: 0,
        passed: false,
        stdout: "",
        stderr: "",
        message: options.killedMessage ?? "Not executed: the run ended before this test.",
        durationMs: 0,
      })
    }
    return testResultSchema.parse({
      testCaseId: testCase.id,
      name: testCase.name,
      description: testCase.description,
      category,
      points: testCase.points,
      earnedPoints: observed.passed ? testCase.points : 0,
      passed: observed.passed,
      stdout: observed.stdout,
      stderr: observed.stderr,
      message: observed.message || (observed.passed ? "Passed." : "Failed."),
      durationMs: observed.durationMs,
    })
  })
}

export type ResultSummary = {
  passedCount: number
  failedCount: number
  totalCount: number
  earnedPoints: number
  maxPoints: number
  allPassed: boolean
}

export function summarizeResults(results: readonly TestResult[]): ResultSummary {
  let passedCount = 0
  let earnedPoints = 0
  let maxPoints = 0
  for (const result of results) {
    if (result.passed) passedCount += 1
    earnedPoints += result.earnedPoints
    maxPoints += result.points
  }
  const totalCount = results.length
  return {
    passedCount,
    failedCount: totalCount - passedCount,
    totalCount,
    earnedPoints: Math.round(earnedPoints * 100) / 100,
    maxPoints: Math.round(maxPoints * 100) / 100,
    allPassed: totalCount > 0 && passedCount === totalCount,
  }
}

/**
 * Map a run's evidence to a `TestRunStatus`. A wall-clock kill is a TIMEOUT; a
 * memory kill is an ERROR (infrastructure, not a wrong answer); otherwise the
 * run passes only when every test passed.
 */
export function resolveRunStatus(input: {
  timedOut: boolean
  memoryExceeded: boolean
  allPassed: boolean
}): TestRunStatusValue {
  if (input.timedOut) return "TIMEOUT"
  if (input.memoryExceeded) return "ERROR"
  return input.allPassed ? "PASSED" : "FAILED"
}

/** Execution coverage proxy: executed tests / total tests in [0, 1]. */
export function computeCoverage(executedCount: number, totalCount: number): number | null {
  if (totalCount <= 0) return null
  const ratio = executedCount / totalCount
  return Math.max(0, Math.min(1, Math.round(ratio * 1000) / 1000))
}

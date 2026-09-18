import {
  testRunStatusSchema,
  type CodeLanguage,
  type TestResult,
  type TestRunStatusValue,
} from "@/lib/contracts/code-eval"

import { SandboxUnavailableError } from "./errors"
import { executeSandbox, type SandboxExecutor } from "./executor"
import type { HarnessTestSpec } from "./harness"
import {
  buildTestResults,
  computeCoverage,
  normalizeCategory,
  parseHarnessOutput,
  resolveRunStatus,
  summarizeResults,
  type ResultSummary,
  type ResultTestCase,
} from "./results"

/**
 * The single execution pipeline behind both student paths.
 *
 * The counting **Submit** (`POST /api/student/code-submissions`) and the free
 * **Run** (`POST /api/student/code-submissions/run`) differ only in which test
 * cases they are handed, what they do with the outcome, and whether they persist
 * a `TestRun`. The sandbox call, harness parsing, per-test aggregation, status
 * mapping and coverage are identical, so they live here once. A divergence
 * between the two paths would mean a free run and a graded run disagreeing about
 * the same code — exactly what a preview feature must never do.
 *
 * The executor is injectable so both services are testable without Docker.
 */

/** A test case as the executor needs it, independent of how it was loaded. */
export type ExecutionTestCase = {
  id: string
  name: string
  description: string | null
  category: string
  input: string | null
  expectedOutput: string | null
  points: number
  isHidden: boolean
}

export type ExecutionRequest = {
  language: CodeLanguage
  source: string
  testCases: readonly ExecutionTestCase[]
  timeLimitMs: number
  memoryLimitMb: number
}

export type ExecutionResult = {
  status: TestRunStatusValue
  results: TestResult[]
  summary: ResultSummary
  /** Executed tests / submitted tests, or `null` when nothing was reported. */
  coverage: number | null
  runtimeMs: number
  /** Raw container stdout (the harness line included); callers decide whether to strip it. */
  stdout: string
  stderr: string
  timedOut: boolean
  memoryExceeded: boolean
  /** Infra-level kill/error explanation, or `null` on a clean run. */
  killMessage: string | null
}

export type ExecutionDeps = { executor?: SandboxExecutor }

/** The harness's view of a test case. */
export function toHarnessTests(testCases: readonly ExecutionTestCase[]): HarnessTestSpec[] {
  return testCases.map((testCase) => ({
    id: testCase.id,
    name: testCase.name,
    category: normalizeCategory(testCase.category),
    input: testCase.input,
    expectedOutput: testCase.expectedOutput,
    points: Number(testCase.points),
  }))
}

/**
 * Execute one source against the given test cases.
 *
 * An unavailable sandbox is thrown as {@link SandboxUnavailableError} rather
 * than returned, so a caller that has already reserved a graded attempt can
 * release it before the error reaches the route (the SN-27 rule), and the free
 * path simply reports 503. Per-test failures are returned as evidence — never
 * thrown, and never a grade.
 */
export async function executeTestCases(
  request: ExecutionRequest,
  deps: ExecutionDeps = {},
): Promise<ExecutionResult> {
  const executor = deps.executor ?? executeSandbox
  const outcome = await executor({
    language: request.language,
    source: request.source,
    tests: toHarnessTests(request.testCases),
    timeLimitMs: request.timeLimitMs,
    memoryLimitMb: request.memoryLimitMb,
  })

  if (outcome.kind === "unavailable") {
    throw new SandboxUnavailableError(
      outcome.message ??
        "The code sandbox is unavailable right now, so your code was not run. Try again shortly.",
    )
  }

  const harnessResults = parseHarnessOutput(outcome.stdout)
  const resultTestCases: ResultTestCase[] = request.testCases.map((testCase) => ({
    id: testCase.id,
    name: testCase.name,
    description: testCase.description,
    category: testCase.category,
    points: Number(testCase.points),
    isHidden: testCase.isHidden,
  }))
  const results = buildTestResults(harnessResults, resultTestCases, {
    killedMessage: outcome.message ?? undefined,
  })
  const summary = summarizeResults(results)
  const status = resolveRunStatus({
    timedOut: outcome.timedOut,
    memoryExceeded: outcome.memoryExceeded,
    allPassed: summary.allPassed,
  })

  return {
    // Guard the enum the same way the run serializer does: an unknown status is
    // reported as ERROR, never invented.
    status: testRunStatusSchema.safeParse(status).success ? status : "ERROR",
    results,
    summary,
    coverage: computeCoverage(harnessResults.length, request.testCases.length),
    runtimeMs: outcome.wallClockMs,
    stdout: outcome.stdout,
    stderr: outcome.stderr,
    timedOut: outcome.timedOut,
    memoryExceeded: outcome.memoryExceeded,
    killMessage: outcome.message,
  }
}

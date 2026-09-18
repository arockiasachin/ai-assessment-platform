import {
  codeRunResultSchema,
  codeSubmissionRequestSchema,
  type CodeRunResult,
} from "@/lib/contracts/code-eval"
import type { AuthUser } from "@/lib/session"

import { loadEnrolledCodeTask } from "./authz"
import { CodeEvalError } from "./errors"
import { executeTestCases, type ExecutionDeps } from "./execute"
import { consumeFreeRunSlot } from "./free-run-throttle"
import { stripHarnessFraming } from "./results"
import { loadActiveTestCases } from "./test-cases"
import { applyStudentVisibility } from "./visibility"

/**
 * The free sample Run.
 *
 * Executes the source against the task's **visible, active** test cases and
 * returns a result that is deliberately *not* evidence: no `TestRun` row, no
 * `Submission` write, no cap consumption. The only database effect is the
 * throttle marker in `consumeFreeRunSlot`. This is the path the "Run" button
 * uses; "Submit" stays with `submitCodeForStudent`, which is unchanged except
 * that it too now executes active cases only.
 *
 * Samples come from `isHidden: false` — the same column the teacher toggles with
 * "Hidden from students". Draft (unpublished, model-generated) cases are excluded
 * by `loadActiveTestCases`, so a free run can never disclose an unreviewed case
 * either.
 */
export async function runSamplesForStudent(
  user: AuthUser,
  input: unknown,
  deps: ExecutionDeps = {},
): Promise<CodeRunResult> {
  const request = codeSubmissionRequestSchema.parse(input)
  const enrolled = await loadEnrolledCodeTask(user, request.assessmentId)

  const active = await loadActiveTestCases(enrolled.codeTaskId, enrolled.metadata)
  const samples = active.filter((testCase) => !testCase.isHidden)
  const hiddenCount = active.length - samples.length
  if (samples.length === 0) {
    throw new CodeEvalError(
      409,
      "This code task has no visible sample test cases yet, so there is nothing to run.",
    )
  }

  // Throttled before the container starts. Consuming after the sample check means
  // a task with no samples never spends a student's throttle budget.
  const decision = await consumeFreeRunSlot(enrolled.studentId)
  if (!decision.allowed) {
    throw new CodeEvalError(
      429,
      `Too many sample runs. Try again in ${decision.retryAfterSeconds} seconds.`,
    )
  }

  const execution = await executeTestCases(
    {
      language: enrolled.language === "javascript" ? "javascript" : "python",
      source: request.sourceCode,
      testCases: samples.map((testCase) => ({
        id: testCase.id,
        name: testCase.name,
        description: testCase.description,
        category: testCase.category,
        input: testCase.input,
        expectedOutput: testCase.expectedOutput,
        points: Number(testCase.points),
        isHidden: testCase.isHidden,
      })),
      timeLimitMs: enrolled.timeLimitMs,
      memoryLimitMb: enrolled.memoryLimitMb,
    },
    deps,
  )

  return codeRunResultSchema.parse({
    status: execution.status,
    passedCount: execution.summary.passedCount,
    failedCount: execution.summary.failedCount,
    totalCount: execution.summary.totalCount,
    earnedPoints: execution.summary.earnedPoints,
    maxPoints: execution.summary.maxPoints,
    runtimeMs: execution.runtimeMs,
    coverage: execution.coverage,
    // Every case here is visible by construction, so the visibility projection
    // only attaches the input/expected/actual detail.
    results: applyStudentVisibility(
      execution.results,
      samples.map((testCase) => ({
        id: testCase.id,
        input: testCase.input,
        expectedOutput: testCase.expectedOutput,
        isHidden: testCase.isHidden,
      })),
    ),
    stdout: stripHarnessFraming(execution.stdout),
    stderr: execution.stderr,
    timedOut: execution.timedOut,
    memoryExceeded: execution.memoryExceeded,
    sampleCount: samples.length,
    hiddenCount,
  })
}

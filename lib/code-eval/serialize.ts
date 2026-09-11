import type { TestCase, TestRun } from "@/lib/generated/prisma/client"
import {
  testResultSchema,
  testRunStatusSchema,
  codeLanguageSchema,
  type CodeLanguage,
  type TestCaseResponse,
  type TestResult,
  type TestRunResponse,
  type CodeTaskResponse,
} from "@/lib/contracts/code-eval"

import { categoryLabel, normalizeCategory } from "./results"

/**
 * Response serializers.
 *
 * `TestRun.resultsJson` is the authoritative evidence record; the serializer
 * validates it rather than trusting the JSON column, and recomputes points from
 * the per-test results because `TestRun` has no points columns. A malformed or
 * absent evidence blob degrades to an empty result list, never to a fabricated
 * pass.
 */

export type RunEvidence = {
  results: TestResult[]
  timedOut: boolean
  memoryExceeded: boolean
  killMessage: string | null
}

export function readRunEvidence(resultsJson: unknown): RunEvidence {
  const empty: RunEvidence = {
    results: [],
    timedOut: false,
    memoryExceeded: false,
    killMessage: null,
  }
  if (!resultsJson || typeof resultsJson !== "object" || Array.isArray(resultsJson)) return empty
  const record = resultsJson as Record<string, unknown>
  const parsed = testResultSchema.array().safeParse(record.results)
  return {
    results: parsed.success ? parsed.data : [],
    timedOut: record.timedOut === true,
    memoryExceeded: record.memoryExceeded === true,
    killMessage: typeof record.killMessage === "string" ? record.killMessage : null,
  }
}

export function toRunEvidenceJson(evidence: RunEvidence): Record<string, unknown> {
  return {
    results: evidence.results,
    timedOut: evidence.timedOut,
    memoryExceeded: evidence.memoryExceeded,
    killMessage: evidence.killMessage,
  }
}

export function serializeTestCase(
  testCase: TestCase,
  draftIds: ReadonlySet<string>,
): TestCaseResponse {
  const category = normalizeCategory(testCase.category)
  return {
    id: testCase.id,
    codeTaskId: testCase.codeTaskId,
    order: testCase.order,
    name: testCase.name,
    description: testCase.description,
    category,
    categoryLabel: categoryLabel(category),
    input: testCase.input,
    expectedOutput: testCase.expectedOutput,
    points: Number(testCase.points),
    isHidden: testCase.isHidden,
    status: draftIds.has(testCase.id) ? "draft" : "active",
    createdAt: testCase.createdAt.toISOString(),
    updatedAt: testCase.updatedAt.toISOString(),
  }
}

export function serializeCodeTask(input: {
  id: string
  assessmentId: string
  assessmentTitle: string
  language: string
  instructions: string | null
  starterCode: string | null
  timeLimitMs: number
  memoryLimitMb: number
  maxSubmissions: number
  testCaseCount: number
  draftTestCaseCount: number
  createdAt: Date
  updatedAt: Date
}): CodeTaskResponse {
  const language: CodeLanguage = codeLanguageSchema.safeParse(input.language).success
    ? (input.language as CodeLanguage)
    : "python"
  return {
    id: input.id,
    assessmentId: input.assessmentId,
    assessmentTitle: input.assessmentTitle,
    language,
    instructions: input.instructions,
    starterCode: input.starterCode,
    timeLimitMs: input.timeLimitMs,
    memoryLimitMb: input.memoryLimitMb,
    maxSubmissions: input.maxSubmissions,
    testCaseCount: input.testCaseCount,
    draftTestCaseCount: input.draftTestCaseCount,
    createdAt: input.createdAt.toISOString(),
    updatedAt: input.updatedAt.toISOString(),
  }
}

export function serializeTestRun(
  run: TestRun,
  assessmentId: string,
  extras: { studentName?: string | null; studentRegisterNumber?: string | null } = {},
): TestRunResponse {
  const evidence = readRunEvidence(run.resultsJson)
  const earnedPoints = evidence.results.reduce((total, result) => total + result.earnedPoints, 0)
  const maxPoints = evidence.results.reduce((total, result) => total + result.points, 0)
  const status = testRunStatusSchema.safeParse(run.status).success ? run.status : "ERROR"

  return {
    id: run.id,
    codeTaskId: run.codeTaskId,
    assessmentId,
    studentId: run.studentId,
    studentName: extras.studentName ?? null,
    studentRegisterNumber: extras.studentRegisterNumber ?? null,
    language: codeLanguageSchema.safeParse(run.language).success
      ? (run.language as CodeLanguage)
      : "python",
    status,
    passedCount: run.passedCount,
    failedCount: run.failedCount,
    totalCount: run.totalCount,
    earnedPoints: Math.round(earnedPoints * 100) / 100,
    maxPoints: Math.round(maxPoints * 100) / 100,
    runtimeMs: run.runtimeMs,
    coverage: run.coverage,
    results: evidence.results,
    stdout: run.stdout,
    stderr: run.stderr,
    timedOut: evidence.timedOut,
    memoryExceeded: evidence.memoryExceeded,
    createdAt: run.createdAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
  }
}

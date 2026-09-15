import { MOCK_STUDENTS } from "./course"
import type { CodeTask, SimilarityRow, TestCase, TestRun, TestRunState } from "./types"

/**
 * Code evaluation: the sandboxed task, its test suite, recent runs, and the
 * similarity verdicts.
 *
 * Edge cases on purpose:
 *  - a run that ERRORED with real `stderr`, and one that TIMED OUT;
 *  - a run still QUEUED (so `finishedAt`, `coverage` and `runtimeMs` are null);
 *  - one test case that has never been run (`lastResult: null`);
 *  - a FLAGGED similarity pair, a CLEARED pair, and one still PENDING;
 *  - two runs by the demo student (an ERROR then a FAILED), so the student's
 *    own Runs panel has history and shows stderr without borrowing another
 *    student's rows.
 */

const SKELETON = `def sort_records(records):
    """Return records sorted by (score desc, name asc).

    records: list of dicts with "name" (str) and "score" (float)
    """
    # TODO: implement
    raise NotImplementedError`

export const MOCK_TEST_CASES: TestCase[] = [
  {
    id: "tc_1",
    order: 1,
    name: "sorts by score descending",
    description: "Basic ordering on a three-record list.",
    category: "unit",
    isHidden: false,
    points: 4,
    lastResult: "passed",
  },
  {
    id: "tc_2",
    order: 2,
    name: "breaks ties by name ascending",
    description: "Equal scores fall back to alphabetical order.",
    category: "unit",
    isHidden: false,
    points: 4,
    lastResult: "passed",
  },
  {
    id: "tc_3",
    order: 3,
    name: "handles an empty list",
    description: "Return an empty list rather than raising.",
    category: "edge",
    isHidden: false,
    points: 3,
    lastResult: "failed",
  },
  {
    id: "tc_4",
    order: 4,
    name: "preserves record identity",
    description: "Sorting must not mutate the input list.",
    category: "edge",
    isHidden: false,
    points: 4,
    lastResult: "failed",
  },
  {
    id: "tc_5",
    order: 5,
    name: "handles 10,000 records within 5s",
    description: "Performance guard — the naive O(n²) approach times out.",
    category: "performance",
    isHidden: true,
    points: 5,
    lastResult: "passed",
  },
  {
    id: "tc_6",
    order: 6,
    name: "rejects missing keys",
    description: "Raise ValueError when a record has no score.",
    category: "edge",
    isHidden: true,
    points: 5,
    // Never run: the harness stopped after the two failures on this submission.
    lastResult: null,
  },
]

type RunSeed = {
  studentId: string
  state: TestRunState
  passed: number
  failed: number
  coverage: number | null
  runtimeMs: number | null
  finishedAt: string | null
  stderr: string | null
}

const RUN_SEEDS: RunSeed[] = [
  {
    studentId: MOCK_STUDENTS[2].id,
    state: "PASSED",
    passed: 6,
    failed: 0,
    coverage: 0.96,
    runtimeMs: 812,
    finishedAt: "2026-09-14T10:42:00.000Z",
    stderr: null,
  },
  {
    studentId: MOCK_STUDENTS[3].id,
    state: "PASSED",
    passed: 6,
    failed: 0,
    coverage: 0.91,
    runtimeMs: 934,
    finishedAt: "2026-09-14T11:05:00.000Z",
    stderr: null,
  },
  {
    studentId: MOCK_STUDENTS[1].id,
    state: "FAILED",
    passed: 4,
    failed: 2,
    coverage: 0.78,
    runtimeMs: 1_020,
    finishedAt: "2026-09-14T12:15:00.000Z",
    stderr: null,
  },
  {
    studentId: MOCK_STUDENTS[6].id,
    state: "FAILED",
    passed: 5,
    failed: 1,
    coverage: 0.83,
    runtimeMs: 990,
    finishedAt: "2026-09-14T13:40:00.000Z",
    stderr: null,
  },
  {
    studentId: MOCK_STUDENTS[5].id,
    state: "TIMEOUT",
    passed: 2,
    failed: 0,
    coverage: null,
    runtimeMs: null,
    finishedAt: "2026-09-14T14:10:00.000Z",
    stderr: "Test 5 exceeded the 5000ms limit (O(n²) insertion sort detected).",
  },
  {
    studentId: MOCK_STUDENTS[7].id,
    state: "ERROR",
    passed: 0,
    failed: 0,
    coverage: null,
    runtimeMs: 210,
    finishedAt: "2026-09-14T15:02:00.000Z",
    stderr: 'NameError: name "sorted_records" is not defined\n  at line 12 of submission.py',
  },
  {
    studentId: MOCK_STUDENTS[8].id,
    state: "PASSED",
    passed: 4,
    failed: 0,
    coverage: 0.62,
    runtimeMs: 1_440,
    finishedAt: "2026-09-14T16:20:00.000Z",
    stderr: null,
  },
  {
    studentId: MOCK_STUDENTS[9].id,
    state: "RUNNING",
    passed: 3,
    failed: 0,
    coverage: null,
    runtimeMs: null,
    finishedAt: null,
    stderr: null,
  },
  {
    studentId: MOCK_STUDENTS[10].id,
    state: "QUEUED",
    passed: 0,
    failed: 0,
    coverage: null,
    runtimeMs: null,
    finishedAt: null,
    stderr: null,
  },
  // The demo student's own two attempts: a crash they then fixed the syntax of,
  // leaving the two logic failures in MOCK_TEST_CASES (tc_3, tc_4) still red.
  // Without these rows the student's own Runs panel would be empty.
  {
    studentId: "stu_aarav",
    state: "ERROR",
    passed: 0,
    failed: 0,
    coverage: null,
    runtimeMs: 180,
    finishedAt: "2026-09-14T20:05:00.000Z",
    stderr:
      'TypeError: sort_records() got an unexpected keyword argument "key"\n  at line 12 of submission.py',
  },
  {
    studentId: "stu_aarav",
    state: "FAILED",
    passed: 4,
    failed: 2,
    coverage: 0.74,
    runtimeMs: 1_060,
    finishedAt: "2026-09-15T09:40:00.000Z",
    stderr: null,
  },
]

export const MOCK_TEST_RUNS: TestRun[] = RUN_SEEDS.map((seed, index) => {
  const student = MOCK_STUDENTS.find((entry) => entry.id === seed.studentId)
  return {
    id: `run_${String(index + 1).padStart(2, "0")}`,
    studentId: seed.studentId,
    studentName: student?.name ?? seed.studentId,
    state: seed.state,
    passedCount: seed.passed,
    failedCount: seed.failed,
    totalCount: MOCK_TEST_CASES.length,
    coverage: seed.coverage,
    runtimeMs: seed.runtimeMs,
    finishedAt: seed.finishedAt,
    stderr: seed.stderr,
  }
})

export const MOCK_SIMILARITY: SimilarityRow[] = [
  {
    id: "sim_01",
    studentName: "Ethan Brooks",
    comparedStudentName: "Chen Wei",
    similarity: 0.91,
    verdict: "flagged",
  },
  {
    id: "sim_02",
    studentName: "Isaiah Thompson",
    comparedStudentName: "Mateo Fernández",
    similarity: 0.22,
    verdict: "active",
  },
  {
    id: "sim_03",
    studentName: "Diya Nair",
    comparedStudentName: "Priya Krishnan",
    similarity: 0.58,
    verdict: "pending",
  },
]

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 100)
}

const finishedRuns = MOCK_TEST_RUNS.filter((run) => run.finishedAt !== null)

export const MOCK_CODE_TASK: CodeTask = {
  id: "ct_sorting",
  assessmentId: "asm_code",
  title: "Code Task — Sorting & Big-O",
  language: "python",
  instructions:
    "Implement sort_records() to order student records by score (descending), breaking ties by name (ascending). Your solution must not mutate the input and must stay under 5 seconds for 10,000 records.",
  timeLimitMs: 5000,
  memoryLimitMb: 256,
  testCases: MOCK_TEST_CASES,
  runs: MOCK_TEST_RUNS,
  avgPassRate: mean(
    finishedRuns.map((run) =>
      run.totalCount === 0 ? 0 : (run.passedCount / run.totalCount) * 100,
    ),
  ),
  avgCoverage: mean(
    finishedRuns
      .map((run) => run.coverage)
      .filter((coverage): coverage is number => coverage !== null)
      .map((coverage) => coverage * 100),
  ),
  similarity: MOCK_SIMILARITY,
}

export const MOCK_CODE_TASK_SKELETON = SKELETON

/** Runs still in flight — the queue panel shows these before finished runs. */
export const MOCK_ACTIVE_RUNS = MOCK_TEST_RUNS.filter(
  (run) => run.state === "QUEUED" || run.state === "RUNNING",
)

export const MOCK_FAILED_RUNS = MOCK_TEST_RUNS.filter(
  (run) => run.state === "FAILED" || run.state === "ERROR" || run.state === "TIMEOUT",
)

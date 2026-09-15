import type { Metadata } from "next"
import { Activity, Gauge, ShieldAlert, Terminal } from "lucide-react"

import { findNavItem } from "@/components/shell/nav-config"
import { PageHeader } from "@/components/shell/page-header"
import { Button } from "@/components/ui/button"
import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { KeyValueList } from "@/components/ui/metric-row"
import { PageTabPanel, PageTabs } from "@/components/ui/page-tabs"
import { SectionCard } from "@/components/ui/section-card"
import { StatCard } from "@/components/ui/stat-card"
import { StatusPill } from "@/components/ui/status-pill"
import {
  MOCK_ACTIVE_RUNS,
  MOCK_ASSESSMENT_BY_ID,
  MOCK_CODE_TASK,
  MOCK_CODE_TASK_SKELETON,
  MOCK_FAILED_RUNS,
  MOCK_SIMILARITY,
  MOCK_TEST_CASES,
  MOCK_TEST_RUNS,
  formatConfidence,
  formatDateTime,
  formatDueLabel,
  formatDuration,
  formatPercent,
  trimNumber,
  type SimilarityRow,
  type TestCase,
  type TestRun,
} from "@/lib/mock"

import { TEST_RUN_STATE_TO_STATUS } from "../_lib/labels"

export const metadata: Metadata = {
  title: "Code tasks",
}

const HREF = "/mockup/teacher/code-tasks"

const ASSESSMENT = MOCK_ASSESSMENT_BY_ID["asm_code"]
const FLAGGED_PAIRS = MOCK_SIMILARITY.filter((row) => row.verdict === "flagged").length
const HIDDEN_CASES = MOCK_TEST_CASES.filter((testCase) => testCase.isHidden).length

/**
 * Code tasks — the sandboxed test harness.
 *
 * Three failure modes are on screen deliberately: a run that errored with real
 * stderr, a run that hit the time limit, and a run that is still queued (so it
 * has no finish time, coverage or runtime at all).
 */
export default function TeacherCodeTasksPage() {
  const runColumns: Column<TestRun>[] = [
    {
      id: "student",
      header: "Student",
      cell: (row) => (
        <span className="max-w-[16rem] truncate font-medium" title={row.studentName}>
          {row.studentName}
        </span>
      ),
    },
    {
      id: "state",
      header: "Run state",
      cell: (row) => <StatusPill status={TEST_RUN_STATE_TO_STATUS[row.state]} dot />,
    },
    {
      id: "tests",
      header: "Tests",
      align: "right",
      cell: (row) => (
        <span className="font-mono tabular-nums">
          {row.passedCount} passed · {row.failedCount} failed · {row.totalCount} total
        </span>
      ),
    },
    {
      id: "coverage",
      header: "Coverage",
      align: "right",
      hideBelow: "sm",
      cell: (row) =>
        row.coverage === null ? (
          <span className="font-mono text-muted-foreground tabular-nums">
            —<span className="sr-only"> not measured</span>
          </span>
        ) : (
          <span className="font-mono tabular-nums">{formatPercent(row.coverage * 100)}</span>
        ),
    },
    {
      id: "runtime",
      header: "Runtime",
      align: "right",
      hideBelow: "md",
      cell: (row) => (
        <span className="font-mono tabular-nums">{formatDuration(row.runtimeMs)}</span>
      ),
    },
    {
      id: "finished",
      header: "Finished",
      hideBelow: "lg",
      cell: (row) =>
        row.finishedAt === null ? (
          <span className="text-muted-foreground">Not finished yet</span>
        ) : (
          <span className="text-muted-foreground">{formatDateTime(row.finishedAt)}</span>
        ),
    },
    {
      id: "diagnostics",
      header: "Diagnostics",
      hideBelow: "lg",
      cell: (row) =>
        row.stderr === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <StatusPill status={TEST_RUN_STATE_TO_STATUS[row.state]} label="Captured stderr" />
        ),
    },
  ]

  const caseColumns: Column<TestCase>[] = [
    {
      id: "case",
      header: "Test case",
      cell: (row) => (
        <div className="min-w-0">
          <p className="font-medium">
            {row.order}. {row.name}
          </p>
          <p
            className="max-w-[24rem] truncate text-xs text-muted-foreground"
            title={row.description}
          >
            {row.description}
          </p>
        </div>
      ),
    },
    { id: "category", header: "Category", cell: (row) => row.category },
    {
      id: "visibility",
      header: "Visibility",
      cell: (row) =>
        row.isHidden ? (
          <StatusPill status="draft" label="Hidden from students" dot />
        ) : (
          <StatusPill status="published" label="Visible" dot />
        ),
    },
    {
      id: "points",
      header: "Points",
      align: "right",
      cell: (row) => <span className="font-mono tabular-nums">{row.points}</span>,
    },
    {
      id: "result",
      header: "Last result",
      cell: (row) =>
        row.lastResult === null ? (
          <StatusPill status="queued" label="Not run" dot />
        ) : (
          <StatusPill status={row.lastResult} dot />
        ),
    },
  ]

  const similarityColumns: Column<SimilarityRow>[] = [
    {
      id: "pair",
      header: "Submission pair",
      cell: (row) => (
        <span className="whitespace-normal">
          {row.studentName} ↔ {row.comparedStudentName}
        </span>
      ),
    },
    {
      id: "score",
      header: "Similarity",
      align: "right",
      cell: (row) => (
        <span className="font-mono tabular-nums">{formatConfidence(row.similarity)}</span>
      ),
    },
    {
      id: "verdict",
      header: "Verdict",
      cell: (row) => <StatusPill status={row.verdict} dot />,
    },
  ]

  return (
    <>
      <PageHeader
        eyebrow={ASSESSMENT?.title ?? MOCK_CODE_TASK.title}
        title="Code tasks"
        description={findNavItem(HREF)?.item.description}
        breadcrumbs={[
          { label: "Mockup index", href: "/mockup" },
          { label: "Teacher workspace", href: "/mockup/teacher" },
          { label: "Code tasks" },
        ]}
        actions={<Button variant="outline">Re-run all submissions</Button>}
      />

      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Average pass rate"
            value={formatPercent(MOCK_CODE_TASK.avgPassRate)}
            hint={`Across ${MOCK_TEST_RUNS.filter((run) => run.finishedAt !== null).length} finished runs`}
            icon={Terminal}
          />
          <StatCard
            label="Average coverage"
            value={formatPercent(MOCK_CODE_TASK.avgCoverage)}
            hint="Lines executed by the suite"
            icon={Gauge}
          />
          <StatCard
            label="Active runs"
            value={String(MOCK_ACTIVE_RUNS.length)}
            hint={MOCK_ACTIVE_RUNS.map((run) => run.studentName).join(", ")}
            icon={Activity}
          />
          <StatCard
            label="Similarity flags"
            value={String(FLAGGED_PAIRS)}
            hint={`${MOCK_SIMILARITY.length} pairs compared`}
            icon={ShieldAlert}
          />
        </div>

        <PageTabs
          className="[&_[data-slot=tabs-list]]:overflow-x-auto"
          items={[
            { value: "runs", label: "Runs", count: MOCK_TEST_RUNS.length },
            { value: "cases", label: "Test cases", count: MOCK_TEST_CASES.length },
            { value: "similarity", label: "Similarity", count: MOCK_SIMILARITY.length },
            { value: "setup", label: "Task setup" },
          ]}
          label="Code task sections"
        >
          <PageTabPanel value="runs" className="space-y-6">
            <SectionCard
              title="Runs"
              description="Every execution of the test suite. A queued or running attempt has no finish time, coverage or runtime yet — the state is shown instead of a blank date."
            >
              <DataTable
                caption="Test runs"
                columns={runColumns}
                rows={MOCK_TEST_RUNS}
                getRowId={(row) => row.id}
                empty={
                  <EmptyState
                    icon={Terminal}
                    title="No runs yet"
                    description="Runs appear here as students submit their code."
                  />
                }
              />
            </SectionCard>

            <SectionCard
              title="Run diagnostics"
              description={`${MOCK_FAILED_RUNS.length} runs failed, errored or timed out. The captured stderr is the actionable part.`}
            >
              {MOCK_FAILED_RUNS.length === 0 ? (
                <EmptyState
                  title="No failing runs"
                  description="Every submitted run passed its test suite."
                />
              ) : (
                <div className="space-y-3">
                  {MOCK_FAILED_RUNS.map((run) => (
                    <details key={run.id} className="rounded-lg border border-border p-3">
                      <summary className="cursor-pointer text-sm font-medium">
                        {run.studentName} · {run.passedCount}/{run.totalCount} passed ·{" "}
                        {TEST_RUN_LABEL[run.state]}
                      </summary>
                      <div className="mt-3 space-y-2">
                        <p className="text-xs text-muted-foreground">
                          {formatDateTime(run.finishedAt)} · {formatDuration(run.runtimeMs)} ·
                          coverage{" "}
                          {run.coverage === null
                            ? "not measured"
                            : formatPercent(run.coverage * 100)}
                        </p>
                        <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap text-foreground">
                          {run.stderr ?? "No stderr captured."}
                        </pre>
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </SectionCard>
          </PageTabPanel>

          <PageTabPanel value="cases">
            <SectionCard
              title="Test cases"
              description={`${HIDDEN_CASES} of ${MOCK_TEST_CASES.length} cases are hidden. A hidden case never reveals its expected output to a student — only whether it passed.`}
            >
              <DataTable
                caption="Test cases"
                columns={caseColumns}
                rows={MOCK_TEST_CASES}
                getRowId={(row) => row.id}
                empty={
                  <EmptyState
                    title="No test cases"
                    description="Add a case before students can submit this task."
                  />
                }
              />
            </SectionCard>
          </PageTabPanel>

          <PageTabPanel value="similarity">
            <SectionCard
              title="Similarity"
              description="Cross-submission comparison. A flag is a prompt to look, not a finding — a teacher records the verdict."
            >
              <DataTable
                caption="Similarity checks"
                columns={similarityColumns}
                rows={MOCK_SIMILARITY}
                getRowId={(row) => row.id}
                rowActions={(row) => (
                  <Button
                    variant="outline"
                    size="xs"
                    aria-label={`Record a verdict for ${row.studentName} and ${row.comparedStudentName}`}
                  >
                    Record verdict
                  </Button>
                )}
                empty={
                  <EmptyState
                    title="No comparisons yet"
                    description="Similarity is computed once two submissions share a task."
                  />
                }
              />
            </SectionCard>
          </PageTabPanel>

          <PageTabPanel value="setup" className="space-y-6">
            <SectionCard title="Task" description={MOCK_CODE_TASK.instructions}>
              <KeyValueList
                items={[
                  {
                    id: "assessment",
                    label: "Assessment",
                    value: ASSESSMENT?.title ?? MOCK_CODE_TASK.title,
                    hint: ASSESSMENT
                      ? `${formatDueLabel(ASSESSMENT.dueAt)} · weighting ${ASSESSMENT.weightPercent}% of the final grade`
                      : undefined,
                  },
                  {
                    id: "language",
                    label: "Language",
                    value: <span className="font-mono text-xs">{MOCK_CODE_TASK.language}</span>,
                  },
                  {
                    id: "time",
                    label: "Time limit",
                    value: formatDuration(MOCK_CODE_TASK.timeLimitMs),
                    hint: "Per run, across the whole test suite",
                  },
                  {
                    id: "memory",
                    label: "Memory limit",
                    value: `${MOCK_CODE_TASK.memoryLimitMb} MB`,
                  },
                  {
                    id: "points",
                    label: "Test points",
                    value: `${trimNumber(
                      MOCK_TEST_CASES.reduce((total, testCase) => total + testCase.points, 0),
                    )} of ${ASSESSMENT?.maxPoints ?? 0} pts`,
                    hint: "The remainder is awarded on the rubric's readability criteria",
                  },
                ]}
              />
            </SectionCard>

            <SectionCard
              title="Starter code"
              description="What every student begins with. Submissions are run in the sandbox above, never on the reviewer's machine."
            >
              <pre className="overflow-x-auto rounded-lg bg-muted p-4 font-mono text-xs whitespace-pre text-foreground">
                {MOCK_CODE_TASK_SKELETON}
              </pre>
            </SectionCard>
          </PageTabPanel>
        </PageTabs>
      </div>
    </>
  )
}

const TEST_RUN_LABEL: Record<TestRun["state"], string> = {
  QUEUED: "Queued",
  RUNNING: "Running",
  PASSED: "Passed",
  FAILED: "Failed",
  ERROR: "Error",
  TIMEOUT: "Timed out",
}

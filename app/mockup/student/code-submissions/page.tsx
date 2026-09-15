import type { Metadata } from "next"
import { CircleCheck, Percent, PlayCircle, Timer, type LucideIcon } from "lucide-react"

import { PageHeader } from "@/components/shell/page-header"
import { Button } from "@/components/ui/button"
import { CodeBlock } from "@/components/ui/code-block"
import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { KeyValueList, MetricRow } from "@/components/ui/metric-row"
import { PageTabPanel, PageTabs } from "@/components/ui/page-tabs"
import { ProgressBar } from "@/components/ui/progress-bar"
import { SectionCard } from "@/components/ui/section-card"
import { StatCard } from "@/components/ui/stat-card"
import { StatusPill, type StatusKey } from "@/components/ui/status-pill"
import {
  MOCK_ASSESSMENT_BY_ID,
  MOCK_CODE_TASK,
  MOCK_CODE_TASK_SKELETON,
  MOCK_DEMO_STUDENT,
  MOCK_TEST_CASES,
  MOCK_TEST_RUNS,
  formatDate,
  formatDateTime,
  formatDueLabel,
  formatDuration,
  formatPercent,
  type TestCase,
  type TestRun,
  type TestRunState,
} from "@/lib/mock"

export const metadata: Metadata = {
  title: "Code submissions",
}

const RUN_STATUS: Record<TestRunState, StatusKey> = {
  QUEUED: "queued",
  RUNNING: "running",
  PASSED: "passed",
  FAILED: "failed",
  ERROR: "error",
  TIMEOUT: "timeout",
}

const KPI_ICONS: Record<string, LucideIcon> = {
  passed: CircleCheck,
  coverage: Percent,
  runs: PlayCircle,
  limit: Timer,
}

const testCaseColumns: Column<TestCase>[] = [
  {
    id: "case",
    header: "Test case",
    cell: (row) => (
      <div className="min-w-0">
        <p className="font-medium">{row.name}</p>
        <p className="text-xs text-muted-foreground">
          {row.isHidden
            ? "Hidden case — its expected output is never shown to you."
            : row.description}
        </p>
      </div>
    ),
  },
  {
    id: "category",
    header: "Category",
    hideBelow: "sm",
    cell: (row) => <span className="text-xs text-muted-foreground">{row.category}</span>,
  },
  {
    id: "visibility",
    header: "Visibility",
    cell: (row) => (
      <StatusPill
        status={row.isHidden ? "archived" : "published"}
        label={row.isHidden ? "Hidden" : "Visible"}
        dot
      />
    ),
  },
  {
    id: "points",
    header: "Points",
    align: "right",
    hideBelow: "sm",
    cell: (row) => <span className="font-mono tabular-nums">{row.points}</span>,
  },
  {
    id: "result",
    header: "Last result",
    cell: (row) =>
      // `null` means the case has not been run — a state, not a score of zero.
      row.lastResult === null ? (
        <StatusPill status="queued" label="Not run" dot />
      ) : (
        <StatusPill status={row.lastResult} dot />
      ),
  },
]

const runColumns: Column<TestRun>[] = [
  {
    id: "run",
    header: "Run",
    cell: (row) => <span className="font-mono text-xs">{row.id}</span>,
  },
  {
    id: "state",
    header: "State",
    cell: (row) => <StatusPill status={RUN_STATUS[row.state]} dot />,
  },
  {
    id: "tests",
    header: "Tests",
    cell: (row) => (
      <span className="font-mono tabular-nums">
        {row.passedCount} passed · {row.failedCount} failed
      </span>
    ),
  },
  {
    id: "coverage",
    header: "Coverage",
    align: "right",
    hideBelow: "sm",
    cell: (row) => (
      <span className="font-mono tabular-nums">
        {formatPercent(row.coverage === null ? null : row.coverage * 100)}
      </span>
    ),
  },
  {
    id: "runtime",
    header: "Runtime",
    align: "right",
    hideBelow: "md",
    cell: (row) => <span className="font-mono tabular-nums">{formatDuration(row.runtimeMs)}</span>,
  },
  {
    id: "finished",
    header: "Finished",
    hideBelow: "lg",
    cell: (row) =>
      row.finishedAt === null ? (
        // Queued/running runs have no timestamps: say so instead of showing a blank date.
        <span className="text-muted-foreground">
          {row.state === "QUEUED" ? "Waiting in the queue" : "Still running"}
        </span>
      ) : (
        <span className="font-mono text-xs tabular-nums">{formatDateTime(row.finishedAt)}</span>
      ),
  },
  {
    id: "output",
    header: "Output",
    className: "max-w-80 whitespace-normal",
    cell: (row) =>
      row.stderr === null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <details className="text-xs">
          <summary className="cursor-pointer rounded-sm text-primary focus-visible:ring-3 focus-visible:ring-ring/50">
            Show error output
            <span className="sr-only"> for run {row.id}</span>
          </summary>
          <CodeBlock wrap maxHeight="sm" dense className="mt-2">
            {row.stderr}
          </CodeBlock>
        </details>
      ),
  },
]

export default function StudentCodeSubmissionsPage() {
  const assessment = MOCK_ASSESSMENT_BY_ID[MOCK_CODE_TASK.assessmentId]
  const myRuns = MOCK_TEST_RUNS.filter((run) => run.studentId === MOCK_DEMO_STUDENT.id).sort(
    (left, right) => (right.finishedAt ?? "").localeCompare(left.finishedAt ?? ""),
  )
  const latestRun = myRuns.find((run) => run.finishedAt !== null)
  const latestCoverage = latestRun?.coverage ?? null

  const passedCases = MOCK_TEST_CASES.filter((testCase) => testCase.lastResult === "passed").length
  const failedCases = MOCK_TEST_CASES.filter((testCase) => testCase.lastResult === "failed").length
  const bestScore = Math.max(
    0,
    ...myRuns.map((run) =>
      run.totalCount === 0
        ? 0
        : Math.round((run.passedCount / run.totalCount) * assessment.maxPoints),
    ),
  )

  const kpis = [
    {
      id: "passed",
      label: "Tests passed",
      value: latestRun === undefined ? "—" : `${latestRun.passedCount} / ${latestRun.totalCount}`,
      hint:
        latestRun === undefined
          ? "No finished run yet"
          : `Latest finished run · ${failedCases} case${failedCases === 1 ? "" : "s"} failing`,
    },
    {
      id: "coverage",
      label: "Coverage",
      value: formatPercent(latestCoverage === null ? null : latestCoverage * 100),
      hint: "Line coverage from your last run",
    },
    {
      id: "runs",
      label: "Runs used",
      value: String(myRuns.length),
      hint: "Your own runs · draft not submitted",
    },
    {
      id: "limit",
      label: "Time limit",
      value: formatDuration(MOCK_CODE_TASK.timeLimitMs),
      hint: `${MOCK_CODE_TASK.memoryLimitMb} MB memory per run`,
    },
  ]

  const tabs = [
    { value: "task", label: "Task" },
    { value: "cases", label: "Test cases", count: MOCK_TEST_CASES.length },
    { value: "runs", label: "Runs", count: myRuns.length },
  ]

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Mockup index", href: "/mockup" },
          { label: "Student workspace", href: "/mockup/student" },
          { label: "Code submissions" },
        ]}
        eyebrow={MOCK_CODE_TASK.title}
        title="Code submissions"
        description="Submit code, see test results, and read the reviewer feedback."
        actions={<Button type="button">Submit solution</Button>}
      />

      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map((kpi) => (
            <StatCard
              key={kpi.id}
              label={kpi.label}
              value={kpi.value}
              hint={kpi.hint}
              icon={KPI_ICONS[kpi.id]}
            />
          ))}
        </div>

        <PageTabs items={tabs} label="Code task sections">
          <PageTabPanel value="task">
            <SectionCard title="Task brief" description={MOCK_CODE_TASK.instructions}>
              <div className="space-y-4">
                <KeyValueList
                  items={[
                    { label: "Assessment", value: assessment.title },
                    {
                      label: "Language",
                      value: <span className="font-mono">{MOCK_CODE_TASK.language}</span>,
                    },
                    {
                      label: "Due",
                      value: (
                        <span className="font-mono tabular-nums">
                          {formatDate(assessment.dueAt)}
                        </span>
                      ),
                      hint: formatDueLabel(assessment.dueAt),
                    },
                    {
                      label: "Marks",
                      value: (
                        <span className="font-mono tabular-nums">
                          {assessment.maxPoints} points
                        </span>
                      ),
                      hint: `Weighted ${assessment.weightPercent}% of the final grade`,
                    },
                    {
                      label: "Limits",
                      value: (
                        <span className="font-mono tabular-nums">
                          {formatDuration(MOCK_CODE_TASK.timeLimitMs)} ·{" "}
                          {MOCK_CODE_TASK.memoryLimitMb} MB
                        </span>
                      ),
                    },
                    {
                      label: "Submission state",
                      value: <StatusPill status="in-progress" label="Draft saved, not submitted" />,
                    },
                  ]}
                />

                <div className="space-y-2">
                  <h3 className="text-sm font-medium">Starter code</h3>
                  <p className="text-sm text-muted-foreground">
                    Replace the TODO. Sorting must not mutate the input list, and it has to stay
                    inside the time limit on the performance case.
                  </p>
                  <CodeBlock>{MOCK_CODE_TASK_SKELETON}</CodeBlock>
                </div>

                <div className="space-y-0.5">
                  <MetricRow
                    label="Visible cases"
                    value={
                      <span className="font-mono tabular-nums">
                        {MOCK_TEST_CASES.filter((testCase) => !testCase.isHidden).length}
                      </span>
                    }
                    hint="You can run these as often as you like"
                  />
                  <MetricRow
                    label="Hidden cases"
                    value={
                      <span className="font-mono tabular-nums">
                        {MOCK_TEST_CASES.filter((testCase) => testCase.isHidden).length}
                      </span>
                    }
                    hint="Their expected output is never shown before the deadline"
                  />
                  <MetricRow
                    label="Last finished run"
                    value={
                      latestRun === undefined ? (
                        "—"
                      ) : (
                        <StatusPill status={RUN_STATUS[latestRun.state]} dot />
                      )
                    }
                    hint={
                      latestRun?.finishedAt == null
                        ? "No finished run yet"
                        : formatDateTime(latestRun.finishedAt)
                    }
                  />
                </div>
              </div>
            </SectionCard>
          </PageTabPanel>

          <PageTabPanel value="cases">
            <SectionCard
              title="Test cases"
              description="A hidden case reports only a result — never its expected output, input or assertion. Nothing here marks your work; the graded run does that after you submit."
            >
              <div className="space-y-4">
                <ProgressBar
                  value={passedCases}
                  max={MOCK_TEST_CASES.length}
                  label="Cases passing in the last run"
                  valueText={`${passedCases} / ${MOCK_TEST_CASES.length}`}
                  tone={failedCases === 0 ? "success" : "warning"}
                />
                <DataTable
                  caption="Test cases for the code task"
                  columns={testCaseColumns}
                  rows={MOCK_TEST_CASES}
                  getRowId={(row) => row.id}
                  empty={
                    <EmptyState
                      size="sm"
                      title="No test cases"
                      description="This task has no test suite attached yet."
                    />
                  }
                />
              </div>
            </SectionCard>
          </PageTabPanel>

          <PageTabPanel value="runs">
            <SectionCard
              title="Your runs"
              description="Every run you have started, newest first. A queued or running run has no timestamps yet, so its state is shown instead of a blank date."
            >
              {myRuns.length === 0 ? (
                <EmptyState
                  title="You have not run your code yet"
                  description="Run the visible test cases to see results here."
                />
              ) : (
                <div className="space-y-4">
                  <DataTable
                    caption="Your sandboxed test runs"
                    columns={runColumns}
                    rows={myRuns}
                    getRowId={(row) => row.id}
                    empty={
                      <EmptyState size="sm" title="No runs" description="Nothing has run yet." />
                    }
                  />
                  <MetricRow
                    label="Score from your best run"
                    value={
                      <span className="font-mono tabular-nums">
                        {bestScore} / {assessment.maxPoints}
                      </span>
                    }
                    hint="Only your best run counts towards the mark"
                  />
                </div>
              )}
            </SectionCard>
          </PageTabPanel>
        </PageTabs>
      </div>
    </>
  )
}

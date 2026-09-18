import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { PlayCircle, Terminal } from "lucide-react"

import { type AssessmentPickerOption } from "@/components/assessment-picker"
import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import { StudentCodeSubmissionEditor } from "@/components/student-code-submissions"
import { CodeBlock } from "@/components/ui/code-block"
import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { MetricRow } from "@/components/ui/metric-row"
import { ProgressBar } from "@/components/ui/progress-bar"
import { SectionCard } from "@/components/ui/section-card"
import { StatusPill } from "@/components/ui/status-pill"
import { getSessionUser } from "@/lib/auth"
import {
  failureReason,
  listStudentCodeTasks,
  listStudentRuns,
  measuredRuntimeMs,
} from "@/lib/code-eval"
import type { TestResult, TestRunResponse } from "@/lib/contracts/code-eval"
import { TEST_RUN_STATE_TO_STATUS } from "@/lib/labels"
import { formatDateTime, formatDuration, formatPercent, trimNumber } from "@/lib/format"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Code submissions" }

/**
 * Per-test rows come from one of the student's **own** runs, never from a shared
 * test-case fixture. A visible case carries its input/expected/actual detail
 * (the Run panel renders it); a hidden case reaches the client with those
 * fields already nulled by the server and only pass/fail remains.
 */
const resultColumns: Column<TestResult>[] = [
  {
    id: "case",
    header: "Test case",
    cell: (result) => (
      <div className="min-w-0">
        <p className="font-medium">{result.name}</p>
        {result.description && (
          <p className="max-w-[28rem] truncate text-xs text-muted-foreground">
            {result.description}
          </p>
        )}
        {(() => {
          // The failure cause is not the case description: a killed run's reason ("Sandbox
          // unavailable…", "Not executed…") is what a student needs, and showing the
          // description instead hid it on every case that had one (SN-33).
          const reason = failureReason(result)
          return reason ? <p className="max-w-[28rem] text-xs text-destructive">{reason}</p> : null
        })()}
      </div>
    ),
  },
  {
    id: "category",
    header: "Category",
    hideBelow: "sm",
    cell: (result) => <span className="text-xs text-muted-foreground">{result.category}</span>,
  },
  {
    id: "result",
    header: "Result",
    cell: (result) => <StatusPill status={result.passed ? "passed" : "failed"} dot />,
  },
  {
    id: "points",
    header: "Points",
    align: "right",
    hideBelow: "sm",
    cell: (result) => (
      <span className="font-mono tabular-nums">
        {trimNumber(result.earnedPoints)} / {trimNumber(result.points)}
      </span>
    ),
  },
  {
    id: "duration",
    header: "Duration",
    align: "right",
    hideBelow: "md",
    cell: (result) => (
      <span className="font-mono tabular-nums">{formatDuration(result.durationMs)}</span>
    ),
  },
  {
    id: "output",
    header: "Captured output",
    hideBelow: "lg",
    cell: (result) =>
      result.stdout || result.stderr ? (
        <details className="text-xs">
          <summary className="cursor-pointer rounded-sm text-primary focus-visible:ring-3 focus-visible:ring-ring/50">
            Show output
            <span className="sr-only"> for {result.name}</span>
          </summary>
          {result.stdout && (
            <CodeBlock wrap maxHeight="sm" dense className="mt-2">
              {result.stdout}
            </CodeBlock>
          )}
          {result.stderr && (
            <CodeBlock wrap maxHeight="sm" dense className="mt-2">
              {result.stderr}
            </CodeBlock>
          )}
        </details>
      ) : (
        // A hidden case's captured streams are nulled server-side, so it renders
        // an em dash rather than a disclosure that would reveal nothing.
        <span className="text-muted-foreground">—</span>
      ),
  },
]

const runColumns: Column<TestRunResponse>[] = [
  {
    id: "run",
    header: "Run",
    cell: (run) => <span className="font-mono text-xs">{run.id}</span>,
  },
  {
    id: "state",
    header: "State",
    cell: (run) => <StatusPill status={TEST_RUN_STATE_TO_STATUS[run.status]} dot />,
  },
  {
    id: "tests",
    header: "Tests",
    align: "right",
    cell: (run) => (
      <span className="font-mono tabular-nums">
        {run.passedCount} passed · {run.failedCount} failed
      </span>
    ),
  },
  {
    id: "coverage",
    header: "Coverage",
    align: "right",
    hideBelow: "sm",
    cell: (run) =>
      run.coverage === null ? (
        // A run the harness did not measure has no coverage. Not zero.
        <span className="font-mono tabular-nums text-muted-foreground">
          —<span className="sr-only"> not measured</span>
        </span>
      ) : (
        <span className="font-mono tabular-nums">{formatPercent(run.coverage * 100)}</span>
      ),
  },
  {
    id: "runtime",
    header: "Runtime",
    align: "right",
    hideBelow: "md",
    cell: (run) => {
      // `0ms` is not a measurement (SN-34); the rule is shared with the teacher table.
      const measured = measuredRuntimeMs(run)
      return measured === null ? (
        <span className="font-mono tabular-nums text-muted-foreground">
          —<span className="sr-only"> not measured</span>
        </span>
      ) : (
        <span className="font-mono tabular-nums">{formatDuration(measured)}</span>
      )
    },
  },
  {
    id: "points",
    header: "Points",
    align: "right",
    hideBelow: "md",
    cell: (run) =>
      // `earnedPoints`/`maxPoints` are recomputed from the run's evidence; with
      // no readable evidence there is no score, and "0 / 0" would invent one.
      run.maxPoints === 0 ? (
        <span className="font-mono tabular-nums text-muted-foreground">
          —<span className="sr-only"> no per-test evidence recorded</span>
        </span>
      ) : (
        <span className="font-mono tabular-nums">
          {trimNumber(run.earnedPoints)} / {trimNumber(run.maxPoints)}
        </span>
      ),
  },
  {
    id: "finished",
    header: "Finished",
    hideBelow: "lg",
    cell: (run) =>
      run.finishedAt === null ? (
        // Queued and running runs have no finish time: say which state instead
        // of showing a blank date.
        <span className="text-muted-foreground">
          {run.status === "QUEUED"
            ? "Waiting in the queue"
            : run.status === "RUNNING"
              ? "Still running"
              : "Not finished"}
        </span>
      ) : (
        <span className="font-mono text-xs tabular-nums">{formatDateTime(run.finishedAt)}</span>
      ),
  },
]

/**
 * Per-test outcomes from the student's own latest run that recorded evidence.
 * Rendered on the server and handed to the editor's bottom panel as a ReactNode,
 * so the table and its columns never enter the client bundle.
 */
function TestResultPanel({ run }: { run: TestRunResponse | null }) {
  if (run === null || run.results.length === 0) {
    return (
      <EmptyState
        icon={Terminal}
        title="No per-test evidence yet"
        description={
          run === null
            ? "Submit your solution to start a sandboxed run; per-test outcomes appear here."
            : `Run ${run.id} recorded no readable per-test results, so there is nothing to break down.`
        }
      />
    )
  }

  return (
    <div className="space-y-4">
      {run.totalCount > 0 && (
        <ProgressBar
          value={run.passedCount}
          max={run.totalCount}
          label="Cases passing in this run"
          valueText={`${run.passedCount} / ${run.totalCount}`}
          tone={run.failedCount === 0 ? "success" : "warning"}
        />
      )}
      <DataTable
        caption="Per-test results from your latest run"
        columns={resultColumns}
        rows={run.results}
        getRowId={(result) => result.testCaseId}
        empty={
          <EmptyState
            size="sm"
            title="No per-test results"
            description="This run recorded no readable per-test evidence."
          />
        }
      />
    </div>
  )
}

/** Every run the student has started, newest first, plus the best-run score. */
function SubmissionsPanel({
  runs,
  bestScore,
  maxMarks,
  scoredRunCount,
}: {
  runs: TestRunResponse[]
  bestScore: number | null
  maxMarks: number
  scoredRunCount: number
}) {
  if (runs.length === 0) {
    return (
      <EmptyState
        icon={PlayCircle}
        title="You have not run your code yet"
        description="Submit your solution to see a run here."
      />
    )
  }

  return (
    <div className="space-y-4">
      <DataTable
        caption="Your sandboxed test runs"
        columns={runColumns}
        rows={runs}
        getRowId={(run) => run.id}
        empty={<EmptyState size="sm" title="No runs" description="Nothing has run yet." />}
      />
      <MetricRow
        label="Score from your best run"
        value={
          <span className="font-mono tabular-nums">
            {bestScore === null ? "—" : `${bestScore} / ${maxMarks}`}
          </span>
        }
        hint={
          scoredRunCount === 0
            ? "No run has recorded a test count yet"
            : `Best of ${scoredRunCount} ${
                scoredRunCount === 1 ? "run" : "runs"
              } · evidence only, not a published mark`
        }
      />
    </div>
  )
}

/**
 * Student code submissions.
 *
 * The page is a **Server Component**: it resolves the task from an
 * `assessmentId` search param and server-fetches the runs, then hands them to
 * the client editor island. The island owns the workspace layout, the Monaco
 * editor and the two run paths; the heavy per-test and run-history tables are
 * rendered here and passed in as nodes.
 *
 * What changed in the workspace rewrite:
 *
 *  - the KPI tiles, the long page description and the above-the-fold
 *    `Task / Results / Runs` tabs are gone — the editor is the page;
 *  - per-test results and the run history moved into the editor's docked bottom
 *    panel (`Testcase` / `Test Result` / `Submissions`), so output sits beside
 *    the code instead of on another page tab;
 *  - language, due date, marks, limits and the submission budget are labelled
 *    rows in the collapsible brief pane, not a run-on muted sentence.
 *
 * Deliberate omissions, so nothing on the page is invented:
 *
 *  - there is no student-facing `TestCase` shape (`lib/contracts/code-eval.ts` is
 *    explicit that a student never receives `expectedOutput`), so there is no
 *    suite listing; per-test outcomes come from the student's own latest run that
 *    recorded evidence.
 *  - a run's `coverage`, `runtimeMs`, `finishedAt` and recomputed points are
 *    nullable; each renders `—` (or the run's state) rather than `0`.
 *  - "Score from your best run" is `max(round(passed / total × maxMarks))` over
 *    runs that recorded a test count. Without a scored run it is `—`.
 */
export default async function StudentCodeSubmissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ assessmentId?: string | string[] }>
}) {
  const user = await getSessionUser()
  if (!user || user.role !== "student") redirect("/login")

  const params = await searchParams
  const requestedId = Array.isArray(params.assessmentId)
    ? params.assessmentId[0]
    : params.assessmentId
  const tasks = await listStudentCodeTasks(user)
  // Resolve the request against the student's own list, so an id they are not
  // enrolled in falls back to the first task instead of reaching an ownership
  // check.
  const selected = tasks.find((task) => task.assessmentId === requestedId) ?? tasks[0] ?? null

  // Server-fetched. The pre-port component refetched this on every selection.
  const runs = selected ? await listStudentRuns(user, selected.assessmentId) : []

  // `listStudentRuns` is newest-first. A run only counts as finished when it
  // recorded a finish time and a test count, so the score's number and its words
  // describe the same runs.
  const scoredRuns = runs.filter((run) => run.totalCount > 0)
  // The latest run that recorded readable per-test evidence drives the Results
  // panel; a run with no evidence cannot break down into cases.
  const evidenceRun = runs.find((run) => run.results.length > 0) ?? runs[0] ?? null
  const bestScore =
    selected && scoredRuns.length > 0
      ? Math.max(
          ...scoredRuns.map((run) =>
            Math.round((run.passedCount / run.totalCount) * selected.maxMarks),
          ),
        )
      : null
  const taskOptions: AssessmentPickerOption[] = tasks.map((task) => ({
    value: task.assessmentId,
    label: task.assessmentTitle,
  }))
  // The latest run's own finish time, matching the Submissions table's
  // "Finished" column. `createdAt` is the row's insert time, which for a
  // backdated run is later than the run itself (SN-40).
  const latestRun = runs[0] ?? null

  return (
    <RoleGuard role="student">
      <AppShell
        scope="app"
        role="student"
        width="full"
        user={{
          name: user.email,
          email: user.email,
          initials: initialsFromEmail(user.email),
          roleLabel: roleLabelFromRole(user.role),
        }}
      >
        {selected === null ? (
          <div className="mx-auto w-full max-w-3xl">
            <PageHeader title="Code submissions" />
            <SectionCard title="Select a task">
              <EmptyState
                icon={Terminal}
                title="No code tasks assigned"
                description="A CODE assessment appears here once you are actively enrolled in its offering. Ask your teacher if you expected one."
              />
            </SectionCard>
          </div>
        ) : (
          <StudentCodeSubmissionEditor
            key={selected.assessmentId}
            task={selected}
            runsCount={runs.length}
            latestRun={
              latestRun === null
                ? null
                : { status: latestRun.status, at: latestRun.finishedAt ?? latestRun.createdAt }
            }
            taskOptions={taskOptions}
            testResultCount={evidenceRun?.results.length ?? 0}
            testResultPanel={<TestResultPanel run={evidenceRun} />}
            submissionsPanel={
              <SubmissionsPanel
                runs={runs}
                bestScore={bestScore}
                maxMarks={selected.maxMarks}
                scoredRunCount={scoredRuns.length}
              />
            }
          />
        )}
      </AppShell>
    </RoleGuard>
  )
}

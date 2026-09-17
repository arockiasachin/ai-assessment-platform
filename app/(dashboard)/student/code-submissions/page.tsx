import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { CircleCheck, Gauge, PlayCircle, Terminal, Timer } from "lucide-react"

import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import { StudentCodeSubmissionEditor } from "@/components/student-code-submissions"
import { buttonVariants } from "@/components/ui/button"
import { CodeBlock } from "@/components/ui/code-block"
import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { KeyValueList, MetricRow } from "@/components/ui/metric-row"
import { PageTabPanel, PageTabs } from "@/components/ui/page-tabs"
import { ProgressBar } from "@/components/ui/progress-bar"
import { SectionCard } from "@/components/ui/section-card"
import { StatCard } from "@/components/ui/stat-card"
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
import { formatDate, formatDateTime, formatDuration, formatPercent, trimNumber } from "@/lib/format"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Code submissions" }

function languageLabel(language: "python" | "javascript"): string {
  return language === "javascript" ? "Node.js 22" : "Python 3.12"
}

/**
 * Per-test rows come from one of the student's **own** runs, never from a shared
 * test-case fixture. The contract has no student-facing `TestCase` shape: a
 * result reports the case's name, category, points and pass/fail, and never its
 * expected output or whether it is hidden — so there is nothing here to hide.
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
      result.stderr ? (
        <details className="text-xs">
          <summary className="cursor-pointer rounded-sm text-primary focus-visible:ring-3 focus-visible:ring-ring/50">
            Show stderr
            <span className="sr-only"> for {result.name}</span>
          </summary>
          <CodeBlock wrap maxHeight="sm" dense className="mt-2">
            {result.stderr}
          </CodeBlock>
        </details>
      ) : (
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
 * Student code submissions.
 *
 * The real page is an **editor**, the mockup is a read-only report, so this is a
 * merge: the editor and its submit button survive as a Client Component
 * (`components/student-code-submissions.tsx`), and the mockup's shell, KPI row and
 * Task / Results / Runs tabs are adopted around them.
 *
 * What changed from the pre-port component:
 *
 *  - the selected task's runs are fetched **on the server** through
 *    `listStudentRuns`, driven by an `assessmentId` search param, so selecting a
 *    task no longer triggers a client fetch;
 *  - `AppShell scope="app"` replaces `RolePageShell` so the authenticated nav,
 *    identity and sign-out are the real ones.
 *
 * Deliberate omissions, so nothing on the page is invented:
 *
 *  - the mockup's **Test cases tab** is a **Results tab**. There is no
 *    student-facing `TestCase` shape (`lib/contracts/code-eval.ts` is explicit
 *    that a student never receives `expectedOutput`), so a suite listing cannot
 *    be rendered at all. Per-test outcomes are shown from the student's own
 *    latest run that recorded evidence — never from shared fixtures, and with no
 *    hidden-case column or copy.
 *  - a run's `coverage`, `runtimeMs`, `finishedAt` and recomputed points are
 *    nullable; each renders `—` (or the run's state) rather than `0`.
 *  - "Score from your best run" is `max(round(passed / total × maxMarks))` over
 *    runs that recorded a test count. `maxMarks` is carried on the student's own
 *    task by the preceding contract commit; without a scored run it is `—`.
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
  // recorded a finish time and a test count, so the tile's number and its words
  // describe the same runs.
  const scoredRuns = runs.filter((run) => run.totalCount > 0)
  const latestFinished = scoredRuns.find((run) => run.finishedAt !== null) ?? null
  const latestCoverage = latestFinished?.coverage ?? null
  const latestRun = runs[0] ?? null
  const evidenceRun = runs.find((run) => run.results.length > 0) ?? runs[0] ?? null
  const bestScore =
    selected && scoredRuns.length > 0
      ? Math.max(
          ...scoredRuns.map((run) =>
            Math.round((run.passedCount / run.totalCount) * selected.maxMarks),
          ),
        )
      : null

  return (
    <RoleGuard role="student">
      <AppShell
        scope="app"
        role="student"
        user={{
          name: user.email,
          email: user.email,
          initials: initialsFromEmail(user.email),
          roleLabel: roleLabelFromRole(user.role),
        }}
      >
        <PageHeader
          eyebrow={tasks.length === 1 && selected ? selected.assessmentTitle : undefined}
          title="Code submissions"
          description="Submit code for sandboxed evaluation. Each run reports your own per-test pass/fail — evidence for your teacher, never a published grade."
        />

        {selected === null ? (
          <SectionCard title="Select a task">
            <EmptyState
              icon={Terminal}
              title="No code tasks assigned"
              description="A CODE assessment appears here once you are actively enrolled in its offering. Ask your teacher if you expected one."
            />
          </SectionCard>
        ) : (
          <div className="space-y-6">
            {tasks.length > 1 && (
              <SectionCard
                title="Select a task"
                description="Your runs are per task, so switching loads that task's runs and results."
              >
                <ul className="flex flex-wrap gap-2">
                  {tasks.map((option) => {
                    const isSelected = option.assessmentId === selected.assessmentId
                    return (
                      <li key={option.assessmentId}>
                        <Link
                          href={{
                            pathname: "/student/code-submissions",
                            query: { assessmentId: option.assessmentId },
                          }}
                          aria-current={isSelected ? "true" : undefined}
                          className={buttonVariants({
                            variant: isSelected ? "default" : "outline",
                            size: "sm",
                          })}
                        >
                          <span className="max-w-[14rem] truncate">{option.assessmentTitle}</span>
                          <span className="ml-1 font-mono text-xs opacity-80">
                            {option.submissionsUsed} / {option.maxSubmissions} runs
                          </span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </SectionCard>
            )}

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Tests passed"
                value={
                  latestFinished === null
                    ? "—"
                    : `${latestFinished.passedCount} / ${latestFinished.totalCount}`
                }
                hint={
                  latestFinished === null
                    ? "No finished run yet"
                    : `Latest finished run · ${latestFinished.failedCount} failing`
                }
                icon={CircleCheck}
              />
              <StatCard
                label="Coverage"
                value={formatPercent(latestCoverage === null ? null : latestCoverage * 100)}
                hint="Reported by the sandbox on a finished run"
                icon={Gauge}
              />
              <StatCard
                label="Runs used"
                value={`${selected.submissionsUsed} / ${selected.maxSubmissions}`}
                hint="Every run counts against the cap"
                icon={PlayCircle}
              />
              <StatCard
                label="Time limit"
                value={formatDuration(selected.timeLimitMs)}
                hint={`${selected.memoryLimitMb} MB memory per run`}
                icon={Timer}
              />
            </div>

            <PageTabs
              items={[
                { value: "task", label: "Task" },
                {
                  value: "results",
                  label: "Results",
                  count: evidenceRun?.results.length ?? 0,
                },
                { value: "runs", label: "Runs", count: runs.length },
              ]}
              label="Code task sections"
            >
              <PageTabPanel value="task" className="space-y-6">
                <SectionCard
                  title="Task brief"
                  description={selected.instructions ?? "No instructions recorded for this task."}
                >
                  <div className="space-y-4">
                    <KeyValueList
                      items={[
                        {
                          id: "assessment",
                          label: "Assessment",
                          value: selected.assessmentTitle,
                        },
                        {
                          id: "language",
                          label: "Language",
                          value: (
                            <span className="font-mono">{languageLabel(selected.language)}</span>
                          ),
                        },
                        {
                          id: "due",
                          label: "Due",
                          value: (
                            <span className="font-mono tabular-nums">
                              {formatDate(selected.dueDate)}
                            </span>
                          ),
                        },
                        {
                          id: "marks",
                          label: "Marks",
                          value: (
                            <span className="font-mono tabular-nums">
                              {selected.maxMarks} points
                            </span>
                          ),
                          hint: "The sandbox reports evidence; the mark is published by your teacher.",
                        },
                        {
                          id: "limits",
                          label: "Limits",
                          value: (
                            <span className="font-mono tabular-nums">
                              {formatDuration(selected.timeLimitMs)} · {selected.memoryLimitMb} MB
                            </span>
                          ),
                        },
                        {
                          id: "budget",
                          label: "Submission budget",
                          value: (
                            <span className="font-mono tabular-nums">
                              {selected.submissionsUsed} / {selected.maxSubmissions} runs used
                            </span>
                          ),
                          hint: selected.canSubmit
                            ? "You can still submit."
                            : (selected.blockedReason ?? undefined),
                        },
                      ]}
                    />

                    <div className="space-y-0.5">
                      <MetricRow
                        label="Test cases in this task"
                        value={
                          <span className="font-mono tabular-nums">{selected.testCaseCount}</span>
                        }
                        hint="The suite is not listed case by case; a run reports your own results."
                      />
                      <MetricRow
                        label="Last run"
                        value={
                          latestRun === null ? (
                            "—"
                          ) : (
                            <StatusPill status={TEST_RUN_STATE_TO_STATUS[latestRun.status]} dot />
                          )
                        }
                        hint={
                          latestRun === null
                            ? "No run recorded yet"
                            : formatDateTime(latestRun.createdAt)
                        }
                      />
                    </div>
                  </div>
                </SectionCard>

                <SectionCard
                  title="Your solution"
                  description="Your code runs in an isolated container — no network, capped memory, and a wall-clock kill. A run is evidence for your teacher; it never publishes a grade."
                >
                  <StudentCodeSubmissionEditor key={selected.assessmentId} task={selected} />
                </SectionCard>
              </PageTabPanel>

              <PageTabPanel value="results" className="space-y-6">
                <SectionCard
                  title="Your results"
                  description="Per-test outcomes from your own latest run that recorded evidence. A case that has not run is not a failure, and a case's expected output is never shown."
                >
                  {evidenceRun === null || evidenceRun.results.length === 0 ? (
                    <EmptyState
                      title="No per-test evidence yet"
                      description={
                        evidenceRun === null
                          ? "Submit your solution on the Task tab to start a sandboxed run."
                          : `Run ${evidenceRun.id} recorded no readable per-test results, so there is nothing to break down.`
                      }
                    />
                  ) : (
                    <div className="space-y-4">
                      {evidenceRun.totalCount > 0 && (
                        <ProgressBar
                          value={evidenceRun.passedCount}
                          max={evidenceRun.totalCount}
                          label="Cases passing in this run"
                          valueText={`${evidenceRun.passedCount} / ${evidenceRun.totalCount}`}
                          tone={evidenceRun.failedCount === 0 ? "success" : "warning"}
                        />
                      )}
                      <DataTable
                        caption="Per-test results from your latest run"
                        columns={resultColumns}
                        rows={evidenceRun.results}
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
                  )}
                </SectionCard>
              </PageTabPanel>

              <PageTabPanel value="runs" className="space-y-6">
                <SectionCard
                  title="Your runs"
                  description="Every run you have started, newest first. A queued or running run has no finish time, so its state is shown instead of a blank date."
                >
                  {runs.length === 0 ? (
                    <EmptyState
                      icon={PlayCircle}
                      title="You have not run your code yet"
                      description="Submit your solution on the Task tab to see a run here."
                    />
                  ) : (
                    <div className="space-y-4">
                      <DataTable
                        caption="Your sandboxed test runs"
                        columns={runColumns}
                        rows={runs}
                        getRowId={(run) => run.id}
                        empty={
                          <EmptyState
                            size="sm"
                            title="No runs"
                            description="Nothing has run yet."
                          />
                        }
                      />
                      <MetricRow
                        label="Score from your best run"
                        value={
                          <span className="font-mono tabular-nums">
                            {bestScore === null ? "—" : `${bestScore} / ${selected.maxMarks}`}
                          </span>
                        }
                        hint={
                          scoredRuns.length === 0
                            ? "No run has recorded a test count yet"
                            : `Best of ${scoredRuns.length} ${
                                scoredRuns.length === 1 ? "run" : "runs"
                              } · evidence only, not a published mark`
                        }
                      />
                    </div>
                  )}
                </SectionCard>
              </PageTabPanel>
            </PageTabs>
          </div>
        )}
      </AppShell>
    </RoleGuard>
  )
}

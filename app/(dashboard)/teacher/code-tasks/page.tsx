import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { Activity, Gauge, ShieldAlert, Terminal } from "lucide-react"

import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import {
  CodeTaskSetupForm,
  SimilarityReview,
  TestCaseActions,
} from "@/components/teacher-code-task-actions"
import { buttonVariants } from "@/components/ui/button"
import { CodeBlock } from "@/components/ui/code-block"
import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { KeyValueList } from "@/components/ui/metric-row"
import { PageTabPanel, PageTabs } from "@/components/ui/page-tabs"
import { SectionCard } from "@/components/ui/section-card"
import { StatCard } from "@/components/ui/stat-card"
import { STATUS_META, StatusPill } from "@/components/ui/status-pill"
import { SUCCESS_TEXT } from "@/components/ui/tone"
import { TruncatedText } from "@/components/ui/truncated-text"
import { getSessionUser } from "@/lib/auth"
import {
  getCodeTaskForTeacher,
  listRunsForTeacher,
  listSimilarityForTeacher,
  listTeacherCodeTasks,
} from "@/lib/code-eval"
import type {
  SimilarityListResponse,
  TestCaseResponse,
  TestRunResponse,
} from "@/lib/contracts/code-eval"
import { TEST_RUN_STATE_TO_STATUS } from "@/lib/labels"
import { formatDate, formatDateTime, formatDuration, formatPercent, trimNumber } from "@/lib/format"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Code tasks" }

/** Mean of 0..1 ratios as a whole percentage; `null` when there is nothing to average. */
function meanPercent(values: number[]): number | null {
  if (values.length === 0) return null
  return Math.round((values.reduce((total, value) => total + value, 0) / values.length) * 100)
}

/** `TestRunState` values are already the `StatusKey`s, so the label comes from one place. */
function runStatusLabel(run: TestRunResponse): string {
  return STATUS_META[TEST_RUN_STATE_TO_STATUS[run.status]].label
}

const runColumns: Column<TestRunResponse>[] = [
  {
    id: "student",
    header: "Student",
    cell: (run) => (
      <div className="min-w-0">
        <TruncatedText className="font-medium">{run.studentName ?? run.studentId}</TruncatedText>
        <p className="text-xs text-muted-foreground">{run.studentRegisterNumber ?? "—"}</p>
      </div>
    ),
  },
  {
    id: "state",
    header: "Run state",
    cell: (run) => <StatusPill status={TEST_RUN_STATE_TO_STATUS[run.status]} dot />,
  },
  {
    id: "tests",
    header: "Tests",
    align: "right",
    cell: (run) => (
      <span className="font-mono tabular-nums">
        {run.passedCount} passed · {run.failedCount} failed · {run.totalCount} total
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
        <span className="font-mono text-muted-foreground tabular-nums">
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
    cell: (run) => <span className="font-mono tabular-nums">{formatDuration(run.runtimeMs)}</span>,
  },
  {
    id: "finished",
    header: "Finished",
    hideBelow: "lg",
    cell: (run) =>
      run.finishedAt === null ? (
        <span className="text-muted-foreground">Not finished yet</span>
      ) : (
        <span className="text-muted-foreground">{formatDateTime(run.finishedAt)}</span>
      ),
  },
  {
    id: "diagnostics",
    header: "Diagnostics",
    hideBelow: "lg",
    cell: (run) =>
      run.stderr === null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <StatusPill status={TEST_RUN_STATE_TO_STATUS[run.status]} label="Captured stderr" />
      ),
  },
]

const caseColumns: Column<TestCaseResponse>[] = [
  {
    id: "case",
    header: "Test case",
    cell: (testCase) => (
      <div className="min-w-0">
        <p className="font-medium">
          {testCase.order + 1}. {testCase.name}
        </p>
        {testCase.description && (
          <p className="max-w-[24rem] truncate text-xs text-muted-foreground">
            {testCase.description}
          </p>
        )}
      </div>
    ),
  },
  { id: "category", header: "Category", cell: (testCase) => testCase.category },
  {
    id: "status",
    header: "Status",
    cell: (testCase) =>
      testCase.status === "draft" ? (
        <StatusPill status="draft" dot />
      ) : (
        <StatusPill status="published" label="Active" dot />
      ),
  },
  {
    id: "visibility",
    header: "Visibility",
    cell: (testCase) =>
      testCase.isHidden ? (
        <StatusPill status="draft" label="Hidden from students" dot />
      ) : (
        <StatusPill status="published" label="Visible" dot />
      ),
  },
  {
    id: "points",
    header: "Points",
    align: "right",
    cell: (testCase) => (
      <span className="font-mono tabular-nums">{trimNumber(testCase.points)}</span>
    ),
  },
]

/**
 * Code tasks — the sandboxed test harness.
 *
 * The old page was a list plus three client fetches per selection (detail, runs,
 * similarity). This port keeps the list — it is the real page's shape, and the
 * mockup has no way to choose between several CODE assessments — but resolves
 * the selection through an `assessmentId` search param and fetches the selected
 * task's detail, runs and similarity **on the server**. The three fetches are
 * gone; only the mutations remain client-side
 * (`components/teacher-code-task-actions.tsx`). See `docs/plans/wave-1.md` §3.
 *
 * Deliberate omissions, so no number on the page is one nothing derives:
 *
 *  - the mockup's "weighting 15% of the final grade" is dropped —
 *    `Assessment` has no weight column; weights exist only in the LMS export
 *    request body;
 *  - a test case's "last result" column is dropped — the serialized test case
 *    carries no per-case result;
 *  - nothing fabricates an `ERROR` run. `resolveRunStatus` returns `ERROR` only
 *    for a memory kill, so a crashed harness is a `FAILED` run, and the seeded
 *    run's evidence has neither `finishedAt` nor `coverage` — those cells render
 *    an em dash or "Not finished yet", which is the truth, not a gap to paper
 *    over.
 */
export default async function TeacherCodeTasksPage({
  searchParams,
}: {
  searchParams: Promise<{ assessmentId?: string | string[] }>
}) {
  const user = await getSessionUser()
  if (!user || user.role !== "teacher") redirect("/login")

  const params = await searchParams
  const requestedId = Array.isArray(params.assessmentId)
    ? params.assessmentId[0]
    : params.assessmentId
  const tasks = await listTeacherCodeTasks(user)
  // Resolve the request against the owned list so an id the teacher does not own
  // falls back to the first task instead of reaching an ownership check.
  const selected = tasks.find((task) => task.assessmentId === requestedId) ?? tasks[0] ?? null

  let detail: Awaited<ReturnType<typeof getCodeTaskForTeacher>> | null = null
  let runs: TestRunResponse[] = []
  let similarity: SimilarityListResponse | null = null
  if (selected?.hasCodeTask) {
    ;[detail, runs, similarity] = await Promise.all([
      getCodeTaskForTeacher(user, selected.assessmentId),
      listRunsForTeacher(user, selected.assessmentId),
      listSimilarityForTeacher(user, selected.assessmentId),
    ])
  }

  const task = detail?.task ?? null
  const testCases = detail?.testCases ?? []
  const pairs = similarity?.pairs ?? []

  // Only finished runs that recorded a test count can contribute a rate, and the
  // count in the tile's hint is the same set — so the number and the words cannot
  // describe different runs.
  const finishedRuns = runs.filter((run) => run.finishedAt !== null && run.totalCount > 0)
  const passRate = meanPercent(finishedRuns.map((run) => run.passedCount / run.totalCount))
  const avgCoverage = meanPercent(
    runs.map((run) => run.coverage).filter((coverage): coverage is number => coverage !== null),
  )
  const activeRuns = runs.filter((run) => run.status === "QUEUED" || run.status === "RUNNING")
  const flaggedPairs = pairs.filter((pair) => pair.verdict === "FLAGGED")
  const failedRuns = runs.filter(
    (run) => run.status === "FAILED" || run.status === "ERROR" || run.status === "TIMEOUT",
  )
  const hiddenCases = testCases.filter((testCase) => testCase.isHidden).length
  const draftCases = testCases.filter((testCase) => testCase.status === "draft").length
  const casePoints = testCases.reduce((total, testCase) => total + testCase.points, 0)

  return (
    <RoleGuard role="teacher">
      <AppShell
        scope="app"
        role="teacher"
        user={{
          name: user.email,
          email: user.email,
          initials: initialsFromEmail(user.email),
          roleLabel: roleLabelFromRole(user.role),
        }}
      >
        <PageHeader
          eyebrow={selected ? `${selected.courseCode} · ${selected.className}` : undefined}
          title="Code tasks"
          description="Sandboxed runs, test cases, coverage, and similarity flags."
        />

        {selected === null ? (
          <SectionCard title="Select a task">
            <EmptyState
              icon={Terminal}
              title="No CODE assessments yet"
              description="Only CODE assessments you created or teach appear here. Create one on the Assignments page, then author its sandboxed task here."
            />
          </SectionCard>
        ) : (
          <div className="space-y-6">
            <SectionCard
              title="Select a task"
              description="Student code runs in an isolated container — no network, capped CPU, memory and PIDs, with a wall-clock kill. The counts below are test cases and recorded runs."
            >
              <ul className="flex flex-wrap gap-2">
                {tasks.map((option) => {
                  const isSelected = option.assessmentId === selected.assessmentId
                  const activeCases = option.testCaseCount - option.draftTestCaseCount
                  return (
                    <li key={option.assessmentId}>
                      <Link
                        href={{
                          pathname: "/teacher/code-tasks",
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
                          {activeCases} active
                          {option.draftTestCaseCount > 0
                            ? ` · ${option.draftTestCaseCount} draft`
                            : ""}{" "}
                          · {option.submissionCount} {option.submissionCount === 1 ? "run" : "runs"}
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </SectionCard>

            {!selected.hasCodeTask || task === null ? (
              <>
                <SectionCard
                  title="Task setup"
                  description="This CODE assessment has no code task yet."
                >
                  <EmptyState
                    icon={Terminal}
                    title="No code task configured"
                    description="Set a language and its limits below to create one. Test cases, runs and similarity checks all hang off it."
                  />
                </SectionCard>
                <CodeTaskSetupForm
                  key={selected.assessmentId}
                  assessmentId={selected.assessmentId}
                  task={null}
                />
              </>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <StatCard
                    label="Average pass rate"
                    value={formatPercent(passRate)}
                    hint={`Across ${finishedRuns.length} finished ${
                      finishedRuns.length === 1 ? "run" : "runs"
                    }`}
                    icon={Terminal}
                  />
                  <StatCard
                    label="Average coverage"
                    value={formatPercent(avgCoverage)}
                    hint="Lines executed by the suite"
                    icon={Gauge}
                  />
                  <StatCard
                    label="Active runs"
                    value={String(activeRuns.length)}
                    hint={
                      activeRuns.length === 0
                        ? "Nothing queued or running"
                        : activeRuns.map((run) => run.studentName ?? run.studentId).join(", ")
                    }
                    icon={Activity}
                  />
                  <StatCard
                    label="Similarity flags"
                    value={String(flaggedPairs.length)}
                    hint={`${pairs.length} ${pairs.length === 1 ? "pair" : "pairs"} compared`}
                    icon={ShieldAlert}
                  />
                </div>

                <PageTabs
                  items={[
                    { value: "runs", label: "Runs", count: runs.length },
                    { value: "cases", label: "Test cases", count: testCases.length },
                    { value: "similarity", label: "Similarity", count: pairs.length },
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
                        rows={runs}
                        getRowId={(run) => run.id}
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
                      description={
                        failedRuns.length > 0
                          ? `${failedRuns.length} ${
                              failedRuns.length === 1 ? "run" : "runs"
                            } failed, errored or timed out. The captured stderr is the actionable part.`
                          : "No recorded run has failed, errored or timed out."
                      }
                    >
                      {failedRuns.length === 0 ? (
                        <EmptyState
                          title="No failing runs"
                          description={
                            runs.length === 0
                              ? "No test run has been recorded for this task yet."
                              : "Every recorded run passed, or is still in flight."
                          }
                        />
                      ) : (
                        <div className="space-y-3">
                          {failedRuns.map((run) => (
                            <details key={run.id} className="rounded-lg border border-border p-3">
                              <summary className="cursor-pointer text-sm font-medium">
                                {run.studentName ?? run.studentId} · {run.passedCount}/
                                {run.totalCount} passed · {runStatusLabel(run)}
                              </summary>
                              <div className="mt-3 space-y-3">
                                <p className="text-xs text-muted-foreground">
                                  {run.finishedAt === null
                                    ? "Not finished"
                                    : formatDateTime(run.finishedAt)}{" "}
                                  · {formatDuration(run.runtimeMs)} · coverage{" "}
                                  {run.coverage === null
                                    ? "not measured"
                                    : formatPercent(run.coverage * 100)}
                                </p>
                                {run.results.length === 0 ? (
                                  <p className="text-xs text-muted-foreground">
                                    No per-test evidence was recorded for this run.
                                  </p>
                                ) : (
                                  <ul className="grid gap-2">
                                    {run.results.map((result) => (
                                      <li
                                        key={result.testCaseId}
                                        className="rounded border border-border/70 bg-muted/30 p-2 text-xs"
                                      >
                                        <span
                                          className={
                                            result.passed ? SUCCESS_TEXT : "text-destructive"
                                          }
                                        >
                                          {result.passed ? "PASS" : "FAIL"}
                                        </span>
                                        <span className="ml-2 font-medium">{result.name}</span>
                                        <span className="ml-2 text-muted-foreground">
                                          {result.category} · {trimNumber(result.earnedPoints)}/
                                          {trimNumber(result.points)}
                                        </span>
                                        {result.message && (
                                          <p className="mt-1 text-muted-foreground">
                                            {result.message}
                                          </p>
                                        )}
                                        {result.stdout && (
                                          <CodeBlock dense wrap maxHeight="sm" className="mt-1">
                                            {result.stdout}
                                          </CodeBlock>
                                        )}
                                        {result.stderr && (
                                          <CodeBlock
                                            dense
                                            wrap
                                            maxHeight="sm"
                                            className="mt-1 text-destructive"
                                          >
                                            {result.stderr}
                                          </CodeBlock>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                                <CodeBlock wrap maxHeight="sm">
                                  {run.stderr ?? "No stderr captured."}
                                </CodeBlock>
                              </div>
                            </details>
                          ))}
                        </div>
                      )}
                    </SectionCard>
                  </PageTabPanel>

                  <PageTabPanel value="cases" className="space-y-6">
                    <SectionCard
                      title="Test cases"
                      description={
                        testCases.length === 0
                          ? "No test cases yet. Add one, or generate drafts from the task instructions."
                          : `${hiddenCases} of ${testCases.length} cases are hidden. A hidden case never reveals its expected output to a student — only whether it passed.`
                      }
                    >
                      <DataTable
                        caption="Test cases"
                        columns={caseColumns}
                        rows={testCases}
                        getRowId={(testCase) => testCase.id}
                        empty={
                          <EmptyState
                            title="No test cases"
                            description="Add a case before students can submit this task."
                          />
                        }
                      />
                    </SectionCard>

                    <TestCaseActions
                      key={selected.assessmentId}
                      assessmentId={selected.assessmentId}
                      draftCount={draftCases}
                    />
                  </PageTabPanel>

                  <PageTabPanel value="similarity">
                    <SimilarityReview
                      key={selected.assessmentId}
                      assessmentId={selected.assessmentId}
                      pairs={pairs}
                      threshold={similarity?.threshold ?? 0}
                    />
                  </PageTabPanel>

                  <PageTabPanel value="setup" className="space-y-6">
                    <SectionCard
                      title="Task"
                      description={task.instructions ?? "No instructions recorded for this task."}
                    >
                      <KeyValueList
                        items={[
                          {
                            id: "assessment",
                            label: "Assessment",
                            value: selected.assessmentTitle,
                            hint: `Due ${formatDate(selected.dueDate)} · ${selected.courseName}`,
                          },
                          {
                            id: "language",
                            label: "Language",
                            value: (
                              <span className="font-mono text-xs">
                                {task.language === "javascript" ? "Node.js 22" : "Python 3.12"}
                              </span>
                            ),
                          },
                          {
                            id: "time",
                            label: "Time limit",
                            value: formatDuration(task.timeLimitMs),
                            hint: "Per run, across the whole test suite",
                          },
                          {
                            id: "memory",
                            label: "Memory limit",
                            value: `${task.memoryLimitMb} MB`,
                          },
                          {
                            id: "cap",
                            label: "Max runs per student",
                            value: String(task.maxSubmissions),
                          },
                          {
                            id: "points",
                            label: "Test points",
                            value: `${trimNumber(casePoints)} of ${selected.maxMarks} pts`,
                            hint: "Sum of this task's test cases. Test cases are the only thing the sandbox scores.",
                          },
                        ]}
                      />
                    </SectionCard>

                    <SectionCard
                      title="Starter code"
                      description="What every student begins with. Submissions run in the sandbox, never on the reviewer's machine."
                    >
                      {task.starterCode ? (
                        <CodeBlock className="p-4">{task.starterCode}</CodeBlock>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          No starter code set for this task.
                        </p>
                      )}
                    </SectionCard>

                    <CodeTaskSetupForm
                      key={selected.assessmentId}
                      assessmentId={selected.assessmentId}
                      task={task}
                    />
                  </PageTabPanel>
                </PageTabs>
              </>
            )}
          </div>
        )}
      </AppShell>
    </RoleGuard>
  )
}

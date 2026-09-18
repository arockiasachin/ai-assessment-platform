"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import dynamic from "next/dynamic"
import {
  BookOpenText,
  CircleCheck,
  Code2,
  History,
  Info,
  Loader2,
  Play,
  PlayCircle,
  Send,
} from "lucide-react"

import { AssessmentPicker, type AssessmentPickerOption } from "@/components/assessment-picker"
import { BackLink } from "@/components/back-link"
import { CollapsibleSection } from "@/components/collapsible-section"
import { EditorWorkspace } from "@/components/editor-workspace"
import { QuestionPrompt } from "@/components/question-prompt"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CodeBlock } from "@/components/ui/code-block"
import { EmptyState } from "@/components/ui/empty-state"
import { InfoHint } from "@/components/ui/info-hint"
import { KeyValueList, MetricRow } from "@/components/ui/metric-row"
import { Separator } from "@/components/ui/separator"
import { StatusPill } from "@/components/ui/status-pill"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type {
  CodeRunResult,
  StudentCodeTask,
  TestResult,
  TestRunResponse,
} from "@/lib/contracts/code-eval"
import { formatDate, formatDateTime, formatDuration, trimNumber } from "@/lib/format"
import { TEST_RUN_STATE_TO_STATUS } from "@/lib/labels"
import { cn } from "@/lib/utils"

/**
 * The code workspace island — the only client component on the page.
 *
 * It owns what the Server Component cannot:
 *
 *  - the **Monaco editor**, lazily imported with `next/dynamic`/`ssr: false` so
 *    the (large) editor never enters the route's initial bundle and is never
 *    executed while server-rendering;
 *  - the **two run paths**. `Run samples` posts to
 *    `/api/student/code-submissions/run`, which executes only the task's visible
 *    sample cases and persists nothing; `Submit for evaluation` posts to
 *    `/api/student/code-submissions`, which runs every active case and consumes
 *    a graded attempt. Keeping them distinct in the UI is what makes "free" and
 *    "counted" legible;
 *  - the **workspace layout** — the draggable split and the docked output panel.
 *
 * The per-test results table and the run-history table are **rendered on the
 * server** and passed in as `ReactNode` props; the island only chooses which
 * panel is visible. That keeps the heavy tables and their column definitions
 * out of the client bundle while still letting the student read them beside
 * their code.
 *
 * The starter code is Monaco's `defaultValue`, not React state: the student must
 * type over it for `source` to become non-empty, so unchanged starter code can
 * never be submitted or run (the pre-Monaco invariant, preserved).
 */

const MonacoEditor = dynamic(() => import("@monaco-editor/react").then((mod) => mod.default), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-64 items-center justify-center text-sm text-muted-foreground">
      <Loader2 className="mr-2 size-4 animate-spin" /> Loading editor…
    </div>
  ),
})

type Props = {
  task: StudentCodeTask
  /** How many runs the student has recorded for this task. */
  runsCount: number
  /** The student's most recent run's state and time, or `null` if none. */
  latestRun: { status: TestRunResponse["status"]; at: string } | null
  /** The student's other code tasks, for the compact header picker. */
  taskOptions: AssessmentPickerOption[]
  /** Server-rendered per-test results for the evidence run. */
  testResultPanel: React.ReactNode
  /** Server-rendered run history table. */
  submissionsPanel: React.ReactNode
  /** Count shown on the "Test Result" tab. */
  testResultCount: number
}

type Busy = "run" | "submit" | null

type RunView =
  | { kind: "run"; result: CodeRunResult }
  | { kind: "submit"; run: TestRunResponse }
  | { kind: "error"; source: "run" | "submit"; message: string }

/** The common shape both a free Run and a Submit result expose to the panel. */
type PanelData = {
  status: TestRunResponse["status"]
  passedCount: number
  failedCount: number
  totalCount: number
  earnedPoints: number
  maxPoints: number
  runtimeMs: number | null
  coverage: number | null
  results: TestResult[]
  stdout: string | null
  stderr: string | null
  timedOut: boolean
  memoryExceeded: boolean
}

const OUTPUT_TABS = ["testcase", "test-result", "submissions"] as const
type OutputTab = (typeof OUTPUT_TABS)[number]

const OUTPUT_TAB_LABELS: Record<OutputTab, string> = {
  testcase: "Testcase",
  "test-result": "Test Result",
  submissions: "Submissions",
}

function languageLabel(language: "python" | "javascript"): string {
  return language === "javascript" ? "Node.js 22" : "Python 3.12"
}

/**
 * Render one test case's visible detail. Hidden cases never reach here with
 * detail — the **server** nulls their input/expected/actual before the response
 * is built (`lib/code-eval/visibility.ts`), so this component cannot leak what it
 * was never sent. It renders a count for them instead.
 */
function CaseDetail({ result }: { result: TestResult }) {
  return (
    <li className="rounded-md border border-border/70 bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={result.passed ? "passed" : "failed"} dot />
        <span className="text-sm font-medium">{result.name}</span>
        <span className="text-xs text-muted-foreground">
          {result.category} · {trimNumber(result.earnedPoints)}/{trimNumber(result.points)} pts
        </span>
        {result.durationMs > 0 && (
          <span className="font-mono text-xs text-muted-foreground">
            {formatDuration(result.durationMs)}
          </span>
        )}
      </div>

      {(result.input !== null || result.expectedOutput !== null || result.actualOutput) && (
        <dl className="mt-2 grid gap-1.5 sm:grid-cols-3">
          <div>
            <dt className="text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">
              Input
            </dt>
            <dd>
              <CodeBlock dense maxHeight="sm" wrap className="mt-1">
                {result.input ?? "(none)"}
              </CodeBlock>
            </dd>
          </div>
          <div>
            <dt className="text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">
              Expected
            </dt>
            <dd>
              <CodeBlock dense maxHeight="sm" wrap className="mt-1">
                {result.expectedOutput ?? "(not compared)"}
              </CodeBlock>
            </dd>
          </div>
          <div>
            <dt className="text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">
              Your output
            </dt>
            <dd>
              <CodeBlock dense maxHeight="sm" wrap className="mt-1">
                {result.actualOutput ?? result.stdout ?? "(no output)"}
              </CodeBlock>
            </dd>
          </div>
        </dl>
      )}

      {!result.passed && result.message && (
        <p className="mt-1.5 text-xs text-destructive">{result.message}</p>
      )}
      {result.stderr && (
        <CodeBlock dense maxHeight="sm" wrap className="mt-1.5">
          {result.stderr}
        </CodeBlock>
      )}
    </li>
  )
}

/**
 * The free-run / submit output. All of its content is one scrollable column:
 * the bottom panel's tabs are the only tab row, so this cannot nest a second
 * one and hide output behind two clicks.
 */
function RunOutput({
  data,
  kind,
  hiddenNotRun,
}: {
  data: PanelData
  kind: "run" | "submit"
  /** Free-run only: hidden cases exist but were not executed by this path. */
  hiddenNotRun: number
}) {
  const visible = data.results.filter((result) => result.isHidden !== true)
  const hidden = data.results.filter((result) => result.isHidden === true)
  const hiddenPassed = hidden.filter((result) => result.passed).length
  const casesWithOutput = visible.filter((result) => result.stdout || result.stderr)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={TEST_RUN_STATE_TO_STATUS[data.status]} dot />
        <span className="text-sm">
          <span className="font-mono tabular-nums">{data.passedCount}</span> /{" "}
          <span className="font-mono tabular-nums">{data.totalCount}</span> cases passed
        </span>
        <Badge variant="secondary">
          {kind === "run" ? "Sample run · not counted" : "Submission · counted"}
        </Badge>
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {formatDuration(data.runtimeMs)}
        </span>
      </div>

      <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <MetricRow
          label="Points"
          value={
            <span className="font-mono tabular-nums">
              {trimNumber(data.earnedPoints)} / {trimNumber(data.maxPoints)}
            </span>
          }
        />
        <MetricRow
          label="Runtime"
          value={<span className="font-mono">{formatDuration(data.runtimeMs)}</span>}
        />
        <MetricRow
          label="Coverage"
          value={
            <span className="font-mono tabular-nums">
              {data.coverage === null ? "—" : `${Math.round(data.coverage * 100)}%`}
            </span>
          }
        />
        <MetricRow
          label="Hidden cases"
          value={
            <span className="font-mono tabular-nums">
              {hidden.length + hiddenNotRun}
              {hidden.length > 0 ? ` (${hiddenPassed} passed)` : ""}
            </span>
          }
        />
      </dl>

      {(data.timedOut || data.memoryExceeded) && (
        <p className="text-sm text-destructive">
          {data.timedOut
            ? "The run exceeded its wall-clock limit and was killed."
            : "The run exceeded its memory limit and was killed."}
        </p>
      )}

      {(data.stdout || data.stderr) && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Console output</h3>
          {data.stdout && (
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">stdout</p>
              <CodeBlock maxHeight="md" wrap>
                {data.stdout}
              </CodeBlock>
            </div>
          )}
          {data.stderr && (
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">stderr</p>
              <CodeBlock maxHeight="md" wrap>
                {data.stderr}
              </CodeBlock>
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold">
          {visible.length === 1 ? "Sample case" : "Sample cases"}
        </h3>
        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">No visible sample cases ran.</p>
        ) : (
          <ul className="grid gap-2">
            {visible.map((result) => (
              <CaseDetail key={result.testCaseId} result={result} />
            ))}
          </ul>
        )}

        {hidden.length > 0 && (
          <p className="flex flex-wrap items-center gap-1.5 rounded-md border border-dashed border-border p-2.5 text-sm text-muted-foreground">
            <span>
              <span className="font-mono tabular-nums">{hiddenPassed}</span> of{" "}
              <span className="font-mono tabular-nums">{hidden.length}</span> hidden cases passed.
            </span>
            <InfoHint label="Why hidden cases show only pass or fail">
              Hidden cases show only pass/fail — their input and expected output are not returned to
              students.
            </InfoHint>
          </p>
        )}
        {hiddenNotRun > 0 && (
          <p className="flex flex-wrap items-center gap-1.5 rounded-md border border-dashed border-border p-2.5 text-sm text-muted-foreground">
            <span>
              <span className="font-mono tabular-nums">{hiddenNotRun}</span> hidden{" "}
              {hiddenNotRun === 1 ? "case was" : "cases were"} not run by this sample run.
            </span>
            <InfoHint label="Why some hidden cases do not run here">
              Hidden cases are graded only on Submit and are never run by a sample run.
            </InfoHint>
          </p>
        )}
      </div>

      {casesWithOutput.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Captured case output</h3>
          {casesWithOutput.map((result) => (
            <div key={result.testCaseId}>
              <p className="mb-1 text-xs font-medium text-muted-foreground">{result.name}</p>
              {result.stdout && (
                <CodeBlock dense maxHeight="sm" wrap className="mb-1">
                  {result.stdout}
                </CodeBlock>
              )}
              {result.stderr && (
                <CodeBlock dense maxHeight="sm" wrap>
                  {result.stderr}
                </CodeBlock>
              )}
            </div>
          ))}
        </div>
      )}

      {!data.stdout && !data.stderr && casesWithOutput.length === 0 && visible.length > 0 && (
        <p className="text-sm text-muted-foreground">No console output was captured.</p>
      )}
    </div>
  )
}

/**
 * The docked output panel: the run result the student just produced, plus the
 * server-rendered per-test results and run history.
 */
function CodeOutputPanel({
  tab,
  onTabChange,
  runOutput,
  testResultPanel,
  submissionsPanel,
  testResultCount,
  submissionsCount,
  className,
}: {
  tab: OutputTab
  onTabChange: (tab: OutputTab) => void
  runOutput: React.ReactNode
  testResultPanel: React.ReactNode
  submissionsPanel: React.ReactNode
  testResultCount: number
  submissionsCount: number
  className?: string
}) {
  const counts: Partial<Record<OutputTab, number>> = {
    "test-result": testResultCount,
    submissions: submissionsCount,
  }

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => onTabChange(value as OutputTab)}
      className={cn(
        "min-h-0 flex-col gap-0 overflow-hidden rounded-lg border border-border bg-card",
        className,
      )}
    >
      <div className="shrink-0 border-b border-border px-2">
        <TabsList
          variant="line"
          aria-label="Run output and history"
          className="w-full justify-start"
        >
          {OUTPUT_TABS.map((value) => {
            const count = counts[value]
            return (
              <TabsTrigger key={value} value={value} className="flex-none px-3">
                {OUTPUT_TAB_LABELS[value]}
                {typeof count === "number" && count > 0 && (
                  <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 font-mono text-[0.65rem] tabular-nums text-muted-foreground">
                    {count}
                  </span>
                )}
              </TabsTrigger>
            )
          })}
        </TabsList>
      </div>

      <TabsContent value="testcase" className="min-h-0 flex-1 overflow-y-auto p-3">
        {runOutput ?? (
          <EmptyState
            icon={PlayCircle}
            title="No run output yet"
            description="Run the visible sample cases to see their input, expected output and your result here — or submit for a full run."
          />
        )}
      </TabsContent>
      <TabsContent value="test-result" className="min-h-0 flex-1 overflow-y-auto p-3">
        {testResultPanel}
      </TabsContent>
      <TabsContent value="submissions" className="min-h-0 flex-1 overflow-y-auto p-3">
        {submissionsPanel}
      </TabsContent>
    </Tabs>
  )
}

export function StudentCodeSubmissionEditor({
  task,
  runsCount,
  latestRun,
  taskOptions,
  testResultPanel,
  submissionsPanel,
  testResultCount,
}: Props) {
  const router = useRouter()
  const [source, setSource] = useState("")
  const [busy, setBusy] = useState<Busy>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [view, setView] = useState<RunView | null>(null)
  const [outputTab, setOutputTab] = useState<OutputTab>("testcase")

  const hasSource = source.trim().length > 0

  async function runSamples() {
    setBusy("run")
    setMessage(null)
    setOutputTab("testcase")
    try {
      const response = await fetch("/api/student/code-submissions/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assessmentId: task.assessmentId, sourceCode: source }),
      })
      const body: { success?: boolean; message?: string; result?: CodeRunResult } = await response
        .json()
        .catch(() => ({}))
      if (!response.ok || body.success === false || !body.result) {
        throw new Error(body.message ?? "Request failed.")
      }
      setView({ kind: "run", result: body.result })
      setMessage(
        `Sample run complete: ${body.result.passedCount}/${body.result.totalCount} sample cases passed. ` +
          "This run is a preview and does not count against your submission limit.",
      )
    } catch (caught) {
      setView({
        kind: "error",
        source: "run",
        message: caught instanceof Error ? caught.message : "Request failed.",
      })
    } finally {
      setBusy(null)
    }
  }

  async function submit() {
    setBusy("submit")
    setMessage(null)
    setOutputTab("testcase")
    try {
      const response = await fetch("/api/student/code-submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assessmentId: task.assessmentId, sourceCode: source }),
      })
      const body: { success?: boolean; message?: string; run?: TestRunResponse } = await response
        .json()
        .catch(() => ({}))
      if (!response.ok || body.success === false || !body.run) {
        throw new Error(body.message ?? "Request failed.")
      }
      setView({ kind: "submit", run: body.run })
      setMessage(
        `Run complete: ${body.run.passedCount}/${body.run.totalCount} tests passed. ` +
          "Results are evidence for your teacher, not a published grade.",
      )
      // The server owns the Test Result / Submissions panels, so re-render it to
      // include this run.
      router.refresh()
    } catch (caught) {
      setView({
        kind: "error",
        source: "submit",
        message: caught instanceof Error ? caught.message : "Request failed.",
      })
    } finally {
      setBusy(null)
    }
  }

  const runOutput =
    view?.kind === "run" ? (
      <RunOutput data={view.result} kind="run" hiddenNotRun={view.result.hiddenCount} />
    ) : view?.kind === "submit" ? (
      <RunOutput data={view.run} kind="submit" hiddenNotRun={0} />
    ) : null

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Compact header: title, picker, actions. The page-level description and
          KPI tiles that used to sit here are gone; the metadata now lives as
          labelled rows in the brief pane. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <BackLink pathname="/student/code-submissions" className="mb-1" />
          <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Code submissions
          </p>
          <h1 className="truncate text-lg font-semibold tracking-tight">{task.assessmentTitle}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <AssessmentPicker
            value={task.assessmentId}
            options={taskOptions}
            basePath="/student/code-submissions"
            label="Select a code task"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null || !hasSource}
            onClick={() => void runSamples()}
          >
            {busy === "run" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Play className="size-4" />
            )}
            <span className="ml-1">Run samples</span>
          </Button>
          <Button
            size="sm"
            disabled={busy !== null || !task.canSubmit || !hasSource}
            onClick={() => void submit()}
          >
            {busy === "submit" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            <span className="ml-1">Submit for evaluation</span>
          </Button>
        </div>
      </div>

      {!task.canSubmit && task.blockedReason && (
        <p role="alert" className="text-sm text-destructive">
          {task.blockedReason}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
          {message}
        </p>
      )}
      {view?.kind === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {view.message}
        </p>
      )}

      <EditorWorkspace
        leftLabel="Task brief"
        left={
          <div className="space-y-5">
            <CollapsibleSection title="Problem" icon={BookOpenText}>
              <QuestionPrompt
                text={task.instructions}
                emptyText="No instructions were recorded for this task."
              />
            </CollapsibleSection>

            <Separator />

            <CollapsibleSection title="Details" icon={Info}>
              <KeyValueList
                className="text-base [&_dd]:text-base [&_dt]:text-base"
                items={[
                  {
                    id: "language",
                    label: "Language",
                    value: <span className="font-mono">{languageLabel(task.language)}</span>,
                  },
                  {
                    id: "due",
                    label: "Due",
                    value: (
                      <span className="font-mono tabular-nums">{formatDate(task.dueDate)}</span>
                    ),
                  },
                  {
                    id: "marks",
                    label: "Marks",
                    value: <span className="font-mono tabular-nums">{task.maxMarks} points</span>,
                    hint: "The sandbox reports evidence; the mark is published by your teacher.",
                  },
                  {
                    id: "limits",
                    label: "Limits",
                    value: (
                      <span className="font-mono tabular-nums">
                        {formatDuration(task.timeLimitMs)} · {task.memoryLimitMb} MB
                      </span>
                    ),
                  },
                  {
                    id: "cases",
                    label: "Test cases",
                    value: <span className="font-mono tabular-nums">{task.testCaseCount}</span>,
                    hint: "Active cases only. Sample runs execute the visible cases.",
                  },
                  {
                    id: "budget",
                    label: "Submission budget",
                    value: (
                      <span className="font-mono tabular-nums">
                        {task.submissionsUsed} / {task.maxSubmissions} runs used
                      </span>
                    ),
                    hint: task.canSubmit
                      ? "Sample runs are free; only submissions count against the cap."
                      : (task.blockedReason ?? undefined),
                  },
                ]}
              />
            </CollapsibleSection>

            <Separator />

            <CollapsibleSection title="Submission history" icon={History}>
              <dl className="space-y-0.5">
                <MetricRow
                  label="Latest run"
                  value={
                    latestRun === null ? (
                      "—"
                    ) : (
                      <StatusPill status={TEST_RUN_STATE_TO_STATUS[latestRun.status]} dot />
                    )
                  }
                  hint={latestRun === null ? "No run recorded yet" : formatDateTime(latestRun.at)}
                />
                <MetricRow
                  label="Runs recorded"
                  value={
                    <span className="font-mono tabular-nums">
                      {runsCount} / {task.maxSubmissions}
                    </span>
                  }
                  hint="Sample runs are not recorded; submissions are."
                />
              </dl>
            </CollapsibleSection>
          </div>
        }
        right={
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex h-[60vh] min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card md:h-auto md:flex-[3]">
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
                <div className="flex items-center gap-2">
                  <Code2 className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span className="text-sm font-medium">Your solution</span>
                </div>
                <span className="font-mono text-xs text-muted-foreground">
                  {languageLabel(task.language)}
                </span>
              </div>
              <div id="student-code-source" className="min-h-0 flex-1">
                <MonacoEditor
                  height="100%"
                  language={task.language}
                  defaultValue={task.starterCode ?? ""}
                  onChange={(value) => setSource(value ?? "")}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 14,
                    tabSize: 4,
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    wordWrap: "on",
                    readOnly: busy !== null,
                    ariaLabel: `Code submission for ${task.assessmentTitle}`,
                  }}
                />
              </div>
            </div>

            <CodeOutputPanel
              tab={outputTab}
              onTabChange={setOutputTab}
              runOutput={runOutput}
              testResultPanel={testResultPanel}
              submissionsPanel={submissionsPanel}
              testResultCount={testResultCount}
              submissionsCount={runsCount}
              className="flex h-80 md:h-auto md:flex-[2]"
            />
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <CircleCheck className="size-4" aria-hidden="true" />
        <span>Sample runs are free.</span>
        <InfoHint label="About the starter code and the submission budget">
          The starter code is shown until you type over it. Sample runs are free; each submit uses
          one of your {task.maxSubmissions} submissions.
        </InfoHint>
      </div>
    </div>
  )
}

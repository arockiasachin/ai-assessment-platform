"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import dynamic from "next/dynamic"
import { Code2, Loader2, Play, Send } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CodeBlock } from "@/components/ui/code-block"
import { MetricRow } from "@/components/ui/metric-row"
import { StatusPill } from "@/components/ui/status-pill"
import type {
  CodeRunResult,
  StudentCodeTask,
  TestResult,
  TestRunResponse,
} from "@/lib/contracts/code-eval"
import { formatDuration, trimNumber } from "@/lib/format"
import { TEST_RUN_STATE_TO_STATUS } from "@/lib/labels"
import { cn } from "@/lib/utils"

/**
 * The code editor island — the only client component on the page.
 *
 * It owns three things the Server Component cannot:
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
 *  - the **output panel** (Console / Test cases / Summary), rendered from either
 *    result without pretending a free run is evidence.
 *
 * The starter code is Monaco's `defaultValue`, not React state: the student must
 * type over it for `source` to become non-empty, so unchanged starter code can
 * never be submitted or run (the pre-Monaco invariant, preserved).
 */

const MonacoEditor = dynamic(() => import("@monaco-editor/react").then((mod) => mod.default), {
  ssr: false,
  loading: () => (
    <div className="flex h-64 items-center justify-center rounded-md border border-input bg-muted/40 text-sm text-muted-foreground">
      <Loader2 className="mr-2 size-4 animate-spin" /> Loading editor…
    </div>
  ),
})

type Props = { task: StudentCodeTask }

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

const TABS = ["console", "cases", "summary"] as const
type Tab = (typeof TABS)[number]

const TAB_LABELS: Record<Tab, string> = {
  console: "Console",
  cases: "Test cases",
  summary: "Summary",
}

/**
 * Render one test case's visible detail. Hidden cases never reach here with
 * detail — the **server** nulls their input/expected/actual before the response
 * is built (`lib/code-eval/visibility.ts`), so this component cannot leak what it
 * was never sent. It renders a count for them instead.
 */
function CaseDetail({ result }: { result: TestResult }) {
  return (
    <li className="rounded-md border border-border/70 bg-muted/20 p-2.5">
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

function RunPanel({
  data,
  kind,
  hiddenNotRun,
}: {
  data: PanelData
  kind: "run" | "submit"
  /** Free-run only: hidden cases exist but were not executed by this path. */
  hiddenNotRun: number
}) {
  const [tab, setTab] = useState<Tab>("cases")

  const visible = data.results.filter((result) => result.isHidden !== true)
  const hidden = data.results.filter((result) => result.isHidden === true)
  const hiddenPassed = hidden.filter((result) => result.passed).length
  const casesWithOutput = visible.filter((result) => result.stdout || result.stderr)

  return (
    <div className="rounded-lg border border-border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={TEST_RUN_STATE_TO_STATUS[data.status]} dot />
          <span className="text-sm">
            <span className="font-mono tabular-nums">{data.passedCount}</span> /{" "}
            <span className="font-mono tabular-nums">{data.totalCount}</span> cases passed
          </span>
          <Badge variant="secondary">
            {kind === "run" ? "Sample run · not counted" : "Submission · counted"}
          </Badge>
        </div>
        <span className="font-mono text-xs text-muted-foreground">
          {formatDuration(data.runtimeMs)}
        </span>
      </div>

      <div
        role="tablist"
        aria-label="Run output"
        className="flex gap-1 border-b border-border px-2"
      >
        {TABS.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={cn(
              "border-b-2 px-2.5 py-2 text-sm transition-colors",
              tab === value
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {TAB_LABELS[value]}
            {value === "cases" && data.results.length > 0 && (
              <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                {visible.length}
              </span>
            )}
            {value === "summary" && hidden.length + hiddenNotRun > 0 && (
              <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                {hidden.length + hiddenNotRun} hidden
              </span>
            )}
          </button>
        ))}
      </div>

      <div role="tabpanel" className="p-3">
        {tab === "console" && (
          <div className="space-y-3">
            <MetricRow
              label="Runtime"
              value={<span className="font-mono">{formatDuration(data.runtimeMs)}</span>}
            />
            {data.timedOut && (
              <p className="text-sm text-destructive">
                The run exceeded its wall-clock limit and was killed.
              </p>
            )}
            {data.memoryExceeded && (
              <p className="text-sm text-destructive">
                The run exceeded its memory limit and was killed.
              </p>
            )}
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
            {!data.stdout && !data.stderr && casesWithOutput.length === 0 && (
              <p className="text-sm text-muted-foreground">No console output was captured.</p>
            )}
          </div>
        )}

        {tab === "cases" && (
          <div className="space-y-3">
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
              <p className="rounded-md border border-dashed border-border p-2.5 text-sm text-muted-foreground">
                <span className="font-mono tabular-nums">{hiddenPassed}</span> of{" "}
                <span className="font-mono tabular-nums">{hidden.length}</span> hidden cases passed.
                Hidden cases show only pass/fail — their input and expected output are not returned
                to students.
              </p>
            )}
            {hiddenNotRun > 0 && (
              <p className="rounded-md border border-dashed border-border p-2.5 text-sm text-muted-foreground">
                <span className="font-mono tabular-nums">{hiddenNotRun}</span> hidden{" "}
                {hiddenNotRun === 1 ? "case is" : "cases are"} graded only on Submit and never run
                by a sample run.
              </p>
            )}
          </div>
        )}

        {tab === "summary" && (
          <dl className="grid gap-2 sm:grid-cols-2">
            <MetricRow
              label="Cases passed"
              value={
                <span className="font-mono tabular-nums">
                  {data.passedCount} / {data.totalCount}
                </span>
              }
            />
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
              hint="Cases the sandbox reported a result for"
            />
            <MetricRow
              label="Visible sample cases"
              value={<span className="font-mono tabular-nums">{visible.length}</span>}
            />
            <MetricRow
              label="Hidden cases"
              value={
                <span className="font-mono tabular-nums">
                  {hidden.length + hiddenNotRun}
                  {hidden.length > 0 ? ` (${hiddenPassed} passed)` : ""}
                </span>
              }
              hint={
                hidden.length > 0
                  ? "Pass/fail only; detail is never sent to students"
                  : "Never run by a sample run; graded on Submit"
              }
            />
          </dl>
        )}
      </div>
    </div>
  )
}

export function StudentCodeSubmissionEditor({ task }: Props) {
  const router = useRouter()
  const [source, setSource] = useState("")
  const [busy, setBusy] = useState<Busy>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [view, setView] = useState<RunView | null>(null)

  const hasSource = source.trim().length > 0

  async function runSamples() {
    setBusy("run")
    setMessage(null)
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
      // The server owns the Runs/Results tabs, so re-render it to include this run.
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

  return (
    <div className="grid gap-4">
      <div className="space-y-0.5">
        <MetricRow
          label="Test cases in this task"
          value={<span className="font-mono tabular-nums">{task.testCaseCount}</span>}
          hint="Active cases only; drafts and hidden-case detail are never shown."
        />
        <MetricRow
          label="Runs used"
          value={
            <span className="font-mono tabular-nums">
              {task.submissionsUsed} / {task.maxSubmissions}
            </span>
          }
          hint="Sample runs are free; only submissions count against the cap."
        />
      </div>

      {!task.canSubmit && task.blockedReason && (
        <p role="alert" className="text-sm text-destructive">
          {task.blockedReason}
        </p>
      )}

      <div className="grid gap-1.5">
        <div className="flex items-center gap-2">
          <Code2 className="size-4 text-muted-foreground" aria-hidden />
          <label htmlFor="student-code-source" className="text-sm font-medium">
            Your solution
          </label>
        </div>
        <p className="text-sm text-muted-foreground">
          The starter code is shown until you type over it. <strong>Run samples</strong> executes
          the visible sample cases only and costs nothing; <strong>Submit</strong> runs every active
          case and uses one of your {task.maxSubmissions} submissions.
        </p>
        <div
          id="student-code-source"
          className="overflow-hidden rounded-md border border-input bg-background"
        >
          <MonacoEditor
            height="16rem"
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

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
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
        <Badge variant="secondary">
          {task.submissionsUsed} / {task.maxSubmissions} submissions used
        </Badge>
      </div>

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

      {view?.kind === "run" && (
        <RunPanel data={view.result} kind="run" hiddenNotRun={view.result.hiddenCount} />
      )}
      {view?.kind === "submit" && <RunPanel data={view.run} kind="submit" hiddenNotRun={0} />}
    </div>
  )
}

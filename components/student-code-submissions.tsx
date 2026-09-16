"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Send } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CodeBlock } from "@/components/ui/code-block"
import { MetricRow } from "@/components/ui/metric-row"
import { StatusPill } from "@/components/ui/status-pill"
import type { StudentCodeTask, TestRunResponse } from "@/lib/contracts/code-eval"
import { trimNumber } from "@/lib/format"

/**
 * The code editor and the submit button — the only way a student hands in code,
 * which is why the port keeps this as a Client Component while everything around
 * it (task picker, KPI tiles, brief, per-test results, runs) is rendered by the
 * Server Component from server-fetched data.
 *
 * This island makes exactly one request, the `POST` that starts a sandboxed run.
 * It no longer refetches the task's runs on selection, and it does not own the
 * runs list: a successful submit calls `router.refresh()`, which re-renders the
 * Server Component so the runs and per-test tables pick up the new evidence. The
 * returned run is also rendered inline so the student sees the outcome without
 * leaving the editor.
 *
 * The starter code stays a `placeholder`, exactly as before the port: a value
 * would make unchanged starter code submittable and spend a run from the cap.
 */

type Props = { task: StudentCodeTask }

export function StudentCodeSubmissionEditor({ task }: Props) {
  const router = useRouter()
  const [source, setSource] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [returned, setReturned] = useState<TestRunResponse | null>(null)

  async function submit() {
    setBusy(true)
    setMessage(null)
    setError(null)
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
      setReturned(body.run)
      setMessage(
        `Run complete: ${body.run.passedCount}/${body.run.totalCount} tests passed. ` +
          "Results are evidence for your teacher, not a published grade.",
      )
      // Re-render the Server Component so the runs and results tables include
      // this run. Not a client-side data fetch — the server already owns them.
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4">
      <div className="space-y-0.5">
        <MetricRow
          label="Test cases in this task"
          value={<span className="font-mono tabular-nums">{task.testCaseCount}</span>}
          hint="The suite runs server-side and is not shown case by case."
        />
        <MetricRow
          label="Runs used"
          value={
            <span className="font-mono tabular-nums">
              {task.submissionsUsed} / {task.maxSubmissions}
            </span>
          }
          hint="Every sandboxed run counts, whether it passes or not."
        />
      </div>

      {!task.canSubmit && task.blockedReason && (
        <p role="alert" className="text-sm text-destructive">
          {task.blockedReason}
        </p>
      )}

      <div className="grid gap-1.5">
        <label htmlFor="student-code-source" className="text-sm font-medium">
          Your solution
        </label>
        <p className="text-sm text-muted-foreground">
          The starter code is shown in the editor until you type over it. Runs are capped and
          sandboxed; nothing here publishes a mark.
        </p>
        <textarea
          id="student-code-source"
          className="min-h-64 w-full rounded-md border border-input bg-background p-3 font-mono text-sm"
          aria-label={`Code submission for ${task.assessmentTitle}`}
          placeholder={task.starterCode ?? "Write your solution here"}
          value={source}
          onChange={(event) => setSource(event.target.value)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={busy || !task.canSubmit || !source.trim()} onClick={() => void submit()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          <span className="ml-1">Submit for evaluation</span>
        </Button>
        <Badge variant="secondary">
          {task.submissionsUsed} / {task.maxSubmissions} runs used
        </Badge>
      </div>

      {message && (
        <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {returned && returned.results.length > 0 && (
        <div className="grid gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            Per-test results from this run
          </p>
          <ul className="grid gap-2">
            {returned.results.map((result) => (
              <li
                key={result.testCaseId}
                className="rounded border border-border/70 bg-muted/30 p-2 text-xs"
              >
                <StatusPill status={result.passed ? "passed" : "failed"} dot />
                <span className="ml-2 font-medium">{result.name}</span>
                <span className="ml-2 text-muted-foreground">
                  {result.category} · {trimNumber(result.earnedPoints)}/{trimNumber(result.points)}{" "}
                  pts
                </span>
                {result.message && <p className="mt-1 text-muted-foreground">{result.message}</p>}
                {result.stderr && (
                  <CodeBlock dense wrap maxHeight="sm" className="mt-1">
                    {result.stderr}
                  </CodeBlock>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

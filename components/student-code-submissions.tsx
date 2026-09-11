"use client"

import { useState } from "react"
import { Loader2, Send } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { StudentCodeTask, TestRunResponse } from "@/lib/contracts/code-eval"

/**
 * Student code-submission workspace.
 *
 * The student only ever sees their own tasks and runs. Submission limits and
 * enrollment are enforced server-side; the client merely reflects what the
 * server reports.
 */

type Props = { initialTasks: StudentCodeTask[] }

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  })
  const body: { success?: boolean; message?: string } = await response.json().catch(() => ({}))
  if (!response.ok || body.success === false) {
    throw new Error(body.message ?? "Request failed.")
  }
  return body as T
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "PASSED") return "default"
  if (status === "FAILED") return "destructive"
  return "secondary"
}

export function StudentCodeSubmissions({ initialTasks }: Props) {
  const [tasks, setTasks] = useState(initialTasks)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [source, setSource] = useState("")
  const [runs, setRuns] = useState<TestRunResponse[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const selected = tasks.find((task) => task.assessmentId === selectedId) ?? null

  async function refreshTasks() {
    const body = await call<{ success: true; tasks: StudentCodeTask[] }>(
      "/api/student/code-submissions",
    )
    setTasks(body.tasks)
  }

  async function selectTask(assessmentId: string) {
    setSelectedId(assessmentId)
    setMessage(null)
    setError(null)
    setBusy(true)
    try {
      const body = await call<{ success: true; runs: TestRunResponse[] }>(
        `/api/student/code-submissions?assessmentId=${encodeURIComponent(assessmentId)}`,
      )
      setRuns(body.runs)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed.")
    } finally {
      setBusy(false)
    }
  }

  async function submit() {
    if (!selected) return
    setBusy(true)
    setMessage(null)
    setError(null)
    try {
      const body = await call<{ success: true; run: TestRunResponse }>(
        "/api/student/code-submissions",
        {
          method: "POST",
          body: JSON.stringify({ assessmentId: selected.assessmentId, sourceCode: source }),
        },
      )
      setRuns((prev) => [body.run, ...prev])
      setMessage(`Run complete: ${body.run.passedCount}/${body.run.totalCount} tests passed.`)
      await refreshTasks()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Code tasks</CardTitle>
          <p className="text-xs text-muted-foreground">
            Your code runs in an isolated container. Results are evidence for your teacher; they do
            not publish a grade.
          </p>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {tasks.length === 0 && (
            <p className="text-sm text-muted-foreground">No code tasks are assigned to you yet.</p>
          )}
          {tasks.map((task) => (
            <Button
              key={task.assessmentId}
              variant={task.assessmentId === selectedId ? "default" : "outline"}
              size="sm"
              onClick={() => void selectTask(task.assessmentId)}
            >
              {task.assessmentTitle}
              <Badge variant="secondary" className="ml-2">
                {task.submissionsUsed}/{task.maxSubmissions} runs
              </Badge>
            </Button>
          ))}
        </CardContent>
      </Card>

      {message && (
        <p
          role="status"
          className="text-sm text-emerald-700 [@media(prefers-color-scheme:dark)]:text-emerald-400"
        >
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {selected && (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {selected.assessmentTitle}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {selected.language === "python" ? "Python 3.12" : "Node.js 22"} ·{" "}
                  {selected.testCaseCount} test cases · due{" "}
                  {new Date(selected.dueDate).toLocaleString()}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              {selected.instructions && (
                <p className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                  {selected.instructions}
                </p>
              )}
              {!selected.canSubmit && (
                <p className="text-sm text-destructive">{selected.blockedReason}</p>
              )}
              <textarea
                className="min-h-64 w-full rounded-md border border-input bg-background p-3 font-mono text-sm"
                aria-label={`Code submission for ${selected.assessmentTitle}`}
                placeholder={selected.starterCode ?? "Write your solution here"}
                value={source}
                onChange={(event) => setSource(event.target.value)}
              />
              <div>
                <Button
                  disabled={busy || !selected.canSubmit || !source.trim()}
                  onClick={() => void submit()}
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                  <span className="ml-1">Submit for evaluation</span>
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Your runs</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              {runs.map((testRun) => (
                <div key={testRun.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">
                      {testRun.passedCount}/{testRun.totalCount} passed · {testRun.earnedPoints}/
                      {testRun.maxPoints} pts
                    </span>
                    <Badge variant={statusVariant(testRun.status)}>{testRun.status}</Badge>
                  </div>
                  {testRun.timedOut && (
                    <p className="mt-1 text-xs text-destructive">
                      Stopped by the time limit before all tests completed.
                    </p>
                  )}
                  {testRun.memoryExceeded && (
                    <p className="mt-1 text-xs text-destructive">Stopped by the memory limit.</p>
                  )}
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-muted-foreground">
                      Per-test results
                    </summary>
                    <div className="mt-2 grid gap-2">
                      {testRun.results.map((result) => (
                        <div
                          key={result.testCaseId}
                          className="rounded border border-border/70 bg-muted/30 p-2 text-xs"
                        >
                          <span
                            className={
                              result.passed
                                ? "text-emerald-700 [@media(prefers-color-scheme:dark)]:text-emerald-400"
                                : "text-destructive"
                            }
                          >
                            {result.passed ? "PASS" : "FAIL"}
                          </span>
                          <span className="ml-2 font-medium">{result.name}</span>
                          <span className="ml-2 text-muted-foreground">{result.category}</span>
                          <p className="mt-1 text-muted-foreground">{result.message}</p>
                          {result.stderr && (
                            <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap text-destructive">
                              {result.stderr}
                            </pre>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              ))}
              {runs.length === 0 && (
                <p className="text-sm text-muted-foreground">No runs yet for this task.</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

"use client"

import { useState } from "react"
import { Loader2, Play, Save, Sparkles, Upload } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type {
  CodeTaskDetailResponse,
  CodeTaskSummary,
  SimilarityPair,
  TestCaseResponse,
  TestRunResponse,
} from "@/lib/contracts/code-eval"

/**
 * Teacher code-task workspace.
 *
 * Server-owned data arrives as props; every action re-validates server-side
 * (role + object ownership). Test runs are presented as evidence with per-test
 * output, and there is deliberately no "publish grade" control here — grading
 * stays in the review queue.
 */

type Props = { initialTasks: CodeTaskSummary[] }

type ConfigState = {
  language: "python" | "javascript"
  instructions: string
  starterCode: string
  timeLimitMs: string
  memoryLimitMb: string
  maxSubmissions: string
}

const EMPTY_CONFIG: ConfigState = {
  language: "python",
  instructions: "",
  starterCode: "",
  timeLimitMs: "5000",
  memoryLimitMb: "256",
  maxSubmissions: "10",
}

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

export function TeacherCodeTasks({ initialTasks }: Props) {
  const [tasks, setTasks] = useState(initialTasks)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<CodeTaskDetailResponse | null>(null)
  const [runs, setRuns] = useState<TestRunResponse[]>([])
  const [pairs, setPairs] = useState<SimilarityPair[]>([])
  const [config, setConfig] = useState<ConfigState>(EMPTY_CONFIG)
  const [newTest, setNewTest] = useState({
    name: "",
    category: "input-output",
    input: "",
    expectedOutput: "",
    points: "1",
  })
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const selected = tasks.find((task) => task.assessmentId === selectedId) ?? null

  async function refreshDetail(assessmentId: string) {
    const detailBody = await call<{
      success: true
      task: CodeTaskDetailResponse["task"]
      testCases: TestCaseResponse[]
    }>(`/api/teacher/code-tasks/${assessmentId}`).catch(() => null)
    setDetail(detailBody ? { task: detailBody.task, testCases: detailBody.testCases } : null)
    if (detailBody) {
      setConfig({
        language: detailBody.task.language,
        instructions: detailBody.task.instructions ?? "",
        starterCode: detailBody.task.starterCode ?? "",
        timeLimitMs: String(detailBody.task.timeLimitMs),
        memoryLimitMb: String(detailBody.task.memoryLimitMb),
        maxSubmissions: String(detailBody.task.maxSubmissions),
      })
    } else {
      setConfig(EMPTY_CONFIG)
    }
  }

  async function refreshRuns(assessmentId: string) {
    const body = await call<{ success: true; runs: TestRunResponse[] }>(
      `/api/teacher/code-tasks/${assessmentId}/runs`,
    ).catch(() => null)
    setRuns(body?.runs ?? [])
  }

  async function refreshSimilarity(assessmentId: string) {
    const body = await call<{ success: true; pairs: SimilarityPair[] }>(
      `/api/teacher/code-tasks/${assessmentId}/similarity`,
    ).catch(() => null)
    setPairs(body?.pairs ?? [])
  }

  async function selectTask(assessmentId: string) {
    setSelectedId(assessmentId)
    setMessage(null)
    setError(null)
    setBusy(true)
    try {
      await Promise.all([
        refreshDetail(assessmentId),
        refreshRuns(assessmentId),
        refreshSimilarity(assessmentId),
      ])
    } finally {
      setBusy(false)
    }
  }

  async function reloadTasks() {
    const body = await call<{ success: true; tasks: CodeTaskSummary[] }>("/api/teacher/code-tasks")
    setTasks(body.tasks)
  }

  async function run(action: () => Promise<string>) {
    setBusy(true)
    setMessage(null)
    setError(null)
    try {
      setMessage(await action())
      if (selectedId) {
        await refreshDetail(selectedId)
        await refreshRuns(selectedId)
        await reloadTasks()
      }
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
            Only CODE assessments you own appear here. Student code runs in an isolated Docker
            container (no network, capped CPU/memory/PIDs, wall-clock kill).
          </p>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {tasks.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No CODE assessments yet. Create one on the Assignments page first.
            </p>
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
                {task.testCaseCount - task.draftTestCaseCount} active
              </Badge>
              {task.draftTestCaseCount > 0 && (
                <Badge variant="outline" className="ml-1">
                  {task.draftTestCaseCount} draft
                </Badge>
              )}
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
              <CardTitle className="text-base">Task configuration</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="instructions">Instructions</Label>
                <textarea
                  id="instructions"
                  className="mt-1 min-h-20 w-full rounded-md border border-input bg-background p-2 text-sm"
                  value={config.instructions}
                  onChange={(event) =>
                    setConfig((prev) => ({ ...prev, instructions: event.target.value }))
                  }
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="starter">Starter code</Label>
                <textarea
                  id="starter"
                  className="mt-1 min-h-20 w-full rounded-md border border-input bg-background p-2 font-mono text-sm"
                  value={config.starterCode}
                  onChange={(event) =>
                    setConfig((prev) => ({ ...prev, starterCode: event.target.value }))
                  }
                />
              </div>
              <div>
                <Label htmlFor="language">Language</Label>
                <select
                  id="language"
                  className="mt-1 w-full rounded-md border border-input bg-background p-2 text-sm"
                  value={config.language}
                  onChange={(event) =>
                    setConfig((prev) => ({
                      ...prev,
                      language: event.target.value === "javascript" ? "javascript" : "python",
                    }))
                  }
                >
                  <option value="python">Python 3.12</option>
                  <option value="javascript">Node.js 22</option>
                </select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label htmlFor="time">Time (ms)</Label>
                  <Input
                    id="time"
                    value={config.timeLimitMs}
                    onChange={(event) =>
                      setConfig((prev) => ({ ...prev, timeLimitMs: event.target.value }))
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="memory">Memory (MB)</Label>
                  <Input
                    id="memory"
                    value={config.memoryLimitMb}
                    onChange={(event) =>
                      setConfig((prev) => ({ ...prev, memoryLimitMb: event.target.value }))
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="cap">Max runs</Label>
                  <Input
                    id="cap"
                    value={config.maxSubmissions}
                    onChange={(event) =>
                      setConfig((prev) => ({ ...prev, maxSubmissions: event.target.value }))
                    }
                  />
                </div>
              </div>
              <div className="sm:col-span-2">
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await call("/api/teacher/code-tasks", {
                        method: "POST",
                        body: JSON.stringify({
                          assessmentId: selected.assessmentId,
                          language: config.language,
                          instructions: config.instructions.trim() || null,
                          starterCode: config.starterCode.trim() || null,
                          timeLimitMs: Number(config.timeLimitMs),
                          memoryLimitMb: Number(config.memoryLimitMb),
                          maxSubmissions: Number(config.maxSubmissions),
                        }),
                      })
                      return "Code task saved."
                    })
                  }
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  <span className="ml-1">Save task</span>
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between pb-3">
              <CardTitle className="text-base">Test cases</CardTitle>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const body = await call<{ testCases: TestCaseResponse[] }>(
                        `/api/teacher/code-tasks/${selected.assessmentId}/generate-tests`,
                        { method: "POST", body: JSON.stringify({ count: 3 }) },
                      )
                      return `${body.testCases.length} draft test cases generated.`
                    })
                  }
                >
                  <Sparkles className="size-4" />
                  <span className="ml-1">Generate drafts</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || (detail?.task.draftTestCaseCount ?? 0) === 0}
                  onClick={() =>
                    void run(async () => {
                      const body = await call<{ published: TestCaseResponse[] }>(
                        `/api/teacher/code-tasks/${selected.assessmentId}/publish-tests`,
                        { method: "POST", body: JSON.stringify({}) },
                      )
                      return `${body.published.length} test cases published.`
                    })
                  }
                >
                  <Upload className="size-4" />
                  <span className="ml-1">Publish drafts</span>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="grid gap-2">
              {(detail?.testCases ?? []).map((testCase) => (
                <div
                  key={testCase.id}
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <span>
                    <span className="font-medium">{testCase.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {testCase.categoryLabel} · {testCase.points} pt
                    </span>
                  </span>
                  <Badge variant={testCase.status === "draft" ? "outline" : "secondary"}>
                    {testCase.status}
                  </Badge>
                </div>
              ))}
              {(detail?.testCases.length ?? 0) === 0 && (
                <p className="text-sm text-muted-foreground">
                  No test cases yet. Add one below or generate drafts.
                </p>
              )}

              <div className="mt-2 grid gap-2 rounded-lg border border-dashed border-border p-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="test-name">Name</Label>
                  <Input
                    id="test-name"
                    value={newTest.name}
                    onChange={(event) =>
                      setNewTest((prev) => ({ ...prev, name: event.target.value }))
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="test-category">Category</Label>
                  <select
                    id="test-category"
                    className="mt-1 w-full rounded-md border border-input bg-background p-2 text-sm"
                    value={newTest.category}
                    onChange={(event) =>
                      setNewTest((prev) => ({ ...prev, category: event.target.value }))
                    }
                  >
                    <option value="input-output">input-output</option>
                    <option value="unit">unit</option>
                    <option value="structure">structure</option>
                    <option value="code-quality">code-quality</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="test-input">Input</Label>
                  <textarea
                    id="test-input"
                    className="mt-1 min-h-16 w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
                    value={newTest.input}
                    onChange={(event) =>
                      setNewTest((prev) => ({ ...prev, input: event.target.value }))
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="test-expected">Expected output</Label>
                  <textarea
                    id="test-expected"
                    className="mt-1 min-h-16 w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
                    value={newTest.expectedOutput}
                    onChange={(event) =>
                      setNewTest((prev) => ({ ...prev, expectedOutput: event.target.value }))
                    }
                  />
                </div>
                <div className="sm:col-span-2">
                  <Button
                    size="sm"
                    disabled={busy || !newTest.name.trim()}
                    onClick={() =>
                      void run(async () => {
                        await call(`/api/teacher/code-tasks/${selected.assessmentId}/test-cases`, {
                          method: "POST",
                          body: JSON.stringify({
                            name: newTest.name.trim(),
                            category: newTest.category,
                            input: newTest.input || null,
                            expectedOutput: newTest.expectedOutput || null,
                            points: Number(newTest.points) || 1,
                          }),
                        })
                        setNewTest({
                          name: "",
                          category: "input-output",
                          input: "",
                          expectedOutput: "",
                          points: "1",
                        })
                        return "Test case added."
                      })
                    }
                  >
                    Add test case
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Submission evidence</CardTitle>
              <p className="text-xs text-muted-foreground">
                Per-test results, not a bare score. A run never publishes a grade.
              </p>
            </CardHeader>
            <CardContent className="grid gap-3">
              {runs.map((testRun) => (
                <div key={testRun.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {testRun.studentName ?? testRun.studentId}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {testRun.passedCount}/{testRun.totalCount} passed · {testRun.earnedPoints}/
                        {testRun.maxPoints} pts
                      </span>
                    </span>
                    <Badge variant={statusVariant(testRun.status)}>{testRun.status}</Badge>
                  </div>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-muted-foreground">
                      Per-test output
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
                          <span className="ml-2 text-muted-foreground">
                            {result.category} · {result.earnedPoints}/{result.points}
                          </span>
                          <p className="mt-1 text-muted-foreground">{result.message}</p>
                          {result.stdout && (
                            <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap">
                              {result.stdout}
                            </pre>
                          )}
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
                <p className="text-sm text-muted-foreground">No submissions yet.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between pb-3">
              <CardTitle className="text-base">Cohort similarity</CardTitle>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const body = await call<{ pairs: SimilarityPair[] }>(
                      `/api/teacher/code-tasks/${selected.assessmentId}/similarity`,
                      { method: "POST", body: JSON.stringify({}) },
                    )
                    setPairs(body.pairs)
                    const flagged = body.pairs.filter((pair) => pair.verdict === "FLAGGED").length
                    return `Similarity scan complete. ${flagged} pair(s) flagged for review.`
                  })
                }
              >
                <Play className="size-4" />
                <span className="ml-1">Scan cohort</span>
              </Button>
            </CardHeader>
            <CardContent className="grid gap-2">
              {pairs
                .filter((pair) => pair.verdict === "FLAGGED")
                .map((pair) => (
                  <div
                    key={pair.id}
                    className="flex items-center justify-between rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"
                  >
                    <span>
                      {pair.studentName} ↔ {pair.comparedStudentName}
                      <span className="ml-2 text-xs text-muted-foreground">
                        Jaccard {pair.similarity.toFixed(3)}
                      </span>
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await call(
                            `/api/teacher/code-tasks/${selected.assessmentId}/similarity/${pair.id}`,
                            { method: "PATCH", body: JSON.stringify({ verdict: "CLEARED" }) },
                          )
                          await refreshSimilarity(selected.assessmentId)
                          return "Pair cleared."
                        })
                      }
                    >
                      Clear
                    </Button>
                  </div>
                ))}
              {pairs.filter((pair) => pair.verdict === "FLAGGED").length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No flagged pairs. The check flags for human review; it never decides.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Normalized-token shingling / Jaccard over each student&apos;s latest submission.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

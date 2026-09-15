"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Play, Save, Sparkles, Upload } from "lucide-react"

import { Button } from "@/components/ui/button"
import { DataTable, type Column } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SectionCard } from "@/components/ui/section-card"
import { StatusPill, type StatusKey } from "@/components/ui/status-pill"
import { SUCCESS_TEXT } from "@/components/ui/tone"
import type { CodeTaskResponse, SimilarityPair } from "@/lib/contracts/code-eval"
import { formatConfidence, formatDateTime } from "@/lib/format"

/**
 * The mutating half of the teacher code-task workspace.
 *
 * The page itself is a Server Component: the task list, the selected task's
 * detail, its runs and its similarity pairs are all fetched on the server and
 * arrive as props. Only the actions that **change** something live here —
 * upsert the task, add a test case, generate drafts, publish drafts, scan the
 * cohort, record a similarity verdict.
 *
 * After a write the component calls `router.refresh()`, which re-renders the
 * Server Component and streams new props down. That deliberately replaces the
 * old three-fetch-on-select client path (`docs/plans/wave-1.md` §3,
 * `docs/plans/mockup-to-backend.md` §2) rather than adding a fourth fetch.
 *
 * Every action re-validates server-side (role + object ownership); nothing here
 * is a security boundary.
 */

type ApiEnvelope = { success?: boolean; message?: string }

async function request<T>(url: string, method: "POST" | "PATCH", body: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const payload: ApiEnvelope = await response.json().catch(() => ({}))
  if (!response.ok || payload.success === false) {
    throw new Error(payload.message ?? "Request failed.")
  }
  return payload as T
}

/** Shared busy / success / failure state for one action group. */
function useTaskAction() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(action: () => Promise<string>) {
    setBusy(true)
    setMessage(null)
    setError(null)
    try {
      setMessage(await action())
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed.")
    } finally {
      setBusy(false)
    }
  }

  return { busy, message, error, run }
}

function Feedback({
  busy,
  message,
  error,
}: Pick<ReturnType<typeof useTaskAction>, "busy" | "message" | "error">) {
  return (
    <>
      {message && (
        <p role="status" className={`text-sm ${SUCCESS_TEXT}`}>
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {busy && <span className="sr-only">Working…</span>}
    </>
  )
}

type ConfigState = {
  language: CodeTaskResponse["language"]
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

/**
 * Create or replace the code task attached to the selected assessment.
 *
 * `task` is `null` when the CODE assessment has no code task yet — saving then
 * creates one. The caller keys this component on the assessment id, so
 * switching task remounts the form with that task's values instead of keeping
 * the previous task's edits.
 */
export function CodeTaskSetupForm({
  assessmentId,
  task,
}: {
  assessmentId: string
  task: CodeTaskResponse | null
}) {
  const { busy, message, error, run } = useTaskAction()
  const [config, setConfig] = useState<ConfigState>(() =>
    task
      ? {
          language: task.language,
          instructions: task.instructions ?? "",
          starterCode: task.starterCode ?? "",
          timeLimitMs: String(task.timeLimitMs),
          memoryLimitMb: String(task.memoryLimitMb),
          maxSubmissions: String(task.maxSubmissions),
        }
      : EMPTY_CONFIG,
  )

  return (
    <SectionCard
      title={task ? "Edit task" : "Create the code task"}
      description="Saving replaces the task's configuration. Test cases, runs and similarity checks are untouched."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="task-instructions">Instructions</Label>
          <textarea
            id="task-instructions"
            className="mt-1 min-h-20 w-full rounded-md border border-input bg-background p-2 text-sm"
            value={config.instructions}
            onChange={(event) =>
              setConfig((prev) => ({ ...prev, instructions: event.target.value }))
            }
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="task-starter">Starter code</Label>
          <textarea
            id="task-starter"
            className="mt-1 min-h-20 w-full rounded-md border border-input bg-background p-2 font-mono text-sm"
            value={config.starterCode}
            onChange={(event) =>
              setConfig((prev) => ({ ...prev, starterCode: event.target.value }))
            }
          />
        </div>
        <div>
          <Label htmlFor="task-language">Language</Label>
          <select
            id="task-language"
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
            <Label htmlFor="task-time">Time (ms)</Label>
            <Input
              id="task-time"
              value={config.timeLimitMs}
              onChange={(event) =>
                setConfig((prev) => ({ ...prev, timeLimitMs: event.target.value }))
              }
            />
          </div>
          <div>
            <Label htmlFor="task-memory">Memory (MB)</Label>
            <Input
              id="task-memory"
              value={config.memoryLimitMb}
              onChange={(event) =>
                setConfig((prev) => ({ ...prev, memoryLimitMb: event.target.value }))
              }
            />
          </div>
          <div>
            <Label htmlFor="task-cap">Max runs</Label>
            <Input
              id="task-cap"
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
                await request("/api/teacher/code-tasks", "POST", {
                  assessmentId,
                  language: config.language,
                  instructions: config.instructions.trim() || null,
                  starterCode: config.starterCode.trim() || null,
                  timeLimitMs: Number(config.timeLimitMs),
                  memoryLimitMb: Number(config.memoryLimitMb),
                  maxSubmissions: Number(config.maxSubmissions),
                })
                return "Code task saved."
              })
            }
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            <span className="ml-1">Save task</span>
          </Button>
        </div>
        <div className="sm:col-span-2">
          <Feedback busy={busy} message={message} error={error} />
        </div>
      </div>
    </SectionCard>
  )
}

const TEST_CATEGORIES = ["input-output", "unit", "structure", "code-quality"] as const

/** Generate drafts, publish them, and add a hand-authored (immediately active) case. */
export function TestCaseActions({
  assessmentId,
  draftCount,
}: {
  assessmentId: string
  draftCount: number
}) {
  const { busy, message, error, run } = useTaskAction()
  const [draft, setDraft] = useState({
    name: "",
    category: "input-output",
    input: "",
    expectedOutput: "",
    points: "1",
  })

  return (
    <SectionCard
      title="Author test cases"
      description={
        draftCount > 0
          ? `${draftCount} generated ${draftCount === 1 ? "draft is" : "drafts are"} waiting for publication. Drafts are never run and never shown to students.`
          : "Generated cases stay drafts until you publish them. Hand-authored cases are active immediately."
      }
    >
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const body = await request<{ testCases: unknown[] }>(
                `/api/teacher/code-tasks/${assessmentId}/generate-tests`,
                "POST",
                { count: 3 },
              )
              return `${body.testCases.length} draft test cases generated.`
            })
          }
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          <span className="ml-1">Generate drafts</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || draftCount === 0}
          onClick={() =>
            void run(async () => {
              const body = await request<{ published: unknown[] }>(
                `/api/teacher/code-tasks/${assessmentId}/publish-tests`,
                "POST",
                {},
              )
              return `${body.published.length} test cases published.`
            })
          }
        >
          <Upload className="size-4" />
          <span className="ml-1">Publish drafts</span>
        </Button>
      </div>

      <div className="mt-3">
        <Feedback busy={busy} message={message} error={error} />
      </div>

      <div className="mt-3 grid gap-3 rounded-lg border border-dashed border-border p-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="case-name">Name</Label>
          <Input
            id="case-name"
            value={draft.name}
            onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
          />
        </div>
        <div>
          <Label htmlFor="case-category">Category</Label>
          <select
            id="case-category"
            className="mt-1 w-full rounded-md border border-input bg-background p-2 text-sm"
            value={draft.category}
            onChange={(event) => setDraft((prev) => ({ ...prev, category: event.target.value }))}
          >
            {TEST_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="case-input">Input</Label>
          <textarea
            id="case-input"
            className="mt-1 min-h-16 w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
            value={draft.input}
            onChange={(event) => setDraft((prev) => ({ ...prev, input: event.target.value }))}
          />
        </div>
        <div>
          <Label htmlFor="case-expected">Expected output</Label>
          <textarea
            id="case-expected"
            className="mt-1 min-h-16 w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
            value={draft.expectedOutput}
            onChange={(event) =>
              setDraft((prev) => ({ ...prev, expectedOutput: event.target.value }))
            }
          />
        </div>
        <div>
          <Label htmlFor="case-points">Points</Label>
          <Input
            id="case-points"
            value={draft.points}
            onChange={(event) => setDraft((prev) => ({ ...prev, points: event.target.value }))}
          />
        </div>
        <div className="flex items-end sm:col-span-2">
          <Button
            size="sm"
            disabled={busy || !draft.name.trim()}
            onClick={() =>
              void run(async () => {
                await request(`/api/teacher/code-tasks/${assessmentId}/test-cases`, "POST", {
                  name: draft.name.trim(),
                  category: draft.category,
                  input: draft.input || null,
                  expectedOutput: draft.expectedOutput || null,
                  points: Number(draft.points) || 1,
                })
                setDraft({
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
    </SectionCard>
  )
}

/**
 * Verdicts and similarity pills.
 *
 * `StatusPill`'s vocabulary has no "cleared" key, so a cleared pair uses the
 * `active` tone with an explicit label — colour alone never carries the meaning.
 */
const VERDICT_STATUS: Record<SimilarityPair["verdict"], StatusKey> = {
  PENDING: "pending",
  FLAGGED: "flagged",
  CLEARED: "active",
}

const VERDICT_LABEL: Record<SimilarityPair["verdict"], string> = {
  PENDING: "Pending",
  FLAGGED: "Flagged",
  CLEARED: "Cleared",
}

/** Scan the cohort, and record the human verdict on each pair. */
export function SimilarityReview({
  assessmentId,
  pairs,
  threshold,
}: {
  assessmentId: string
  pairs: SimilarityPair[]
  threshold: number
}) {
  const { busy, message, error, run } = useTaskAction()
  const flagged = pairs.filter((pair) => pair.verdict === "FLAGGED").length

  const columns: Column<SimilarityPair>[] = [
    {
      id: "pair",
      header: "Submission pair",
      cell: (pair) => (
        <span className="whitespace-normal">
          {pair.studentName} ↔ {pair.comparedStudentName}
        </span>
      ),
    },
    {
      id: "similarity",
      header: "Similarity",
      align: "right",
      cell: (pair) => (
        <span className="font-mono tabular-nums">{formatConfidence(pair.similarity)}</span>
      ),
    },
    {
      id: "verdict",
      header: "Verdict",
      cell: (pair) => (
        <StatusPill status={VERDICT_STATUS[pair.verdict]} label={VERDICT_LABEL[pair.verdict]} dot />
      ),
    },
    {
      id: "checked",
      header: "Checked",
      hideBelow: "lg",
      cell: (pair) => (
        <span className="text-muted-foreground">{formatDateTime(pair.checkedAt)}</span>
      ),
    },
  ]

  async function setVerdict(pair: SimilarityPair, verdict: "FLAGGED" | "CLEARED") {
    await request(`/api/teacher/code-tasks/${assessmentId}/similarity/${pair.id}`, "PATCH", {
      verdict,
    })
    return `${pair.studentName} ↔ ${pair.comparedStudentName} marked ${VERDICT_LABEL[verdict].toLowerCase()}.`
  }

  return (
    <SectionCard
      title="Similarity"
      description={`Pairs at or above a Jaccard score of ${threshold.toFixed(2)} are flagged for review. A flag is a prompt to look, not a finding — ${flagged} of ${pairs.length} ${pairs.length === 1 ? "pair is" : "pairs are"} currently flagged.`}
      action={
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const body = await request<{ pairs: SimilarityPair[] }>(
                `/api/teacher/code-tasks/${assessmentId}/similarity`,
                "POST",
                {},
              )
              const count = body.pairs.filter((pair) => pair.verdict === "FLAGGED").length
              return `Similarity scan complete. ${count} ${count === 1 ? "pair" : "pairs"} flagged for review.`
            })
          }
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
          <span className="ml-1">Scan cohort</span>
        </Button>
      }
    >
      <Feedback busy={busy} message={message} error={error} />

      <DataTable
        caption="Similarity checks"
        columns={columns}
        rows={pairs}
        getRowId={(pair) => pair.id}
        rowActions={(pair) => (
          <div className="flex justify-end gap-1">
            {pair.verdict !== "CLEARED" && (
              <Button
                variant="ghost"
                size="xs"
                disabled={busy}
                aria-label={`Clear the flagged pair ${pair.studentName} and ${pair.comparedStudentName}`}
                onClick={() => void run(() => setVerdict(pair, "CLEARED"))}
              >
                Clear
              </Button>
            )}
            {pair.verdict !== "FLAGGED" && (
              <Button
                variant="ghost"
                size="xs"
                disabled={busy}
                aria-label={`Flag the pair ${pair.studentName} and ${pair.comparedStudentName}`}
                onClick={() => void run(() => setVerdict(pair, "FLAGGED"))}
              >
                Flag
              </Button>
            )}
          </div>
        )}
        empty={
          <EmptyState
            title="No comparisons yet"
            description="A scan compares each student's latest submission against every other, so it needs at least two submissions."
          />
        }
      />

      <p className="mt-3 text-xs text-muted-foreground">
        Normalized-token shingling / Jaccard over each student&apos;s latest submission. Similarity
        is never shown to students.
      </p>
    </SectionCard>
  )
}

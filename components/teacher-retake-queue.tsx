"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Check, RotateCcw, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { FilterBar } from "@/components/ui/filter-bar"
import { Input } from "@/components/ui/input"
import { SectionCard } from "@/components/ui/section-card"
import { formatDateTime } from "@/lib/format"
import type { TeacherRetakeRequestRow } from "@/lib/teacher-retake-requests"

/**
 * The teacher's retake-request decision surface (TN-51).
 *
 * Students could already ask for a retake and the API could already decide one, but no screen
 * called it, so requests accumulated unseen. This is that screen: pending first, with the
 * student's own words next to the decision. Approve/Reject posts to the existing per-assessment
 * endpoint (`/api/teacher/assessments/[assessmentId]/retake-requests`), so the decision — and its
 * `AuditLog` row — goes through the same service as any other caller.
 *
 * Deliberately no bulk action: granting a student another graded sitting is a judgement about
 * that student.
 */

const PENDING = "PENDING"

function statusTone(status: TeacherRetakeRequestRow["status"]): string {
  if (status === "APPROVED")
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
  if (status === "REJECTED") return "border-destructive/30 bg-destructive/10 text-destructive"
  return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
}

export function TeacherRetakeQueue({ rows }: { rows: TeacherRetakeRequestRow[] }) {
  const router = useRouter()
  const [statusFilter, setStatusFilter] = useState<"pending" | "all">("pending")
  const [query, setQuery] = useState("")
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return rows.filter((row) => {
      if (statusFilter === "pending" && row.status !== PENDING) return false
      if (needle.length === 0) return true
      return (
        row.studentName.toLowerCase().includes(needle) ||
        row.registerNumber.toLowerCase().includes(needle) ||
        row.assessmentTitle.toLowerCase().includes(needle) ||
        row.courseName.toLowerCase().includes(needle)
      )
    })
  }, [rows, statusFilter, query])

  const pendingCount = rows.filter((row) => row.status === PENDING).length

  async function decide(row: TeacherRetakeRequestRow, approve: boolean) {
    const key = `${row.assessmentId}:${row.studentId}`
    setBusyKey(key)
    setMessage(null)
    setError(null)
    try {
      const response = await fetch(`/api/teacher/assessments/${row.assessmentId}/retake-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: row.studentId,
          approve,
          note: (notes[key] ?? "").trim() || null,
        }),
      })
      const data = (await response.json()) as { message?: string }
      if (!response.ok) {
        setError(data.message ?? "Unable to record the decision.")
        return
      }
      setMessage(
        approve
          ? `${row.studentName} may now retake ${row.assessmentTitle}.`
          : `Retake request for ${row.studentName} rejected.`,
      )
      router.refresh()
    } catch {
      setError("Unable to record the decision.")
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <div className="space-y-6">
      {message && (
        <p
          role="status"
          className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400"
        >
          {message}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/60 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <FilterBar
        searchLabel="Search retake requests"
        searchPlaceholder="Search student, register number, assessment or course…"
        searchValue={query}
        onSearchChange={setQuery}
        resultCount={filtered.length}
        resultNoun="request"
        selects={[
          {
            id: "retake-status",
            label: "Status",
            value: statusFilter,
            options: [
              { value: "pending", label: `Awaiting a decision (${pendingCount})` },
              { value: "all", label: "All requests" },
            ],
            onValueChange: (value) => setStatusFilter(value === "all" ? "all" : "pending"),
          },
        ]}
      />

      {filtered.length === 0 ? (
        <SectionCard title="Retake requests">
          <EmptyState
            icon={RotateCcw}
            title={statusFilter === "pending" ? "No requests awaiting a decision" : "No requests"}
            description="Students can request a retake on an assessment set to the approval policy. Requests appear here."
          />
        </SectionCard>
      ) : (
        <div className="space-y-3">
          {filtered.map((row) => {
            const key = `${row.assessmentId}:${row.studentId}`
            const busy = busyKey === key
            return (
              <Card key={row.id} className="border-border/70 shadow-sm">
                <CardHeader className="border-b border-border/60 bg-muted/15 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="text-base tracking-tight">
                        {row.studentName} · {row.assessmentTitle}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground">
                        {row.registerNumber} · {row.courseCode} · {row.courseName} · asked{" "}
                        {formatDateTime(row.createdAt)}
                      </p>
                    </div>
                    <Badge variant="outline" className={statusTone(row.status)}>
                      {row.status === "PENDING"
                        ? "Awaiting decision"
                        : row.status === "APPROVED"
                          ? "Approved"
                          : "Rejected"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 pt-4">
                  <div className="rounded-md border border-border/70 bg-muted/20 p-3">
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      Student&apos;s request
                    </p>
                    <p className="whitespace-pre-wrap text-sm">
                      {row.requestNote?.trim() || "No reason given."}
                    </p>
                  </div>

                  {row.status === "PENDING" ? (
                    <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto]">
                      <Input
                        value={notes[key] ?? ""}
                        onChange={(event) =>
                          setNotes((prev) => ({ ...prev, [key]: event.target.value }))
                        }
                        placeholder="Decision note (optional)"
                        aria-label={`Decision note for ${row.studentName}`}
                        maxLength={500}
                      />
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void decide(row, true)}
                        disabled={busy}
                      >
                        <Check /> Approve retake
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        onClick={() => void decide(row, false)}
                        disabled={busy}
                      >
                        <X /> Reject
                      </Button>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {row.decidedBy ? `Decided by ${row.decidedBy}` : "Decided"}
                      {row.decidedAt ? ` · ${formatDateTime(row.decidedAt)}` : ""}
                      {row.decisionNote?.trim() ? ` · “${row.decisionNote.trim()}”` : ""}
                    </p>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

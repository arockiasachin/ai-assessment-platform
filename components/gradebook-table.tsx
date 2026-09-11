"use client"

import { useState } from "react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { GradeBadge } from "@/components/grade-badge"
import { useGradebook } from "@/components/gradebook-provider"
import { studentAverage } from "@/lib/analytics"
import { initials, markKey, type Assessment } from "@/lib/gradebook"
import { cn } from "@/lib/utils"

function EditableMarkCell({
  studentId,
  assessment,
}: {
  studentId: string
  assessment: Assessment
}) {
  const { marks, setMark } = useGradebook()
  const raw = marks[markKey(studentId, assessment.id)]
  const pct = raw === undefined ? null : (raw / assessment.maxMarks) * 100
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")

  const start = () => {
    setDraft(raw === undefined ? "" : String(raw))
    setEditing(true)
  }

  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed === "") {
      setMark(studentId, assessment.id, null)
    } else {
      const n = Math.max(0, Math.min(assessment.maxMarks, Number(trimmed)))
      if (Number.isFinite(n)) setMark(studentId, assessment.id, n)
    }
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex items-center justify-center gap-1">
        <input
          type="number"
          min={0}
          max={assessment.maxMarks}
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || e.keyCode === 229) return
            if (e.key === "Enter") commit()
            if (e.key === "Escape") setEditing(false)
          }}
          onBlur={commit}
          className="w-14 rounded-md border border-primary bg-background px-1.5 py-1 text-center font-mono text-sm tabular-nums outline-none ring-2 ring-primary/30"
          aria-label={`Mark for ${assessment.title} out of ${assessment.maxMarks}`}
        />
        <span className="font-mono text-xs text-muted-foreground">/{assessment.maxMarks}</span>
      </div>
    )
  }

  return (
    <button
      onClick={start}
      className="mx-auto flex flex-col items-center gap-0.5 rounded-md px-2 py-1 transition-colors hover:bg-accent/60"
      title="Click to edit mark"
    >
      <GradeBadge pct={pct} />
      <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
        {raw === undefined ? `—/${assessment.maxMarks}` : `${raw}/${assessment.maxMarks}`}
      </span>
    </button>
  )
}

export function GradebookTable({ assessments }: { assessments: Assessment[] }) {
  const { students, marks, search } = useGradebook()

  const filteredStudents = students.filter((s) =>
    s.name.toLowerCase().includes(search.trim().toLowerCase()),
  )

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="sticky left-0 z-10 min-w-[200px] bg-card px-4 py-3 text-left font-medium text-muted-foreground">
              Student
            </th>
            {assessments.map((a) => (
              <th
                key={a.id}
                className="min-w-[112px] px-2 py-3 text-center align-bottom font-medium"
              >
                <span
                  className="block max-w-[120px] truncate text-xs font-semibold text-foreground"
                  title={a.title}
                >
                  {a.title}
                </span>
                <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">
                  {a.courseName} · {a.type}
                </span>
              </th>
            ))}
            <th className="min-w-[96px] px-3 py-3 text-center font-medium text-muted-foreground">
              Average
            </th>
          </tr>
        </thead>
        <tbody>
          {filteredStudents.map((student, i) => {
            const avg = studentAverage(marks, student.id, assessments)
            return (
              <tr
                key={student.id}
                className={cn(
                  "border-b border-border/60 last:border-0",
                  i % 2 === 1 && "bg-muted/25",
                )}
              >
                <td className="sticky left-0 z-10 bg-inherit px-4 py-2.5">
                  <div className="flex items-center gap-3">
                    <Avatar className="size-8">
                      <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
                        {initials(student.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate font-medium leading-none">{student.name}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {student.email}
                      </p>
                    </div>
                  </div>
                </td>
                {assessments.map((a) => (
                  <td key={a.id} className="px-2 py-2.5 text-center">
                    <EditableMarkCell studentId={student.id} assessment={a} />
                  </td>
                ))}
                <td className="px-3 py-2.5 text-center">
                  <GradeBadge pct={avg} className="mx-auto" />
                </td>
              </tr>
            )
          })}
          {filteredStudents.length === 0 && (
            <tr>
              <td
                colSpan={assessments.length + 2}
                className="px-4 py-10 text-center text-sm text-muted-foreground"
              >
                No students match &ldquo;{search}&rdquo;.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

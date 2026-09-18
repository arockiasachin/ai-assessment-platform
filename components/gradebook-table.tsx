"use client"

import { useState } from "react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { GradeBadge } from "@/components/grade-badge"
import { useGradebook } from "@/components/gradebook-provider"
import { studentAverage } from "@/lib/analytics"
import { initials, markKey, type Assessment, type Student } from "@/lib/gradebook"
import { parseMarkDraft } from "@/lib/gradebook-view"
import { ASSESSMENT_KIND_LABEL } from "@/lib/labels"
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
  const [error, setError] = useState<string | null>(null)

  const start = () => {
    setDraft(raw === undefined ? "" : String(raw))
    setError(null)
    setEditing(true)
  }

  const commit = () => {
    // The same rules the mark endpoint enforces. A value it would refuse is surfaced here
    // rather than clamped or dropped: the old cell turned `9999` into `maxMarks` and ignored
    // `abc`, so the grid and the server disagreed about what had been saved (TN-47).
    const parsed = parseMarkDraft(draft, assessment.maxMarks)
    if (!parsed.ok) {
      setError(parsed.message)
      return
    }
    setMark(studentId, assessment.id, parsed.score)
    setError(null)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex flex-col items-center gap-1">
        <div className="flex items-center justify-center gap-1">
          <input
            type="number"
            min={0}
            max={assessment.maxMarks}
            value={draft}
            autoFocus
            aria-invalid={error !== null}
            onChange={(e) => {
              setDraft(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return
              if (e.key === "Enter") commit()
              if (e.key === "Escape") setEditing(false)
            }}
            onBlur={commit}
            className={cn(
              "w-14 rounded-md border bg-background px-1.5 py-1 text-center font-mono text-sm tabular-nums outline-none ring-2",
              error === null
                ? "border-primary ring-primary/30"
                : "border-destructive ring-destructive/30",
            )}
            aria-label={`Mark for ${assessment.title} out of ${assessment.maxMarks}`}
          />
          <span className="font-mono text-xs text-muted-foreground">/{assessment.maxMarks}</span>
        </div>
        {error !== null && (
          <span role="alert" className="max-w-[160px] text-[10px] leading-tight text-destructive">
            {error}
          </span>
        )}
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

/**
 * The editable marks grid.
 *
 * `students` and `assessments` are the two axes, passed in already scoped to one offering by
 * `TeacherMarksView` (TN-47). They used to be read straight from the provider, which is the
 * union across offerings — so the grid rendered every student against every other class's
 * assessments and most cells were refused by the write path. Both axes now come from one
 * scope, which is what makes the rectangle writable.
 */
export function GradebookTable({
  students,
  assessments,
}: {
  students: Student[]
  assessments: Assessment[]
}) {
  const { marks, search } = useGradebook()

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
                  {a.courseName} · {ASSESSMENT_KIND_LABEL[a.type]}
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
                {students.length === 0
                  ? "No students to mark yet. This grid fills once an offering you teach has enrolled students."
                  : `No students match “${search}”.`}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

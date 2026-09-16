"use client"

import { useMemo } from "react"
import { Search } from "lucide-react"

import { GradebookTable } from "@/components/gradebook-table"
import { useGradebook } from "@/components/gradebook-provider"
import { Input } from "@/components/ui/input"
import { SectionCard } from "@/components/ui/section-card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { filterAssessments } from "@/lib/analytics"

/**
 * The editable marks grid, lifted out of `TeacherView` when the dashboard was
 * ported to the mockup composition.
 *
 * This is the app's only mark-entry surface: `GradebookTable` renders an editable
 * cell per student and assessment, `setMark` writes through
 * `POST /api/gradebook/marks`. The mockup dashboard has no marks grid, so the move
 * preserves the capability rather than porting it away.
 *
 * It reads the gradebook from context — seeded on the server by
 * `app/(dashboard)/layout.tsx` — because `GradebookTable` is itself a context
 * consumer and owns the per-cell editing state. Filtering stays here rather than in
 * the table because `GradebookTable` narrows by the context's `search` while the
 * course filter changes which *columns* exist; putting the course filter here keeps
 * one component deciding what the grid shows.
 */
export function TeacherMarksView() {
  const { courses, assessments, isLoading, courseFilter, setCourseFilter, search, setSearch } =
    useGradebook()

  const filtered = useMemo(
    () => filterAssessments(assessments, courseFilter),
    [assessments, courseFilter],
  )

  if (isLoading) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Loading gradebook…</p>
  }

  return (
    <SectionCard
      title="Marks"
      description="Filter by course and search students to quickly update marks."
      contentClassName="px-2 pb-2"
      action={
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search students…"
              aria-label="Search students"
              className="pl-8 sm:w-56"
            />
          </div>
          <Select value={courseFilter} onValueChange={(value) => setCourseFilter(value ?? "all")}>
            <SelectTrigger className="sm:w-44" aria-label="Filter by course">
              <SelectValue placeholder="All courses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All courses</SelectItem>
              {courses.map((course) => (
                <SelectItem key={course.id} value={course.id}>
                  {course.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      }
    >
      <GradebookTable assessments={filtered} />
    </SectionCard>
  )
}

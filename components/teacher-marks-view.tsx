"use client"

import { useMemo, useState } from "react"
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
import { scopeGradebookToOffering } from "@/lib/gradebook-view"

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
 * consumer and owns the per-cell editing state.
 *
 * The grid is scoped to **one offering** (TN-47). It used to render the union of every
 * student and every assessment across the teacher's offerings, so most cells were a
 * student crossed with another class's assessment and were refused on write. The offering
 * selector is the scope control; both axes come from `scopeGradebookToOffering`, so the
 * rectangle is entirely writable by construction.
 */
export function TeacherMarksView() {
  const { students, assessments, offerings, isLoading, search, setSearch } = useGradebook()

  // Empty means "not chosen yet"; the first offering is the default. Resolving rather than
  // syncing into state keeps it derived from the payload, so a refreshed payload is honoured.
  const [offeringId, setOfferingId] = useState("")
  const selectedOfferingId = offeringId || offerings[0]?.id || ""

  const scoped = useMemo(
    () => scopeGradebookToOffering(students, assessments, selectedOfferingId),
    [students, assessments, selectedOfferingId],
  )

  /**
   * The value→label map Base UI's `Select.Value` needs to render a label instead of the raw
   * offering id in the trigger (TN-7). It is the same data the popup renders.
   */
  const offeringItems = offerings.map((offering) => ({
    value: offering.id,
    label: `${offering.courseCode} · ${offering.className} · ${offering.term} ${offering.academicYear}`,
  }))

  if (isLoading) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Loading gradebook…</p>
  }

  return (
    <SectionCard
      title="Marks"
      description="Choose an offering and search students to quickly update marks."
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
          {offerings.length > 0 && (
            <Select
              value={selectedOfferingId}
              onValueChange={(value) => setOfferingId(value ?? "")}
              items={offeringItems}
            >
              <SelectTrigger className="sm:w-64" aria-label="Course offering">
                <SelectValue placeholder="Select an offering" />
              </SelectTrigger>
              <SelectContent>
                {offerings.map((offering) => (
                  <SelectItem key={offering.id} value={offering.id}>
                    {offering.courseCode} · {offering.className} · {offering.term}{" "}
                    {offering.academicYear}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      }
    >
      <GradebookTable students={scoped.students} assessments={scoped.assessments} />
    </SectionCard>
  )
}

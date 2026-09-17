"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { CourseCategory } from "@/lib/generated/prisma/enums"
import { COURSE_CATEGORY_LABEL, COURSE_CATEGORY_VALUES } from "@/lib/labels"

/**
 * The admin surface for a course's grading category.
 *
 * The category is a course-level fact, but the **regime it produces is offering-level**: the
 * class strength and the published totals that decide between relative and absolute bands
 * belong to one offering. So a course row shows every offering's resolved regime rather than
 * a single rolled-up answer, which would hide a small section falling back while a large one
 * does not.
 *
 * The copy distinguishes the one fallback this page can fix (`category-unset`) from the
 * fallbacks that are correct behaviour (`small-class`, `awaiting-base-metrics`) and the one
 * that is permanent for the course's kind (`non-theory-course`). Without that, an admin sets
 * a category, still sees absolute bands, and reads a correct result as a failed action.
 */

type AbsoluteFallbackReason =
  "category-unset" | "small-class" | "non-theory-course" | "awaiting-base-metrics"

export type AdminCourseGradingOffering = {
  offeringId: string
  classCode: string
  className: string
  teacherName: string
  enrolledCount: number
  publishedCount: number
  regime: "relative" | "absolute"
  reason: AbsoluteFallbackReason | null
  notice: {
    tone: "info" | "warning"
    title: string
    detail: string
    progress?: { available: number; required: number }
  } | null
  categoryFixable: boolean
}

export type AdminCourseGradingRow = {
  courseId: string
  code: string
  name: string
  category: CourseCategory | null
  offerings: AdminCourseGradingOffering[]
}

/**
 * What an admin should understand about a fallback they cannot fix by choosing a category.
 *
 * A short, reason-specific sentence rather than one generic caveat: "not fixable here" is
 * true but unhelpful, and the three reasons have three different causes.
 */
const UNFIXABLE_REASON_NOTE: Record<Exclude<AbsoluteFallbackReason, "category-unset">, string> = {
  "non-theory-course":
    "This is correct for this kind of course — no category can move it off absolute bands.",
  "small-class":
    "This is correct for a class this size — a category cannot change the headcount rule.",
  "awaiting-base-metrics":
    "This is correct until enough totals are published — a category cannot supply the missing marks.",
}

export function AdminCourseGradingView({
  rows,
  gradingEffect,
}: {
  rows: AdminCourseGradingRow[]
  /** Category → consequence sentence, from the service's `describeGradingEffect`. */
  gradingEffect: Record<CourseCategory, string>
}) {
  if (rows.length === 0) {
    return (
      <Callout tone="info" title="No courses">
        There are no courses yet, so there is no category to set.
      </Callout>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Course categories</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {rows.map((row) => (
          <CourseCategoryRow key={row.courseId} row={row} gradingEffect={gradingEffect} />
        ))}
      </CardContent>
    </Card>
  )
}

function CourseCategoryRow({
  row,
  gradingEffect,
}: {
  row: AdminCourseGradingRow
  gradingEffect: Record<CourseCategory, string>
}) {
  const router = useRouter()
  const [value, setValue] = useState<CourseCategory | "">(row.category ?? "")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const changed = value !== "" && value !== (row.category ?? "")

  async function save() {
    if (value === "") return
    setBusy(true)
    setMessage(null)
    setError(null)

    try {
      const response = await fetch(`/api/admin/courses/${row.courseId}/category`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: value }),
      })
      const data = (await response.json()) as { message?: string; gradingEffect?: string }
      if (!response.ok) {
        setError(data.message ?? "Unable to set the course category.")
        return
      }
      setMessage(data.gradingEffect ?? "Category updated.")
      router.refresh()
    } catch {
      setError("Unable to set the course category.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{row.name}</p>
          <p className="font-mono text-xs text-muted-foreground">{row.code}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Current category</p>
          <p className="text-sm font-medium">
            {row.category ? COURSE_CATEGORY_LABEL[row.category] : "Not set"}
          </p>
        </div>
      </div>

      <Table className="mt-3">
        <TableHeader>
          <TableRow>
            <TableHead>Offering</TableHead>
            <TableHead>Teacher</TableHead>
            <TableHead className="text-right">Enrolled</TableHead>
            <TableHead>Effective regime</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {row.offerings.map((offering) => (
            <TableRow key={offering.offeringId}>
              <TableCell>
                <p>{offering.className}</p>
                <p className="font-mono text-xs text-muted-foreground">{offering.classCode}</p>
              </TableCell>
              <TableCell>{offering.teacherName}</TableCell>
              <TableCell className="text-right font-mono text-xs tabular-nums">
                {offering.enrolledCount}
              </TableCell>
              <TableCell>
                <div className="space-y-1">
                  <Badge variant={offering.regime === "relative" ? "secondary" : "outline"}>
                    {offering.regime === "relative" ? "Relative bands" : "Absolute bands"}
                  </Badge>
                  {offering.notice && (
                    <p className="max-w-prose text-xs text-muted-foreground">
                      {offering.reason === "category-unset"
                        ? "Category not set, so absolute bands are shown meanwhile. Setting the category below fixes this."
                        : offering.notice.detail}
                    </p>
                  )}
                  {offering.reason && offering.reason !== "category-unset" && (
                    <p className="max-w-prose text-xs text-muted-foreground italic">
                      {UNFIXABLE_REASON_NOTE[offering.reason]}
                    </p>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
          {row.offerings.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-muted-foreground">
                This course has no offering yet, so no regime is resolved from it.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,16rem)_1fr] sm:items-end">
        <div className="grid gap-2">
          <Label htmlFor={`category-${row.courseId}`}>Set category</Label>
          <Select
            value={value}
            onValueChange={(next) => setValue((next ?? "") as CourseCategory | "")}
          >
            <SelectTrigger id={`category-${row.courseId}`}>
              <SelectValue placeholder="Choose a category" />
            </SelectTrigger>
            <SelectContent>
              {COURSE_CATEGORY_VALUES.map((category) => (
                <SelectItem key={category} value={category}>
                  {COURSE_CATEGORY_LABEL[category]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          {value !== "" && <p className="text-xs text-muted-foreground">{gradingEffect[value]}</p>}
          <div className="flex items-center gap-2">
            <Button onClick={save} disabled={!changed || busy}>
              {busy ? "Saving..." : "Save category"}
            </Button>
            {message && <p className="text-sm text-emerald-700">{message}</p>}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        </div>
      </div>
    </div>
  )
}

"use client"

import { useMemo, useState } from "react"
import { MessageSquare, Printer, Star } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { EmptyState } from "@/components/ui/empty-state"
import { MetricRow } from "@/components/ui/metric-row"
import { SectionCard } from "@/components/ui/section-card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { StatCard } from "@/components/ui/stat-card"
import { StatusPill } from "@/components/ui/status-pill"
import { TruncatedText } from "@/components/ui/truncated-text"
import type { CourseOfferingRatingsReport } from "@/lib/contracts"
import { formatDate } from "@/lib/format"

/**
 * Course-feedback report.
 *
 * Takes its rows as **props** from the server component rather than fetching on
 * mount. The previous version ran a client `useEffect` fetch, which is the
 * deferred P1 finding (`docs/quality/a11y-perf-audit.md`) — porting the page was
 * the moment to fix it rather than carry it forward.
 *
 * The report card half of the mockup is absent: it needs per-student marks across
 * an offering, which no server query on this page provides yet
 * (`docs/plans/wave-1.md` §D3/§5). "At risk" and "Completion" are absent for the
 * same reason — nothing derives them. What remains is entirely real.
 */
export function TeacherRatingsReport({ offerings }: { offerings: CourseOfferingRatingsReport[] }) {
  // The report had no way to narrow its list (TN-28).
  const [coverage, setCoverage] = useState<"all" | "with" | "without">("all")
  const visibleOfferings = useMemo(
    () =>
      offerings.filter((offering) =>
        coverage === "all"
          ? true
          : coverage === "with"
            ? offering.ratingsCount > 0
            : offering.ratingsCount === 0,
      ),
    [offerings, coverage],
  )

  const totals = useMemo(() => {
    const count = offerings.reduce((sum, row) => sum + row.ratingsCount, 0)
    const weighted = offerings.reduce(
      (sum, row) => sum + (row.averageRating ?? 0) * row.ratingsCount,
      0,
    )
    return {
      count,
      average: count ? weighted / count : null,
      comments: offerings.flatMap((row) => row.ratings).filter((row) => row.comment).length,
    }
  }, [offerings])

  if (offerings.length === 0) {
    return (
      <SectionCard title="Course feedback">
        <EmptyState
          title="No offerings to report on"
          description="This report lists your offerings; an offering with no ratings yet still appears here with a zero count."
        />
      </SectionCard>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Feedback across {offerings.length} offering{offerings.length === 1 ? "" : "s"}.
        </p>
        {/* The report had no way to share itself; printing is a real, dependency-free
            affordance rather than a dead "export" control (TN-28). */}
        <Button type="button" variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="size-4" /> Print report
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Show</span>
          <Select value={coverage} onValueChange={(value) => setCoverage(value ?? "all")}>
            <SelectTrigger className="w-56" aria-label="Filter offerings by feedback">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All offerings</SelectItem>
              <SelectItem value="with">With feedback only</SelectItem>
              <SelectItem value="without">Without feedback only</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <p className="text-xs text-muted-foreground">
          Showing {visibleOfferings.length} of {offerings.length}.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Total ratings"
          value={String(totals.count)}
          hint="Across your offerings"
          icon={Star}
        />
        <StatCard
          label="Average score"
          value={totals.average !== null ? `${totals.average.toFixed(2)} / 5` : "—"}
          hint="Weighted by each offering's rating count"
          icon={Star}
        />
        <StatCard
          label="Comments shared"
          value={String(totals.comments)}
          hint="Ratings that left free text"
          icon={MessageSquare}
        />
      </div>

      <Callout tone="info" title="Feedback is attributed">
        Students see only their own rating and the aggregate; as the instructor you see who wrote
        what, so you can follow up on a specific concern.
      </Callout>

      {totals.count === 0 && (
        // Every offering can legitimately be empty: a rating is only accepted once the
        // offering's term has ended, so a course still running has no feedback yet. Saying
        // that is what stops an all-zero page reading as a broken feature (TN-28).
        <Callout tone="info" title="No feedback yet">
          Students can rate a course only after it has finished. None of your offerings has ended
          yet, so there is nothing to show — the list below will fill as each term closes.
        </Callout>
      )}

      {visibleOfferings.map((offering) => (
        <SectionCard
          key={offering.offeringId}
          title={offering.courseName}
          description={`${offering.courseCode} · ${offering.className} · ${offering.academicYear} ${offering.term}`}
          action={
            <StatusPill
              status={offering.ratingsCount > 0 ? "published" : "pending"}
              label={`${offering.ratingsCount} rating${offering.ratingsCount === 1 ? "" : "s"}`}
              dot
            />
          }
        >
          <div className="space-y-4">
            <MetricRow
              label="Average"
              value={
                offering.averageRating !== null ? `${offering.averageRating.toFixed(2)} / 5` : "—"
              }
              hint={offering.averageRating !== null ? undefined : "No ratings for this course yet"}
            />

            {offering.ratings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No ratings for this course yet.</p>
            ) : (
              <ul className="space-y-3">
                {offering.ratings.map((rating) => (
                  <li
                    key={rating.id}
                    className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="min-w-0 font-medium">
                        <TruncatedText width="lg">{rating.studentName}</TruncatedText>
                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                          {rating.registerNumber}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="font-mono text-xs tabular-nums">{rating.rating}/5</span>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(rating.updatedAt)}
                        </span>
                      </span>
                    </div>
                    {/*
                     * Order matters: a live comment always wins, so a student who
                     * re-rates after a purge still has their new words shown.
                     *
                     * The purged branch is honest at the **offering** level rather
                     * than the row level. `purgedAt` is stamped on every rating in
                     * the sweep, so after a purge a row that never had a comment is
                     * indistinguishable from one whose comment was redacted —
                     * claiming "this comment was removed" would be unsupportable for
                     * the first case. Saying the offering's feedback was redacted is
                     * true either way.
                     */}
                    {rating.comment ? (
                      <p className="mt-1.5 flex items-start gap-1.5 text-muted-foreground">
                        <MessageSquare className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                        <span>{rating.comment}</span>
                      </p>
                    ) : rating.purged ? (
                      <p className="mt-1.5">
                        <StatusPill
                          status="archived"
                          label="Feedback redacted by the retention policy"
                          dot
                        />
                      </p>
                    ) : (
                      <p className="mt-1.5 text-muted-foreground">No comment left.</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SectionCard>
      ))}
    </div>
  )
}

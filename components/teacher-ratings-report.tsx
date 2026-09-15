"use client"

import { useMemo } from "react"
import { MessageSquare, Star } from "lucide-react"

import { Callout } from "@/components/ui/callout"
import { EmptyState } from "@/components/ui/empty-state"
import { MetricRow } from "@/components/ui/metric-row"
import { SectionCard } from "@/components/ui/section-card"
import { StatCard } from "@/components/ui/stat-card"
import { StatusPill } from "@/components/ui/status-pill"
import { TruncatedText } from "@/components/ui/truncated-text"
import type { CourseOfferingRatingsReport } from "@/lib/contracts"
import { formatDate } from "@/lib/mock/format"

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
          title="No rating data yet"
          description="Ratings open once a course has finished, so an in-progress offering will legitimately have none."
        />
      </SectionCard>
    )
  }

  return (
    <div className="space-y-6">
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

      {offerings.map((offering) => (
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
                     * Three distinct states, because `comment: null` alone cannot
                     * tell "left no comment" from "cleared by the retention
                     * policy" — and only one of those is the student's choice.
                     */}
                    {rating.purged ? (
                      <p className="mt-1.5">
                        <StatusPill
                          status="archived"
                          label="Comment removed by retention policy"
                          dot
                        />
                      </p>
                    ) : rating.comment ? (
                      <p className="mt-1.5 flex items-start gap-1.5 text-muted-foreground">
                        <MessageSquare className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                        <span>{rating.comment}</span>
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

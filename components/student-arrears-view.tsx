import Link from "next/link"
import { AlertTriangle, ShieldCheck } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Callout } from "@/components/ui/callout"
import { EmptyState } from "@/components/ui/empty-state"
import { SectionCard } from "@/components/ui/section-card"
import {
  ARREAR_REASON_EXPLANATION,
  ARREAR_REASON_LABEL,
  type ArrearEntry,
} from "@/lib/student-outcome-view"

export type StudentArrearsViewProps = {
  arrears: ArrearEntry[]
}

const LINK_CLASS =
  "rounded-sm text-sm text-primary underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring"

/**
 * What an arrear is, in one paragraph.
 *
 * Written once and shown in both branches of the page — the empty state exists so a
 * student who has never seen one learns the term *before* they need it, rather than
 * meeting a bare "nothing here" and having to ask what it meant.
 */
const WHAT_AN_ARREAR_IS =
  "An arrear is recorded against a course that has already ended when you either failed its final assessment, or have no published final-assessment mark because you did not appear for it. A course that is still running is never an arrear. Retaking the course is how an arrear is cleared."

/**
 * Arrears — the outstanding list.
 *
 * Each entry names the course, the reason (failed the final assessment, or did not appear
 * for it) and the term. The reason comes from `outcome.arrear`, the reader's own field —
 * the page never infers an arrear from a `not-judged` verdict, because "we cannot judge
 * yet" is a legitimate state and not a failure.
 *
 * The empty state is the point of the page for most students: it explains what an arrear
 * is, so the term is not learned for the first time when one is actually incurred.
 */
export function StudentArrearsView({ arrears }: StudentArrearsViewProps) {
  if (arrears.length === 0) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="No outstanding arrears"
        description={WHAT_AN_ARREAR_IS}
        action={
          <Link
            href="/student/grades"
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            View completed courses
          </Link>
        }
      />
    )
  }

  return (
    <div className="space-y-6">
      <Callout tone="warning" icon={AlertTriangle} title="What an arrear is">
        {WHAT_AN_ARREAR_IS}
      </Callout>

      <SectionCard
        title="Outstanding"
        description={`${arrears.length} ${
          arrears.length === 1 ? "arrear stands" : "arrears stand"
        } against your record. Each names the course, the reason, and the term it was taken in.`}
      >
        <ul className="divide-y divide-border/70">
          {arrears.map((arrear) => (
            <li
              key={arrear.offeringId}
              className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0 space-y-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{arrear.courseName}</span>
                  <Badge variant="outline" className="font-mono text-xs">
                    {arrear.courseCode}
                  </Badge>
                </p>
                <p className="text-xs text-muted-foreground">
                  {arrear.term} {arrear.academicYear}
                </p>
                <p className="text-sm">
                  <span className="font-medium">{ARREAR_REASON_LABEL[arrear.reason]}.</span>{" "}
                  <span className="text-muted-foreground">
                    {ARREAR_REASON_EXPLANATION[arrear.reason]}
                  </span>
                </p>
              </div>
              <Link
                href={{ pathname: "/student/course", query: { courseCode: arrear.courseCode } }}
                className={LINK_CLASS}
              >
                View course
              </Link>
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  )
}

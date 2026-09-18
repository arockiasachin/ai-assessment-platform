import Link from "next/link"
import { AlertTriangle } from "lucide-react"

import { Callout } from "@/components/ui/callout"
import { ARREAR_REASON_LABEL, type ArrearEntry } from "@/lib/student-outcome-view"

const LINK_CLASS =
  "rounded-sm text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring"

/**
 * A compact "you have arrears" notice, shown where a student already is.
 *
 * Deterministically rendered on `/student/marks` — the everyday page a student opens to
 * check their standing — so an outstanding arrear is visible without hunting for the
 * dedicated list. It is a summary and a way in, not the list itself: the reasons are
 * stated in the student's words and the link reaches `/student/arrears`, which owns the
 * full explanation.
 *
 * Renders nothing when there are no arrears, so the page is unchanged for the majority
 * of students.
 */
export function StudentArrearsNotice({ arrears }: { arrears: ArrearEntry[] }) {
  if (arrears.length === 0) return null

  return (
    <Callout
      tone="destructive"
      icon={AlertTriangle}
      role="status"
      title={
        arrears.length === 1
          ? "You have 1 outstanding arrear"
          : `You have ${arrears.length} outstanding arrears`
      }
      action={
        <Link href="/student/arrears" className={LINK_CLASS}>
          View arrears
        </Link>
      }
      bodyClassName="text-foreground"
    >
      <ul className="space-y-0.5">
        {arrears.map((arrear) => (
          <li key={arrear.offeringId}>
            <span className="font-medium">{arrear.courseCode}</span> ·{" "}
            {ARREAR_REASON_LABEL[arrear.reason]} ·{" "}
            <span className="text-muted-foreground">
              {arrear.term} {arrear.academicYear}
            </span>
          </li>
        ))}
      </ul>
    </Callout>
  )
}

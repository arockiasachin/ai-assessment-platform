import Link from "next/link"
import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { RolePageShell } from "@/components/role-page-shell"
import { listTeacherOfferingsForAnalytics } from "@/lib/analytics/service"
import { getSessionUser } from "@/lib/auth"
import {
  getRecentGradeActivityForTeacher,
  type GradeActivityItem,
} from "@/lib/observability/audit-view"

/**
 * Teacher grade-activity view.
 *
 * A read-only rendering of the `AuditLog` rows behind the grade pipeline for
 * one owned offering, so a teacher can see what the AI and their colleagues did
 * (and when) without opening each submission. Data comes from the same scoped
 * helper the API route uses, so the page cannot show another teacher's rows.
 */

export const dynamic = "force-dynamic"

const ACTION_LABELS: Record<string, string> = {
  "grade_review.created": "Review opened",
  "grade_review.reopened": "Review reopened",
  "grade_review.accept": "AI suggestion accepted",
  "grade_review.override": "AI suggestion overridden",
  "grade_review.reject": "AI suggestion rejected",
  "grade_review.flag": "Flagged for review",
  "ai_suggestion.recorded": "AI suggestion recorded",
  "grade.ai_draft_created": "Draft grade created",
  "grade.ai_draft_updated": "Draft grade updated",
  "grade.published": "Grade published",
}

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action
}

/** Render the scalar fields of an audit summary; never nested objects. */
function summaryText(item: GradeActivityItem): string | null {
  if (!item.summary || typeof item.summary !== "object" || Array.isArray(item.summary)) return null
  const parts = Object.entries(item.summary as Record<string, unknown>)
    .filter(([, value]) => value === null || typeof value !== "object")
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${String(value)}`)
  return parts.length > 0 ? parts.join(" · ") : null
}

export default async function TeacherObservabilityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await getSessionUser()
  if (!user || user.role !== "teacher") redirect("/login")

  const params = await searchParams
  const requested = typeof params.offeringId === "string" ? params.offeringId : null
  const offerings = await listTeacherOfferingsForAnalytics(user)
  const selected = offerings.find((offering) => offering.id === requested) ?? offerings[0] ?? null

  const activity = selected
    ? await getRecentGradeActivityForTeacher(user, { offeringId: selected.id, limit: 25 })
    : null

  return (
    <RoleGuard role="teacher">
      <RolePageShell
        role="teacher"
        title="Grade activity"
        description="Recent grade-pipeline activity — AI suggestions, review decisions, and published grades — for one of your offerings. Read-only."
      >
        {offerings.length === 0 ? (
          <p className="rounded-xl border border-border/70 bg-card px-4 py-6 text-sm text-muted-foreground">
            You have no offerings yet.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {offerings.map((offering) => {
                const isActive = offering.id === selected?.id
                return (
                  <Link
                    key={offering.id}
                    href={`/teacher/observability?offeringId=${offering.id}`}
                    className={[
                      "rounded-lg border px-3 py-1.5 text-xs transition-colors",
                      isActive
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border bg-background hover:bg-muted",
                    ].join(" ")}
                  >
                    {offering.courseCode} · {offering.term} {offering.academicYear}
                  </Link>
                )
              })}
            </div>

            {activity && activity.items.length === 0 ? (
              <p className="rounded-xl border border-border/70 bg-card px-4 py-6 text-sm text-muted-foreground">
                No grade-pipeline activity yet for this offering.
              </p>
            ) : (
              <ol className="space-y-2">
                {activity?.items.map((item) => {
                  const detail = summaryText(item)
                  return (
                    <li
                      key={item.id}
                      className="rounded-xl border border-border/70 bg-card px-4 py-3 text-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{actionLabel(item.action)}</span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(item.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.entityLabel} · {item.actorRole ?? "system"}
                      </p>
                      {detail && <p className="mt-1 text-xs">{detail}</p>}
                    </li>
                  )
                })}
              </ol>
            )}

            {activity?.truncated && (
              <p className="text-xs text-muted-foreground">Showing the most recent 25 events.</p>
            )}
          </div>
        )}
      </RolePageShell>
    </RoleGuard>
  )
}

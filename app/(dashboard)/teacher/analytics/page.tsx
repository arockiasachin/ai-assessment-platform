import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import { findNavItemByAppPath } from "@/components/shell/nav-config"
import { TeacherAnalyticsDashboard } from "@/components/teacher-analytics-dashboard"
import { getSessionUser } from "@/lib/auth"
import {
  getAnalyticsSettingsForTeacher,
  getAssessmentItemAnalysisForTeacher,
  getTeacherAnalyticsOverview,
  listTeacherOfferingsForAnalytics,
} from "@/lib/analytics/service"
import type {
  AnalyticsSettingsResponse,
  AssessmentItemAnalysisResponse,
  TeacherAnalyticsOverviewResponse,
} from "@/lib/contracts/analytics"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Analytics" }

const HREF = "/teacher/analytics"

/**
 * Analytics and interventions.
 *
 * Fetched on the server for the first offering, then the client re-fetches when the teacher
 * switches offering — the payload is per-offering and interactive, so this is not the
 * fetch-on-mount pattern `docs/quality/a11y-perf-audit.md` flags: the first render is already
 * populated.
 *
 * The description is read from the nav rather than duplicated, so the label and the heading
 * cannot drift. That is the pattern the mockup used for the same reason.
 */
export default async function TeacherAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await getSessionUser()
  if (!user || user.role !== "teacher") redirect("/login")

  const params = await searchParams
  const requested = typeof params.offeringId === "string" ? params.offeringId : null
  const offerings = await listTeacherOfferingsForAnalytics(user)
  // The selected offering is read from the URL, so a hard refresh keeps it and a deep
  // link can target one (TN-14). A requested id the teacher does not own falls back to
  // the first rather than being honoured.
  const initialOffering = offerings.find((candidate) => candidate.id === requested) ?? offerings[0]
  const initialOfferingId = initialOffering?.id ?? null

  let initialOverview: TeacherAnalyticsOverviewResponse | null = null
  let initialItems: AssessmentItemAnalysisResponse | null = null
  let initialSettings: AnalyticsSettingsResponse | null = null

  if (initialOfferingId) {
    initialOverview = {
      success: true,
      ...(await getTeacherAnalyticsOverview(user, { offeringId: initialOfferingId })),
    }
    const withData =
      initialOverview.assessments.find((assessment) => assessment.attemptCount > 0) ??
      initialOverview.assessments[0]
    if (withData) {
      initialItems = {
        success: true,
        ...(await getAssessmentItemAnalysisForTeacher(user, { assessmentId: withData.id })),
      }
    }
    // The thresholds panel is seeded too, so opening it shows the stored overrides without a fetch —
    // the same reason the overview and item analysis are seeded rather than fetched on mount.
    initialSettings = await getAnalyticsSettingsForTeacher(user, initialOfferingId)
  }

  return (
    <RoleGuard role="teacher">
      <AppShell
        scope="app"
        role="teacher"
        user={{
          name: user.email,
          email: user.email,
          initials: initialsFromEmail(user.email),
          roleLabel: roleLabelFromRole(user.role),
        }}
      >
        <PageHeader title="Analytics" description={findNavItemByAppPath(HREF)?.item.description} />
        <TeacherAnalyticsDashboard
          offerings={offerings}
          initialOfferingId={initialOfferingId}
          initialOverview={initialOverview}
          initialItems={initialItems}
          initialSettings={initialSettings}
        />
      </AppShell>
    </RoleGuard>
  )
}

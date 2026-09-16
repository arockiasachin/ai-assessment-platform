import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import { findNavItemByAppPath } from "@/components/shell/nav-config"
import { TeacherAnalyticsDashboard } from "@/components/teacher-analytics-dashboard"
import { getSessionUser } from "@/lib/auth"
import {
  getAssessmentItemAnalysisForTeacher,
  getTeacherAnalyticsOverview,
  listTeacherOfferingsForAnalytics,
} from "@/lib/analytics/service"
import type {
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
export default async function TeacherAnalyticsPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "teacher") redirect("/login")

  const offerings = await listTeacherOfferingsForAnalytics(user)
  const initialOfferingId = offerings[0]?.id ?? null

  let initialOverview: TeacherAnalyticsOverviewResponse | null = null
  let initialItems: AssessmentItemAnalysisResponse | null = null

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
        />
      </AppShell>
    </RoleGuard>
  )
}

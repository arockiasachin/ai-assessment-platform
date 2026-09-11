import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { RolePageShell } from "@/components/role-page-shell"
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

export const dynamic = "force-dynamic"

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
      <RolePageShell
        role="teacher"
        title="Analytics & interventions"
        description="Item difficulty and discrimination from real attempts, cohort distribution and pass rate, and threshold-based intervention alerts for your own offerings."
      >
        <TeacherAnalyticsDashboard
          offerings={offerings}
          initialOfferingId={initialOfferingId}
          initialOverview={initialOverview}
          initialItems={initialItems}
        />
      </RolePageShell>
    </RoleGuard>
  )
}

import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { RolePageShell } from "@/components/role-page-shell"
import { TeacherLmsExport } from "@/components/teacher-lms-export"
import { getSessionUser } from "@/lib/auth"
import type { TeacherGradeExportResponse } from "@/lib/contracts/lms-export"
import { getTeacherGradeExport, listTeacherExportOfferings } from "@/lib/lms-export/service"

export const dynamic = "force-dynamic"

export default async function TeacherExportPage() {
  const user = await getSessionUser()
  if (!user || user.role !== "teacher") redirect("/login")

  const offerings = await listTeacherExportOfferings(user)
  const initialOfferingId = offerings[0]?.id ?? null

  let initialExport: TeacherGradeExportResponse | null = null
  if (initialOfferingId) {
    initialExport = {
      success: true,
      ...(await getTeacherGradeExport(user, { offeringId: initialOfferingId })),
    }
  }

  return (
    <RoleGuard role="teacher">
      <RolePageShell
        role="teacher"
        title="Final grades & LMS export"
        description="Weighted final grades from published assessments, downloadable OneRoster 1.2 CSV (line items, results, score scales), and an offline LTI 1.3 AGS dry run."
      >
        <TeacherLmsExport
          offerings={offerings}
          initialOfferingId={initialOfferingId}
          initialExport={initialExport}
        />
      </RolePageShell>
    </RoleGuard>
  )
}

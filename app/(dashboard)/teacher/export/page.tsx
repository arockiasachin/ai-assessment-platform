import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import { TeacherLmsExport } from "@/components/teacher-lms-export"
import { getSessionUser } from "@/lib/auth"
import type { TeacherGradeExportResponse } from "@/lib/contracts/lms-export"
import { getTeacherGradeExport, listTeacherExportOfferings } from "@/lib/lms-export/service"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Final grades" }

/**
 * Final grades and LMS export.
 *
 * This is the platform's most consequential output — the weighted final grade that leaves the
 * building — so the page states what it is rather than leading with the mockup's noun. A port of
 * the `teacher/export` *mockup* would have replaced a working, tested export with a fixture-driven
 * one built on an `ExportRow` model that does not exist; per `docs/plans/wave-2.md` §2, any port
 * here is an addition, never a replacement.
 */
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
        <PageHeader
          title="Final grades"
          description="Weighted final grades from published assessments, downloadable OneRoster 1.2 CSV (line items, results, score scales), and an offline LTI 1.3 AGS dry run."
        />
        <TeacherLmsExport
          offerings={offerings}
          initialOfferingId={initialOfferingId}
          initialExport={initialExport}
        />
      </AppShell>
    </RoleGuard>
  )
}

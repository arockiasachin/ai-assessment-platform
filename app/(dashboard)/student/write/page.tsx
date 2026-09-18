import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { FileText } from "lucide-react"

import { type AssessmentPickerOption } from "@/components/assessment-picker"
import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import { StudentWriteEditor } from "@/components/student-write-editor"
import { EmptyState } from "@/components/ui/empty-state"
import { supportsTextSubmission } from "@/lib/assessment-submission-rules"
import { getSessionUser } from "@/lib/auth"
import { sanitizeSubmissionContent } from "@/lib/rich-text"
import { listStudentAssessments } from "@/lib/student-assessments"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Write" }

/**
 * The dedicated writing page for a text submission.
 *
 * The assessment is named by an **`assessmentId` search param**, not an id
 * segment, matching `/student/code-submissions` and this app's deliberate
 * no-id-segment-pages rule.
 *
 * The assessment is resolved against the student's own list (`listStudentAssessments`),
 * so an id they are not enrolled in — or one that is not a written kind — falls
 * back to their first written assessment rather than reaching an ownership
 * check it would fail. Nothing on this page is a new authorization surface: the
 * write itself still goes through the guarded submission route.
 *
 * Layout: the page is a Server Component that resolves the assessment and hands
 * it to the client editor island, which renders the full-height two-pane
 * workspace. The "Select an assessment" card and the long page description were
 * removed in the workspace rewrite — the picker is a compact `Select` in the
 * header and the details are labelled rows in the brief pane.
 */
export default async function StudentWritePage({
  searchParams,
}: {
  searchParams: Promise<{ assessmentId?: string | string[] }>
}) {
  const user = await getSessionUser()
  if (!user || user.role !== "student") redirect("/login")

  const params = await searchParams
  const requestedId = Array.isArray(params.assessmentId)
    ? params.assessmentId[0]
    : params.assessmentId

  const payload = await listStudentAssessments(user)
  if (payload === null) redirect("/login")

  const writable = payload.assessments.filter((assessment) =>
    supportsTextSubmission(assessment.type),
  )
  const selected =
    writable.find((assessment) => assessment.id === requestedId) ?? writable[0] ?? null

  const options: AssessmentPickerOption[] = writable.map((assessment) => ({
    value: assessment.id,
    label: assessment.title,
  }))

  return (
    <RoleGuard role="student">
      <AppShell
        scope="app"
        role="student"
        width="full"
        user={{
          name: user.email,
          email: user.email,
          initials: initialsFromEmail(user.email),
          roleLabel: roleLabelFromRole(user.role),
        }}
      >
        {selected === null ? (
          <div className="mx-auto w-full max-w-3xl">
            <PageHeader title="Write" />
            <EmptyState
              icon={FileText}
              title="No written assessments assigned"
              description="A written assessment (an assignment or descriptive piece) appears here once you are actively enrolled in its offering. Ask your teacher if you expected one."
            />
          </div>
        ) : (
          <StudentWriteEditor
            // Remount on selection so the editor's content is the newly
            // selected assessment's draft rather than the previous one's.
            key={selected.id}
            options={options}
            assessment={{
              id: selected.id,
              title: selected.title,
              courseCode: selected.courseCode,
              courseName: selected.courseName,
              className: selected.className,
              dueDate: selected.dueDate,
              maxMarks: selected.maxMarks,
              submissionState: selected.submissionState,
              // The saved body is sanitized before it reaches TipTap, so
              // legacy plain-text rows cannot smuggle markup into the editor.
              submissionContent: sanitizeSubmissionContent(selected.submissionContent),
              submissionBlockedReason: selected.submissionBlockedReason,
            }}
          />
        )}
      </AppShell>
    </RoleGuard>
  )
}

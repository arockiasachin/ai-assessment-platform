import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { FileText } from "lucide-react"

import { RoleGuard } from "@/components/role-guard"
import { AppShell, PageHeader } from "@/components/shell"
import { StudentWriteEditor } from "@/components/student-write-editor"
import { buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { supportsTextSubmission } from "@/lib/assessment-submission-rules"
import { getSessionUser } from "@/lib/auth"
import { formatDateTime } from "@/lib/format"
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

  return (
    <RoleGuard role="student">
      <AppShell
        scope="app"
        role="student"
        user={{
          name: user.email,
          email: user.email,
          initials: initialsFromEmail(user.email),
          roleLabel: roleLabelFromRole(user.role),
        }}
      >
        <PageHeader
          title="Write"
          description="Draft, format, and submit written work. Upload a PDF, DOCX, TXT, or MD file to extract its text into the editor — then review and edit it before saving."
        />

        {selected === null ? (
          <EmptyState
            icon={FileText}
            title="No written assessments assigned"
            description="A written assessment (an assignment or descriptive piece) appears here once you are actively enrolled in its offering. Ask your teacher if you expected one."
          />
        ) : (
          <div className="space-y-6">
            {writable.length > 1 && (
              <Card className="border-border/70 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base tracking-tight">Select an assessment</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="flex flex-wrap gap-2">
                    {writable.map((option) => {
                      const isSelected = option.id === selected.id
                      return (
                        <li key={option.id}>
                          <Link
                            href={{
                              pathname: "/student/write",
                              query: { assessmentId: option.id },
                            }}
                            aria-current={isSelected ? "true" : undefined}
                            className={buttonVariants({
                              variant: isSelected ? "default" : "outline",
                              size: "sm",
                            })}
                          >
                            <span className="max-w-[16rem] truncate">{option.title}</span>
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </CardContent>
              </Card>
            )}

            <Card className="border-border/70 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base tracking-tight">{selected.title}</CardTitle>
                <p className="text-xs text-muted-foreground">
                  {selected.courseCode} · {selected.courseName} · {selected.className} · due{" "}
                  {formatDateTime(selected.dueDate)} · {selected.maxMarks} marks
                </p>
              </CardHeader>
              <CardContent>
                <StudentWriteEditor
                  // Remount on selection so the editor's content is the newly
                  // selected assessment's draft rather than the previous one's.
                  key={selected.id}
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
              </CardContent>
            </Card>
          </div>
        )}
      </AppShell>
    </RoleGuard>
  )
}

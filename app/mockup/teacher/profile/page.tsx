import type { Metadata } from "next"
import { LogOut, UserRound } from "lucide-react"

import { findNavItem } from "@/components/shell/nav-config"
import { PageHeader } from "@/components/shell/page-header"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { KeyValueList, MetricRow } from "@/components/ui/metric-row"
import { SectionCard } from "@/components/ui/section-card"
import { StatusPill } from "@/components/ui/status-pill"
import {
  MOCK_ASSESSMENTS,
  MOCK_COURSE,
  MOCK_CURRENT_USER,
  MOCK_STUDENTS,
  formatDate,
  formatPercent,
} from "@/lib/mock"

export const metadata: Metadata = {
  title: "Profile",
}

const HREF = "/mockup/teacher/profile"

const USER = MOCK_CURRENT_USER.teacher

const PUBLISHED_ASSESSMENTS = MOCK_ASSESSMENTS.filter((assessment) => assessment.published).length

/**
 * Profile — the signed-in staff record.
 *
 * The identity is a fixture: the mockup shell renders the same user without
 * fetching `/api/auth/me`, which is what removed the old "Loading…" flash.
 */
export default function TeacherProfilePage() {
  return (
    <>
      <PageHeader
        eyebrow="Account"
        title="Profile"
        description={findNavItem(HREF)?.item.description}
        breadcrumbs={[
          { label: "Mockup index", href: "/mockup" },
          { label: "Teacher workspace", href: "/mockup/teacher" },
          { label: "Profile" },
        ]}
      />

      <div className="space-y-6">
        <SectionCard
          title="Profile"
          description="Your staff identity as the rest of the platform sees it."
          action={<UserRound className="size-4 text-muted-foreground" aria-hidden="true" />}
        >
          <div className="mb-4 flex items-center gap-3">
            <Avatar size="lg">
              <AvatarFallback>{USER.initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="text-base font-medium">{USER.name}</p>
              <p className="text-sm text-muted-foreground">{USER.email}</p>
            </div>
            <StatusPill status={USER.roleTone} label={USER.roleLabel} dot />
          </div>
          <KeyValueList
            items={[
              { id: "name", label: "Name", value: USER.name },
              { id: "email", label: "Email", value: USER.email },
              {
                id: "role",
                label: "Role",
                value: <StatusPill status={USER.roleTone} label={USER.roleLabel} dot />,
                hint: "Determines which workspaces and actions are available",
              },
              {
                id: "scope",
                label: "Teaching scope",
                value: USER.detail,
                hint: `${MOCK_COURSE.code} · ${MOCK_COURSE.section}`,
              },
              {
                id: "id",
                label: "User id",
                value: <span className="font-mono text-xs">{USER.id}</span>,
              },
            ]}
          />
        </SectionCard>

        <SectionCard
          title="Offerings"
          description="The offering you own this term. A teacher can hold several; this mockup is written against one."
        >
          <KeyValueList
            items={[
              {
                id: "course",
                label: "Course",
                value: `${MOCK_COURSE.code} — ${MOCK_COURSE.name}`,
                hint: MOCK_COURSE.description,
              },
              {
                id: "term",
                label: "Term",
                value: `${MOCK_COURSE.term} (${MOCK_COURSE.academicYear})`,
              },
              { id: "section", label: "Section", value: MOCK_COURSE.section },
              { id: "room", label: "Room", value: MOCK_COURSE.room },
              { id: "credits", label: "Credits", value: `${MOCK_COURSE.credits}` },
              { id: "starts", label: "Starts", value: formatDate(MOCK_COURSE.startsOn) },
              { id: "ends", label: "Ends", value: formatDate(MOCK_COURSE.endsOn) },
            ]}
          />
          <div className="mt-2 border-t border-border pt-2">
            <MetricRow label="Students enrolled" value={String(MOCK_COURSE.studentCount)} />
            <MetricRow
              label="Students at risk"
              value={String(MOCK_STUDENTS.filter((student) => student.atRisk).length)}
            />
            <MetricRow
              label="Cohort mean"
              value={formatPercent(MOCK_COURSE.avgPercent)}
              hint="Published marks only"
            />
            <MetricRow
              label="Assessments published"
              value={`${PUBLISHED_ASSESSMENTS} of ${MOCK_ASSESSMENTS.length}`}
            />
          </div>
        </SectionCard>

        <SectionCard
          title="Session"
          description="Static mockup session. There is no authentication anywhere in the mockup tree."
        >
          <KeyValueList
            items={[
              {
                id: "source",
                label: "Identity source",
                value: <span className="font-mono text-xs">lib/mock/session.ts</span>,
                hint: "Rendered from a fixture, never from a request",
              },
              {
                id: "role-preview",
                label: "Role preview",
                value: "Teacher, student and admin switch in the account menu",
              },
              { id: "auth", label: "Authentication", value: "None — mockups only" },
            ]}
          />
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <Button variant="outline" disabled>
              <LogOut className="size-4" aria-hidden="true" />
              Sign out
            </Button>
            <p className="text-xs text-muted-foreground">
              Disabled on purpose: signing out of a mockup would be misleading.
            </p>
          </div>
        </SectionCard>
      </div>
    </>
  )
}

import type { Metadata } from "next"
import { Users } from "lucide-react"

import { PageHeader } from "@/components/shell/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { KeyValueList, MetricRow } from "@/components/ui/metric-row"
import { ProgressBar } from "../_lib/progress-bar"
import { SectionCard } from "@/components/ui/section-card"
import { StatusPill } from "@/components/ui/status-pill"
import {
  MOCK_COURSE,
  MOCK_DEMO_STUDENT,
  MOCK_GROUP_BY_ID,
  MOCK_STUDENTS,
  formatDate,
  formatPercent,
} from "@/lib/mock"

export const metadata: Metadata = {
  title: "Profile",
}

export default function StudentProfilePage() {
  const student = MOCK_DEMO_STUDENT
  const team = student.groupId === null ? null : MOCK_GROUP_BY_ID[student.groupId]
  const peers = MOCK_STUDENTS.filter((entry) => entry.groupId === student.groupId)

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Mockup index", href: "/mockup" },
          { label: "Student workspace", href: "/mockup/student" },
          { label: "Profile" },
        ]}
        eyebrow={student.registerNumber}
        title="Profile"
        description="Your student profile, register number, and enrolments."
      />

      <div className="space-y-6">
        <SectionCard
          title="Student profile"
          description="As held by the institution. Contact your programme office if anything here is wrong."
        >
          <KeyValueList
            items={[
              { label: "Full name", value: student.name },
              {
                label: "Register number",
                value: <span className="font-mono">{student.registerNumber}</span>,
              },
              { label: "Email", value: student.email },
              {
                label: "Peer group",
                value:
                  student.groupName === null ? (
                    <span className="text-muted-foreground">Not assigned yet</span>
                  ) : (
                    student.groupName
                  ),
                hint: student.groupId ?? "No group id",
              },
              {
                label: "Overall average",
                value: (
                  <span className="font-mono tabular-nums">
                    {formatPercent(student.avgPercent)}
                  </span>
                ),
                hint: "Across released work only",
              },
              {
                label: "Submissions",
                value: (
                  <span className="font-mono tabular-nums">
                    {student.submittedCount} submitted · {student.missingCount} missing
                  </span>
                ),
              },
              {
                label: "Standing",
                value: student.atRisk ? (
                  <StatusPill status="flagged" label="At risk" dot />
                ) : (
                  <StatusPill status="completed" label="On track" dot />
                ),
                hint:
                  student.lastActiveAt === null
                    ? "Never signed in"
                    : `Last active ${formatDate(student.lastActiveAt)}`,
              },
            ]}
          />
        </SectionCard>

        <SectionCard title="Enrolment" description="The offering this profile is enrolled on.">
          <div className="space-y-4">
            <KeyValueList
              items={[
                {
                  label: "Course",
                  value: (
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono">{MOCK_COURSE.code}</span>
                      <span>{MOCK_COURSE.name}</span>
                    </span>
                  ),
                },
                { label: "Term", value: `${MOCK_COURSE.term} · ${MOCK_COURSE.section}` },
                { label: "Teacher", value: MOCK_COURSE.teacherName },
                { label: "Room", value: MOCK_COURSE.room },
                { label: "Credits", value: `${MOCK_COURSE.credits} credits` },
                {
                  label: "Runs",
                  value: (
                    <span className="font-mono text-xs tabular-nums">
                      {formatDate(MOCK_COURSE.startsOn)} → {formatDate(MOCK_COURSE.endsOn)}
                    </span>
                  ),
                },
              ]}
            />
            <ProgressBar
              value={MOCK_COURSE.completionPercent}
              label="Course completion"
              tone={MOCK_COURSE.completionPercent >= 70 ? "success" : "primary"}
            />
          </div>
        </SectionCard>

        <SectionCard
          title="Peer group"
          description={
            team === null
              ? "You are not in a peer group for this course."
              : `${team.members.length} members · everyone rates everyone else on the five CATME dimensions.`
          }
        >
          {team === null || peers.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No peer group yet"
              description="This group has no members, so there is nobody to collaborate with."
            />
          ) : (
            <div className="space-y-4">
              <MetricRow
                label="Project"
                value={<span className="text-pretty">{team.projectTitle}</span>}
              />
              <ul className="divide-y divide-border">
                {peers.map((peer) => {
                  const member = team.members.find((entry) => entry.studentId === peer.id)
                  const isSelf = peer.id === student.id
                  return (
                    <li
                      key={peer.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {peer.name}
                          {isSelf && (
                            <span className="font-normal text-muted-foreground"> (you)</span>
                          )}
                        </p>
                        <p className="font-mono text-xs tabular-nums text-muted-foreground">
                          {peer.registerNumber}
                        </p>
                      </div>
                      <span className="flex items-center gap-2">
                        {member?.role != null && (
                          <StatusPill status="active" label={member.role} dot />
                        )}
                        {isSelf && <StatusPill status="published" label="Your row" />}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </SectionCard>
      </div>
    </>
  )
}

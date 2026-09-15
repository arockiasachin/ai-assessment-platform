import type { Metadata } from "next"

import { PageHeader } from "@/components/shell/page-header"
import { Button } from "@/components/ui/button"
import { KeyValueList } from "@/components/ui/metric-row"
import { SectionCard } from "@/components/ui/section-card"
import { StatusPill } from "@/components/ui/status-pill"
import { Label } from "@/components/ui/label"
import { MOCK_CURRENT_USER } from "@/lib/mock"

export const metadata: Metadata = {
  title: "Settings",
}

/**
 * A preference row.
 *
 * The control is a real, labelled checkbox so the row reads correctly in the
 * accessibility tree, but it is `disabled`: preferences are inert in the mockups
 * and are never stored. The hint explains the state in words rather than leaving
 * a dead control with no context.
 */
function StaticToggle({
  id,
  label,
  hint,
  defaultChecked = false,
}: {
  id: string
  label: string
  hint: string
  defaultChecked?: boolean
}) {
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        defaultChecked={defaultChecked}
        disabled
        className="mt-0.5 size-4 shrink-0 accent-primary"
      />
      <div className="space-y-0.5">
        <Label htmlFor={id} className="font-medium">
          {label}
        </Label>
        <p className="text-xs text-muted-foreground text-pretty">{hint}</p>
      </div>
    </div>
  )
}

export default function StudentSettingsPage() {
  const user = MOCK_CURRENT_USER.student

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Mockup index", href: "/mockup" },
          { label: "Student workspace", href: "/mockup/student" },
          { label: "Settings" },
        ]}
        eyebrow="Account"
        title="Settings"
        description="Accessibility, notifications, and assessment preferences."
        actions={<StatusPill status="draft" label="Mockup — nothing is saved" />}
      />

      <div className="space-y-6">
        <SectionCard
          title="Accessibility"
          description="Display preferences. These are inert in the mockup, so toggling them is disabled."
        >
          <div className="space-y-4">
            <StaticToggle
              id="setting-reduce-motion"
              label="Reduce motion"
              hint="Removes chart and page transitions, including the sparkline animations in your dashboard tiles."
            />
            <StaticToggle
              id="setting-larger-text"
              label="Larger text"
              hint="Increases body text by one step without changing the table density."
            />
            <StaticToggle
              id="setting-high-contrast"
              label="High-contrast focus outlines"
              hint="Thickens the keyboard focus ring on links, buttons and table rows."
              defaultChecked
            />
          </div>
        </SectionCard>

        <SectionCard
          title="Notifications"
          description="What the platform is allowed to email you about."
        >
          <div className="space-y-4">
            <StaticToggle
              id="setting-reminders"
              label="Assessment reminders"
              hint="A reminder 24 hours before each released due date. Draft work is never missing from this list — unreleased assessments are not sent."
              defaultChecked
            />
            <StaticToggle
              id="setting-feedback"
              label="Feedback alerts"
              hint="Tells you when a mark or written comment is released to you."
              defaultChecked
            />
            <StaticToggle
              id="setting-summary"
              label="Weekly progress summary"
              hint="A Monday digest of what is due, what you submitted, and topics worth revising."
            />
          </div>
        </SectionCard>

        <SectionCard title="Session" description="How you are signed in for this preview.">
          <div className="space-y-4">
            <KeyValueList
              items={[
                { label: "Name", value: user.name },
                { label: "Email", value: user.email },
                {
                  label: "Role",
                  value: <StatusPill status={user.roleTone} label={user.roleLabel} dot />,
                },
                { label: "Programme", value: user.detail },
                {
                  label: "Session id",
                  value: <span className="font-mono text-xs">{user.id}</span>,
                  hint: "Fixture identity — no real session exists",
                },
              ]}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" disabled>
                Sign out
              </Button>
              <p className="text-xs text-muted-foreground">
                Disabled: the mockups run without authentication, so there is nothing to sign out
                of.
              </p>
            </div>
          </div>
        </SectionCard>
      </div>
    </>
  )
}

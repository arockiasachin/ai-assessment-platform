import type { Metadata } from "next"
import { Gauge, KeyRound, UserRound } from "lucide-react"

import { PageHeader } from "@/components/shell/page-header"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { KeyValueList, MetricRow } from "@/components/ui/metric-row"
import { SectionCard } from "@/components/ui/section-card"
import { StatusPill } from "@/components/ui/status-pill"
import {
  MOCK_ADMIN_SUMMARY,
  MOCK_CURRENT_USER,
  formatDateTime,
  formatRelativeTime,
} from "@/lib/mock"

export const metadata: Metadata = {
  title: "Profile",
}

/**
 * Mock session window. Kept as fixed UTC instants so the server render and the
 * browser hydration agree — the mockups never call `Date.now()` in render.
 */
const SESSION = {
  startedAt: "2026-09-15T05:40:00.000Z",
  expiresAt: "2026-09-15T17:40:00.000Z",
  lastActiveAt: "2026-09-15T13:22:00.000Z",
  device: "Chrome on macOS · Vellore, IN",
} as const

/**
 * Admin profile.
 *
 * The signed-in administrator, the scope of what they administer, and the mock
 * session. Sign-out is deliberately disabled: the mockup tree has no session to
 * end.
 */
export default function AdminProfilePage() {
  const user = MOCK_CURRENT_USER.admin

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: "Mockup index", href: "/mockup" },
          { label: "Admin workspace", href: "/mockup/admin" },
          { label: "Profile" },
        ]}
        title="Profile"
        description="Your admin profile and session information."
      />

      <div className="mt-6 space-y-6">
        <SectionCard
          title="Profile"
          description="Your identity on the platform."
          action={<UserRound className="size-4 text-muted-foreground" aria-hidden="true" />}
        >
          <div className="mb-4 flex items-center gap-3">
            <Avatar size="lg">
              <AvatarFallback className="bg-primary/10 font-medium text-primary">
                {user.initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-base font-medium">{user.name}</p>
              <p className="truncate text-sm text-muted-foreground">{user.detail}</p>
            </div>
          </div>
          <KeyValueList
            items={[
              { id: "name", label: "Full name", value: user.name },
              { id: "email", label: "Email", value: user.email },
              {
                id: "role",
                label: "Role",
                value: <StatusPill status={user.roleTone} dot label={user.roleLabel} />,
              },
              { id: "scope", label: "Scope", value: "Whole institution" },
              {
                id: "id",
                label: "Account ID",
                value: <span className="font-mono text-xs">{user.id}</span>,
              },
            ]}
          />
        </SectionCard>

        <SectionCard
          title="Platform scope"
          description="What this account administers right now."
          action={<Gauge className="size-4 text-muted-foreground" aria-hidden="true" />}
        >
          <div className="divide-y divide-border">
            <MetricRow
              label="Active accounts"
              value={String(MOCK_ADMIN_SUMMARY.activeUsers)}
              hint={`${MOCK_ADMIN_SUMMARY.pendingUsers} awaiting activation`}
            />
            <MetricRow
              label="Active offerings"
              value={String(MOCK_ADMIN_SUMMARY.activeOfferings)}
              hint={`${MOCK_ADMIN_SUMMARY.seatsUsed} seats filled`}
            />
            <MetricRow
              label="Datasets needing review"
              value={String(MOCK_ADMIN_SUMMARY.datasetsNeedingReview)}
              hint="Unmapped imports and roster mismatches"
            />
          </div>
        </SectionCard>

        <SectionCard
          title="Session"
          description="Mock session details. The mockup tree has no authentication."
          action={<KeyRound className="size-4 text-muted-foreground" aria-hidden="true" />}
        >
          <KeyValueList
            items={[
              { id: "started", label: "Signed in", value: formatDateTime(SESSION.startedAt) },
              {
                id: "last-active",
                label: "Last activity",
                value: `${formatRelativeTime(SESSION.lastActiveAt)} (${formatDateTime(SESSION.lastActiveAt)})`,
              },
              { id: "expires", label: "Expires", value: formatDateTime(SESSION.expiresAt) },
              { id: "device", label: "Device", value: SESSION.device },
            ]}
          />
          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <Button type="button" variant="outline" disabled>
              Sign out
            </Button>
            <p className="text-xs text-muted-foreground">
              Disabled in mockups — sign-out is not part of this preview.
            </p>
          </div>
        </SectionCard>
      </div>
    </>
  )
}

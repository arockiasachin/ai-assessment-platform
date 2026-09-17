import { redirect } from "next/navigation"
import Script from "next/script"

import { AppShell } from "@/components/shell/app-shell"
import { PageHeader } from "@/components/shell/page-header"
import { Callout } from "@/components/ui/callout"
import { SectionCard } from "@/components/ui/section-card"
import { getSessionUser } from "@/lib/auth"
import { initialsFromEmail, roleLabelFromRole } from "@/lib/user-identity"

export const dynamic = "force-dynamic"

/**
 * Help — the support desk, embedded.
 *
 * This page is the whole host-side surface. The widget script at the bottom mounts
 * a launcher, which loads the support desk's own document in an iframe and
 * authenticates the signed-in user through `/api/support/presign`.
 *
 * The script is scoped to this page rather than the dashboard layout on purpose.
 * A widget loaded app-wide opens an iframe on every page view, and this widget's
 * iframe performs its session handshake as soon as it loads — so app-wide would
 * mean a support session established on every navigation. Moving the tag into
 * `app/(dashboard)/layout.tsx` makes the launcher appear everywhere; that is a
 * reasonable choice once the handshake is cheap, but it is not the default here.
 *
 * If the deployment is not configured, the page says so plainly instead of
 * rendering a launcher that would fail on click.
 */
export default async function HelpPage() {
  const user = await getSessionUser()
  if (!user) redirect("/login")

  const deskUrl = process.env.SUPPORT_DESK_URL?.trim().replace(/\/+$/, "") ?? ""
  const publicKey = process.env.SUPPORT_DESK_PUBLIC_KEY?.trim() ?? ""
  const configured = Boolean(deskUrl && publicKey)

  return (
    <AppShell
      scope="app"
      role={user.role}
      user={{
        name: user.email,
        email: user.email,
        initials: initialsFromEmail(user.email),
        roleLabel: roleLabelFromRole(user.role),
      }}
    >
      <PageHeader
        eyebrow="Support"
        title="Help"
        description="Report a problem or ask a question. Tickets are tracked, so nothing gets lost."
      />

      <div className="space-y-4">
        {configured ? (
          <SectionCard
            title="Open the support widget"
            description="Use the Help button in the corner of this page. What you send includes the page you were on, so you do not have to describe where you were."
          >
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>You can follow a ticket&rsquo;s progress and reply from the same panel.</li>
              <li>Your name and email are taken from your account — no need to retype them.</li>
              <li>Only you and the support team can read your tickets.</li>
            </ul>
          </SectionCard>
        ) : (
          <Callout tone="warning" title="Support is not configured on this deployment">
            <p className="text-sm">
              Set <code>SUPPORT_DESK_URL</code> and <code>SUPPORT_DESK_PUBLIC_KEY</code> in this
              application&rsquo;s environment, then reload. Both values are shown on the support
              desk&rsquo;s workspace settings page.
            </p>
          </Callout>
        )}
      </div>

      {configured ? (
        /*
         * `next/script`, not a raw `<script>` tag.
         *
         * The shell that wraps this page is a client component, so a bare script
         * tag is handed to React as a child and React refuses to execute it during
         * a client render — it logs "Encountered a script tag while rendering React
         * component" and the widget never loads. It appeared to work when the page
         * was opened by a full page load, because the server-rendered HTML still
         * contained the tag; navigating to /help *within* the app did not load the
         * widget at all.
         */
        <Script
          src={`${deskUrl}/widget.js`}
          data-public-key={publicKey}
          data-token-url="/api/support/presign"
          strategy="afterInteractive"
        />
      ) : null}
    </AppShell>
  )
}

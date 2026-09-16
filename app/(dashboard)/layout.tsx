import type { ReactNode } from "react"

import {
  GradebookProvider,
  type GradebookPayload,
  type Role,
} from "@/components/gradebook-provider"
import { getSessionUser } from "@/lib/auth"
import { getGradebookPayloadForSessionUser } from "@/lib/gradebook-db"

export const dynamic = "force-dynamic"

/**
 * The dashboard subtree's data provider.
 *
 * **This layout exists to fix the P1 finding in `docs/quality/a11y-perf-audit.md`.** The
 * gradebook payload used to be fetched client-side on mount, so every dashboard route rendered an
 * empty shell and then filled in — and the header briefly showed the *teacher* label to students,
 * because `role` defaulted to `"teacher"` and was corrected in an effect. Fetching here means the
 * first render is already correct on both counts.
 *
 * ## Why a nested provider rather than changing the root one
 *
 * `GradebookProvider` is mounted in `app/layout.tsx`, which cannot receive props from a page. A
 * nested provider shadows it for this subtree only, so `/quiz` and the whole `/mockup` tree keep
 * the behaviour they have — including `refresh()`, which the write paths (`TeacherAssignmentsManager`
 * after creating an assessment) depend on. A nested provider is a real pattern here rather than a
 * workaround: the two instances never coexist on a route.
 *
 * ## Failure behaviour, stated
 *
 * A failing fetch here now throws inside a Server Component, so the subtree renders
 * `app/(dashboard)/error.tsx`. Previously the failure was caught in the client and degraded to a
 * shell with a `loadError` message. That is a real trade — the boundary is a whole-page error
 * instead of an inline one — and it is why the fetch is wrapped: a failure returns `null` and the
 * provider falls back to its own client fetch, which restores the old behaviour rather than
 * losing it.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser()

  // Not signed in: `proxy.ts` redirects these routes before rendering, so this is defensive. Let
  // the provider fetch (and 401) rather than asserting a role that does not exist.
  if (!user) {
    return <GradebookProvider>{children}</GradebookProvider>
  }

  const role: Role = user.role === "student" ? "student" : "teacher"

  let payload: GradebookPayload | null = null
  try {
    payload = (await getGradebookPayloadForSessionUser(user)) as GradebookPayload
  } catch (error) {
    // Fall back to the provider's own fetch rather than taking the page down. Recorded so a
    // persistent failure is visible in the logs rather than only as a slow page.
    console.error("Dashboard layout: failed to load the gradebook payload.", error)
  }

  return (
    <GradebookProvider initialPayload={payload} initialRole={role}>
      {children}
    </GradebookProvider>
  )
}

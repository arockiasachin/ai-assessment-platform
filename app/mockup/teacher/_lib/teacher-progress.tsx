"use client"

import { ProgressBar, type ProgressBarProps } from "@/components/ui/progress-bar"

/**
 * A Client Component boundary for `ProgressBar`.
 *
 * `ProgressBar` renders `ProgressValue` (from `@/components/ui/progress`) with a
 * render *function* as its child. A render function cannot cross the Server →
 * Client Component boundary, so a Server Component that renders `ProgressBar`
 * fails the build with "Functions cannot be passed directly to Client
 * Components". Every mockup page is a Server Component, so they render this shim
 * instead: all of its props are serializable, and `ProgressBar` itself is used
 * unchanged behind the boundary.
 *
 * If `components/ui/progress-bar.tsx` is ever marked `"use client"` (the same
 * way `progress.tsx` already is), this file can be deleted and pages can import
 * `ProgressBar` directly. The mockup pages are written so that is a one-line
 * import change.
 */
export function TeacherProgress(props: ProgressBarProps) {
  return <ProgressBar {...props} />
}

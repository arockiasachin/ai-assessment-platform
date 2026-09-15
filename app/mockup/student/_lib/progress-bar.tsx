"use client"

/**
 * Client boundary for the shared `ProgressBar`.
 *
 * WHY THIS FILE EXISTS — a foundation bug, worked around without editing it:
 *
 * `ProgressBar` (Server Component module) renders `<ProgressValue>` with a
 * render-**function** child, and `ProgressValue` is a Base UI Client Component.
 * A Server Component may not pass a function across the client boundary, so
 * Next fails the prerender of any page that renders `ProgressBar` from a Server
 * Component with:
 *
 *     Functions cannot be passed directly to Client Components …
 *     {children: function children}
 *
 * Re-exporting the primitive from a client module moves that function child
 * inside the client boundary, where it is legal. The shared primitive in
 * `components/ui/progress-bar.tsx` stays untouched; the one-line fix for the
 * foundation is to add `"use client"` to that file.
 */
export { ProgressBar } from "@/components/ui/progress-bar"
export type { ProgressBarProps } from "@/components/ui/progress-bar"

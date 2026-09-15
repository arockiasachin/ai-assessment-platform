"use client"

import {
  ProgressBar as FoundationProgressBar,
  type ProgressBarProps,
} from "@/components/ui/progress-bar"

/**
 * Client boundary for the foundation `ProgressBar`.
 *
 * `components/ui/progress-bar.tsx` is not marked `"use client"` and renders a
 * render-prop child (`<ProgressValue>{(formattedValue) => …}</ProgressValue>`).
 * When a Server Component page imports it directly, React has to serialise that
 * function across the server → client boundary and the build fails with
 * "Functions cannot be passed directly to Client Components". Marking this
 * wrapper as a client component keeps the primitive's markup, ARIA and tones
 * intact while giving server pages a serialisable boundary (every prop here is a
 * string, number or class name).
 *
 * The proper fix belongs upstream in `components/ui/progress-bar.tsx` (add
 * `"use client"`, or render the value as a plain string instead of a render
 * prop). That file is outside this mockup's scope, so this wrapper stays until it
 * is fixed; it keeps working either way.
 */
export function ProgressBar(props: ProgressBarProps) {
  return <FoundationProgressBar {...props} />
}

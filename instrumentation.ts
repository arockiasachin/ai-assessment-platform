import type { Instrumentation } from "next"

/**
 * Next.js server instrumentation — thin runtime dispatcher.
 *
 * Next.js bundles this file for BOTH the Node.js and the Edge instrumentation
 * runtimes. Anything imported here statically ends up in the Edge bundle, and
 * the Edge runtime has neither `process.stdout` nor `process.version`, so a
 * static import would pull Node-only code in and fail (or crash at runtime).
 *
 * Keep this file almost empty: only the `NEXT_RUNTIME` gate and dynamic imports
 * of the per-runtime implementation. All Node-specific work lives in
 * `@/lib/observability/instrumentation-node`, which is imported lazily so the
 * bundler never loads it for Edge.
 *
 * If Edge-side error capture is ever needed, add an
 * `instrumentation-edge` sibling and import it under the `edge` branch.
 */

/** True only on the Node.js server runtime, where stdout and AsyncLocalStorage exist. */
function isNodeRuntime(): boolean {
  return process.env.NEXT_RUNTIME !== "edge"
}

export async function register(): Promise<void> {
  if (!isNodeRuntime()) return
  const { registerNode } = await import("@/lib/observability/instrumentation-node")
  await registerNode()
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  // On Edge there is no stdout sink, so there is nothing to write to; errors
  // reaching here on Edge are surfaced by the platform's own error reporting.
  if (!isNodeRuntime()) return
  const { onRequestErrorNode } = await import("@/lib/observability/instrumentation-node")
  await onRequestErrorNode(error, request, context)
}

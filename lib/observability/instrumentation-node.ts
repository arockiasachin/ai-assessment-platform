import type { Instrumentation } from "next"

import { describeError } from "@/lib/observability/errors"
import { newRequestId } from "@/lib/observability/ids"
import { getProcessLogger } from "@/lib/observability/logger"

/**
 * Node.js-runtime implementation of the Next.js instrumentation hooks.
 *
 * This module is imported ONLY from the Node branch of `instrumentation.ts`, and
 * only via a dynamic import. It must never be imported statically from that file:
 * it reaches Node APIs (`process.version`, `process.stdout` via the logger) that
 * do not exist on the Edge runtime, so a static import would drag them into the
 * Edge bundle and fail the build.
 *
 * `register` logs once at server start; `onRequestError` is the last-resort
 * capture for errors that escape a route handler entirely. Errors a handler
 * catches are logged by `jsonError` / `withApiRoute` with their own context.
 */

export async function registerNode(): Promise<void> {
  getProcessLogger().info("app.start", {
    node: process.version,
    environment: process.env.NODE_ENV ?? "unknown",
    runtime: process.env.NEXT_RUNTIME ?? "nodejs",
  })
}

function firstHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

/** Parameter tuple of the Next.js hook, so the signature can never drift from it. */
type OnRequestErrorParams = Parameters<Instrumentation.onRequestError>

export async function onRequestErrorNode(
  ...[error, request, context]: OnRequestErrorParams
): Promise<void> {
  const requestId = firstHeader(request.headers, "x-request-id")?.trim() || newRequestId()
  getProcessLogger().error("http.unhandled_error", {
    requestId,
    route: context.routePath || request.path,
    method: request.method,
    routeType: context.routeType,
    routerKind: context.routerKind,
    error: describeError(error),
  })
}

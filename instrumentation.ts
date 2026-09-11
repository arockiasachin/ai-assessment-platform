import type { Instrumentation } from "next"

import { describeError } from "@/lib/observability/errors"
import { newRequestId } from "@/lib/observability/ids"
import { getProcessLogger } from "@/lib/observability/logger"

/**
 * Next.js server instrumentation (dependency-free).
 *
 * `register` logs once at server start; `onRequestError` is the last-resort
 * capture for errors that escape a route handler entirely (handlers that do not
 * wrap their own try/catch). Errors that a handler catches are logged by
 * `jsonError` / `withApiRoute` with their own context.
 *
 * The process logger is silent when `LOG_LEVEL=silent` and during tests, so
 * this file adds no noise to the suite.
 */

export function register(): void {
  getProcessLogger().info("app.start", {
    node: process.version,
    environment: process.env.NODE_ENV ?? "unknown",
  })
}

function firstHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : value
}

export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
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

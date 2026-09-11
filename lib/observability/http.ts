import { NextResponse } from "next/server"

import { getLogContext, runWithLogContext } from "./context"
import { describeError } from "./errors"
import type { ActiveLogLevel, Logger } from "./logger"
import { getProcessLogger } from "./logger"
import { newRequestId } from "./ids"

/**
 * Wrap an App Router route handler with request-scoped observability.
 *
 * On every request the wrapper:
 *
 * 1. reuses the `x-request-id` injected by `proxy.ts` (or mints one) and runs
 *    the handler inside a logging context;
 * 2. emits one `http.response` line carrying status and duration;
 * 3. catches anything the handler did not, logs it with name/message/stack,
 *    and returns a generic 500 — internals never reach the client;
 * 4. echoes `x-request-id` on the response so a client can correlate a failure
 *    with the server log.
 *
 * Adoption is opt-in per route. `proxy.ts` emits an `http.request` line for
 * *every* `/api/**` request regardless, so untransitioned routes are still
 * represented in the log; adopting the wrapper adds the completion line with
 * status and duration. See `docs/observability.md`.
 */

export type ApiRouteHandler<Context = unknown> = (
  request: Request,
  context: Context,
) => Promise<Response> | Response

export type ApiRouteOptions = {
  /** Route pattern to log; defaults to the request pathname. */
  route?: string
  /** Injected for tests; defaults to the process logger. */
  logger?: Logger
}

export const GENERIC_ERROR_MESSAGE = "Unable to complete the request."

function resolveRoute(request: Request, explicit?: string): string {
  if (explicit) return explicit
  try {
    return new URL(request.url).pathname
  } catch {
    return "unknown"
  }
}

/** Emit through `logger`, merging the ambient request context first. */
function makeEmit(logger: Logger) {
  return (level: ActiveLogLevel, event: string, fields?: Record<string, unknown>): void => {
    const payload = { ...getLogContext(), ...fields }
    if (level === "debug") {
      logger.debug(event, payload)
    } else if (level === "info") {
      logger.info(event, payload)
    } else if (level === "warn") {
      logger.warn(event, payload)
    } else {
      logger.error(event, payload)
    }
  }
}

export function withApiRoute<Context = unknown>(
  handler: ApiRouteHandler<Context>,
  options: ApiRouteOptions = {},
): ApiRouteHandler<Context> {
  const emit = makeEmit(options.logger ?? getProcessLogger())

  return async (request: Request, context: Context): Promise<Response> => {
    const requestId = request.headers.get("x-request-id")?.trim() || newRequestId()
    const route = resolveRoute(request, options.route)
    const method = request.method
    const startedAt = Date.now()

    return runWithLogContext({ requestId, route, method }, async () => {
      let response: Response
      try {
        response = await handler(request, context)
      } catch (error) {
        emit("error", "http.unhandled_error", {
          route,
          method,
          requestId,
          error: describeError(error),
        })
        response = NextResponse.json(
          { success: false, message: GENERIC_ERROR_MESSAGE },
          { status: 500 },
        )
      }

      const durationMs = Date.now() - startedAt
      const status = response.status
      emit(status >= 500 ? "error" : status >= 400 ? "warn" : "info", "http.response", {
        route,
        method,
        requestId,
        status,
        durationMs,
      })
      return withRequestId(response, requestId)
    })
  }
}

function withRequestId(response: Response, requestId: string): Response {
  try {
    response.headers.set("x-request-id", requestId)
  } catch {
    // A frozen/immutable Response (not expected from Next) is returned as-is.
  }
  return response
}

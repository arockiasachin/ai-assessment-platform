import { AsyncLocalStorage } from "node:async_hooks"

/**
 * Request-scoped logging context.
 *
 * A route handler that uses `withApiRoute` runs inside an `AsyncLocalStorage`
 * store, so everything it calls — the service layer, `lib/api.ts`, the LLM
 * decorator — can attach the same correlation id and (once authorization has
 * resolved) the acting user to its log lines without threading parameters
 * through every function signature.
 *
 * The store is mutable on purpose: `requireRole` enriches it with the verified
 * actor after the handler starts, and completion logs then carry the id/role.
 * Outside a request there is no store, and `getLogContext` returns `{}`.
 */

export type LogContext = {
  requestId: string
  route?: string
  method?: string
  userId?: string
  userRole?: string
}

const storage = new AsyncLocalStorage<LogContext>()

/** Run `fn` with a fresh logging context (used by `withApiRoute`). */
export function runWithLogContext<T>(context: LogContext, fn: () => T): T {
  return storage.run({ ...context }, fn)
}

/** The current context, or `{}` when called outside a request. */
export function getLogContext(): Partial<LogContext> {
  return storage.getStore() ?? {}
}

/** Enrich the current context; a no-op when there is none. */
export function updateLogContext(patch: Partial<Omit<LogContext, "requestId">>): void {
  const store = storage.getStore()
  if (!store) return
  if (patch.route !== undefined) store.route = patch.route
  if (patch.method !== undefined) store.method = patch.method
  if (patch.userId !== undefined) store.userId = patch.userId
  if (patch.userRole !== undefined) store.userRole = patch.userRole
}

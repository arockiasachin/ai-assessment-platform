/**
 * Errors and helpers shared by the observability module.
 *
 * Kept dependency-free (no Next.js, no Prisma) so the logger core, the HTTP
 * wrapper, and the pure unit tests can all reuse it.
 */

/** A domain error whose `status` maps directly onto an HTTP response. */
export class ObservabilityError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = "ObservabilityError"
  }
}

export type ErrorDescription = {
  name: string
  message: string
  stack?: string
}

const MAX_STACK_CHARS = 4000

/**
 * Normalise any thrown value into a small, JSON-safe description. `stack` is
 * truncated so a single log line cannot balloon; the returned object is still
 * passed through the redactor, which scrubs connection strings and tokens.
 */
export function describeError(error: unknown): ErrorDescription {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack.slice(0, MAX_STACK_CHARS) } : {}),
    }
  }
  if (typeof error === "string") return { name: "Error", message: error }
  try {
    return { name: "Error", message: JSON.stringify(error) ?? String(error) }
  } catch {
    return { name: "Error", message: "Unserializable error" }
  }
}

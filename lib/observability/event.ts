import { getLogContext } from "./context"
import type { ActiveLogLevel } from "./logger"
import { getProcessLogger } from "./logger"

/**
 * Emit one record on the process logger, merging the ambient request context
 * (correlation id, route, method, and — once authorized — the acting user).
 *
 * Route code should prefer this over `getProcessLogger()` directly so that a
 * log line produced deep in a service still carries the request it belongs to.
 */
export function logEvent(
  level: ActiveLogLevel,
  event: string,
  fields?: Record<string, unknown>,
): void {
  const logger = getProcessLogger()
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

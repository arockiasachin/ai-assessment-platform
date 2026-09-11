/**
 * Redaction policy for structured logs.
 *
 * The rule is deliberately conservative: anything that could carry a credential
 * is removed *before* it is serialized, regardless of which log event produced
 * it. Two layers do the work:
 *
 * 1. **Key-based redaction** — a value under a sensitive key (`password`,
 *    `passwordHash`, `sessionSecret`, `cookie`, `authorization`, `apiKey`,
 *    `accessToken`, `databaseUrl`, `connectionString`, `providerOptions`, ...)
 *    is replaced wholesale, whatever its type.
 * 2. **String scrubbing** — free text is scanned for connection strings,
 *    `Bearer`/`Basic` tokens, the `auth-user` session cookie, and JWT-shaped
 *    values, which are replaced in place. This catches secrets that arrive
 *    inside a message or a stack trace rather than under a sensitive key.
 *
 * The redactor never throws and never mutates its input.
 */

export const REDACTED = "[redacted]"

const REDACTED_URL = "[redacted-url]"

/**
 * Phrase-level sensitive-key test. Keys are normalised to
 * `lower_snake_case` first, so `sessionSecret`, `session-secret`, and
 * `session_secret` all match. The token/counter distinction is deliberate:
 * `promptTokens` and `totalTokens` are *not* redacted (they are usage counts),
 * while `token`, `accessToken`, and `tokenCount` are.
 */
const SENSITIVE_KEY_PATTERN =
  /(?:^|_)(?:password|passwd|passphrase|passwordhash|secret|token|authorization|cookie|set_cookie|credential|credentials|private_key|access_key|api_key|apikey|session_id|sessionid|dsn|connection_string|database_url|salt|hash)(?:_|$)/

const CONNECTION_STRING_PATTERN =
  /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqp|mssql):\/\/[^\s"'`\\]+/gi

const BEARER_PATTERN = /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi

const AUTH_COOKIE_PATTERN = /\bauth-user=[^;\s"'`]+/gi

const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{8,})?\b/g

const PRIVATE_KEY_PATTERN =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g

const QUERY_SECRET_PATTERN =
  /([?&](?:password|passwd|token|access_token|refresh_token|api_key|apikey|secret)=)[^&\s"'`]+/gi

/** Normalise `sessionSecret` / `session-secret` / `SESSION_SECRET` to `session_secret`. */
function normalizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toLowerCase()
}

/** True when a value stored under `key` must never be serialized. */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(normalizeKey(key))
}

/** Replace credential-shaped substrings inside free text. */
export function scrubString(value: string): string {
  if (!value) return value
  return value
    .replace(PRIVATE_KEY_PATTERN, "[redacted-private-key]")
    .replace(CONNECTION_STRING_PATTERN, REDACTED_URL)
    .replace(BEARER_PATTERN, (match) => `${match.split(/\s+/)[0]} ${REDACTED}`)
    .replace(AUTH_COOKIE_PATTERN, "auth-user=[redacted]")
    .replace(JWT_PATTERN, "[redacted-token]")
    .replace(QUERY_SECRET_PATTERN, `$1${REDACTED}`)
}

const MAX_DEPTH = 8

/**
 * Deep-copy `value`, replacing sensitive keys and credential-shaped strings.
 * Cycles become `"[circular]"`; arrays and plain objects are walked to
 * `MAX_DEPTH`, below which the value is replaced with `"[truncated]"`.
 */
export function redactValue(value: unknown, key?: string, seen?: WeakSet<object>): unknown {
  if (key !== undefined && isSensitiveKey(key)) return REDACTED
  return redactInner(value, seen ?? new WeakSet<object>(), 0)
}

function redactInner(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (typeof value === "string") return scrubString(value)
  if (value === null || typeof value !== "object") return value

  if (depth >= MAX_DEPTH) return "[truncated]"

  if (value instanceof Date) return value.toISOString()
  if (value instanceof Error) {
    return {
      name: value.name,
      message: scrubString(value.message),
      ...(value.stack ? { stack: scrubString(value.stack) } : {}),
    }
  }

  if (seen.has(value)) return "[circular]"
  seen.add(value)

  if (Array.isArray(value)) {
    return value.map((entry) => redactInner(entry, seen, depth + 1))
  }

  const output: Record<string, unknown> = {}
  for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
    output[entryKey] = isSensitiveKey(entryKey)
      ? REDACTED
      : redactInner(entryValue, seen, depth + 1)
  }
  return output
}

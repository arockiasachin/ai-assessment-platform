import { createHmac, timingSafeEqual } from "node:crypto"

import { z } from "zod"

/**
 * Signed, expiring session value.
 *
 * This module is intentionally free of Next.js imports so it can be unit
 * tested in isolation and reused by both route handlers (`lib/auth.ts`) and the
 * request `proxy.ts`. The session is a compact `payload.signature` string:
 *
 *   base64url(JSON payload) + "." + base64url(HMAC-SHA256(secret, payload))
 *
 * Reading a session re-computes the HMAC and compares it in constant time, so a
 * client can neither forge a role nor mutate a field without invalidating the
 * signature. Sessions also expire.
 */

export const SESSION_COOKIE_NAME = "auth-user"
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7
export const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_SECONDS * 1000

export const authRoleSchema = z.enum(["admin", "teacher", "student"])
export type AuthRole = z.infer<typeof authRoleSchema>

export const authUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().min(1),
  role: authRoleSchema,
})
export type AuthUser = z.infer<typeof authUserSchema>

const sessionPayloadSchema = z.object({
  user: authUserSchema,
  expiresAt: z.number().int().positive(),
})

export type SessionPayload = z.infer<typeof sessionPayloadSchema>

/**
 * Development/test fallback. Production must supply a real secret; see
 * `getSessionSecret`. The value is deliberately obvious so a leaked
 * development cookie can never be mistaken for production material.
 */
const DEV_SESSION_SECRET = "dev-only-insecure-session-secret-do-not-use-in-production"

/**
 * Resolve the signing secret from the environment. In production a missing
 * secret is a hard, loud failure: serving sessions signed with a known fallback
 * would let anyone forge an admin cookie. Outside production we fall back to a
 * clearly non-secret value so local dev, tests, and `next build` keep working
 * without configuration.
 */
export function getSessionSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.SESSION_SECRET?.trim()
  if (secret) return secret

  if (env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET is required in production. Set a strong, random value (e.g. `openssl rand -base64 32`). Session signing is disabled until it is configured.",
    )
  }

  return DEV_SESSION_SECRET
}

function computeSignature(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url")
}

function signaturesMatch(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided, "base64url")
  const expectedBytes = Buffer.from(expected, "base64url")
  if (providedBytes.length !== expectedBytes.length) return false
  return timingSafeEqual(providedBytes, expectedBytes)
}

export type SignSessionOptions = {
  /** Overrides the environment secret; tests pass a fixed value. */
  secret?: string
  /** Overrides "now" (ms since epoch); tests can simulate expiry. */
  now?: number
  /** Overrides the session lifetime; defaults to seven days. */
  maxAgeMs?: number
}

/** Produce a signed cookie value for `user`. */
export function signSessionValue(user: AuthUser, options: SignSessionOptions = {}): string {
  const secret = options.secret ?? getSessionSecret()
  const now = options.now ?? Date.now()
  const payload: SessionPayload = {
    user,
    expiresAt: now + (options.maxAgeMs ?? SESSION_MAX_AGE_MS),
  }
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
  return `${encoded}.${computeSignature(encoded, secret)}`
}

export type VerifySessionOptions = {
  secret?: string
  now?: number
}

/**
 * Verify a cookie value and return the embedded user, or `null` when the value
 * is missing, malformed, tampered with, expired, or has an unexpected shape.
 */
export function verifySessionValue(
  value: string | null | undefined,
  options: VerifySessionOptions = {},
): AuthUser | null {
  if (!value) return null

  const separator = value.indexOf(".")
  if (separator <= 0 || separator === value.length - 1) return null

  const encoded = value.slice(0, separator)
  const providedSignature = value.slice(separator + 1)
  if (encoded.includes(".") || providedSignature.includes(".")) return null

  // Only resolve the secret once a syntactically plausible session exists, so a
  // missing request with no cookie never triggers the production failure.
  const secret = options.secret ?? getSessionSecret()
  if (!signaturesMatch(providedSignature, computeSignature(encoded, secret))) return null

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))
  } catch {
    return null
  }

  const parsed = sessionPayloadSchema.safeParse(parsedJson)
  if (!parsed.success) return null

  const now = options.now ?? Date.now()
  if (now >= parsed.data.expiresAt) return null

  return parsed.data.user
}

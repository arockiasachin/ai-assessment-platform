/**
 * Correlation-id generation. Kept in its own module (with no `node:async_hooks`
 * or Next.js import) so the request proxy, which runs ahead of the app, can
 * mint ids without pulling the request-scoped logger into its bundle.
 */

/** A URL-safe correlation id; `crypto.randomUUID` with a portable fallback. */
export function newRequestId(): string {
  const webCrypto = globalThis.crypto
  if (webCrypto && typeof webCrypto.randomUUID === "function") {
    return webCrypto.randomUUID()
  }
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

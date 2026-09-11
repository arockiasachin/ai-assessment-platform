/**
 * Vitest stub for Next.js's `server-only` sentinel.
 *
 * Next aliases `server-only` to an empty module inside a server build, but the
 * bare package is not resolvable from a plain Node/Vitest process. Aliasing it
 * to this no-op module lets data-layer tests import server modules such as
 * `lib/gradebook-db.ts` without pulling in a Next build.
 */
export {}

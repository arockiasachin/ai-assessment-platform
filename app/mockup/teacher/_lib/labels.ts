/**
 * Moved to `lib/labels.ts`.
 *
 * A real page cannot import from the mockup tree, because the tree is scheduled
 * for deletion (`docs/plans/mockup-to-backend.md` §8). Rather than copy the
 * mappings — which would give each one two homes and let them drift — the
 * canonical definitions moved to `lib/labels.ts` and this module re-exports
 * them, so every mockup page importing `../_lib/labels` keeps working unchanged.
 *
 * Delete this shim along with the rest of `app/mockup`.
 */
export * from "@/lib/labels"

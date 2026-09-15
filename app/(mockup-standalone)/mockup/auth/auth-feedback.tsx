/**
 * Moved to `components/auth-feedback.tsx`.
 *
 * A real page cannot import from the mockup tree, because the tree is scheduled
 * for deletion (`docs/plans/mockup-to-backend.md`). Rather than copy the
 * component — which would give the tone pairs two homes and let them drift — the
 * canonical definition moved to `components/`, and this module re-exports it so
 * the mockup screens keep working unchanged.
 *
 * Delete this shim along with the rest of `app/(mockup-standalone)`.
 */
export * from "@/components/auth-feedback"

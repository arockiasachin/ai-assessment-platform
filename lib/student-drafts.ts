/**
 * Where in-progress student work lives, stated once.
 *
 * ## The decision
 *
 * In-progress work has a **server-side home** — `Submission.contentText` for an assignment,
 * `QuizResponse` for a quiz answer — and the client keeps only an **overlay of edits that have
 * not been saved yet**. A server refetch may replace the overlay for every key the student has
 * not touched, but it must never discard a key they have: that is the rule both `SN-3` and
 * `SL-1` depend on.
 *
 * - `SN-3` (the assessments view) hit this directly. Saving one card called `refresh()`, which
 *   replaced the whole `submissionDrafts` map with server values, so text typed in another card
 *   vanished. `reconcileDrafts` is the overlay rule applied there.
 * - `SL-1` (a quiz sitting) had no server home at all, so there was nothing to reconcile to —
 *   reopening reset every answer to `null`. The fix there is the missing half of the same
 *   decision: an autosave path that writes answers into `QuizResponse` as they are typed, plus
 *   hydration from those rows. With the server home real, the overlay is short-lived.
 *
 * Both components therefore answer "will a refresh lose this?" with "no, because the unsaved
 * part is explicitly tracked and the saved part is on the server", rather than "no" by luck.
 */

/**
 * Merge a server snapshot of drafts with the student's local edits.
 *
 * For each key the server knows about: keep the local value when the student has touched it
 * and the edit is not yet saved (`dirty`), otherwise adopt the server value. Local keys the
 * server did not return are preserved too — dropping them would be the same loss, and a key can
 * transiently disappear (a filter, a not-yet-reloaded row) and come back.
 *
 * Pure and dependency-free so the rule is tested without a renderer.
 */
export function reconcileDrafts<T>(
  server: Record<string, T>,
  local: Record<string, T>,
  dirty: ReadonlySet<string>,
): Record<string, T> {
  const merged: Record<string, T> = {}
  for (const [id, value] of Object.entries(server)) {
    merged[id] = dirty.has(id) && id in local ? local[id] : value
  }
  for (const [id, value] of Object.entries(local)) {
    if (!(id in merged)) merged[id] = value
  }
  return merged
}

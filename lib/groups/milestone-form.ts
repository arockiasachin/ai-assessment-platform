/**
 * Pure shaping for the milestone create form.
 *
 * The milestone API has always accepted `description`, `weight` and `dueDate`; the UI sent
 * only `groupId` and `title`, so every milestone was title-only (TN-49). This turns the
 * form's strings into the request body, where an empty optional value is **omitted** (not
 * sent as null) so it keeps the schema default rather than clearing a column.
 *
 * It lives here, client-safe and free of any database import, so both the component and a
 * test can use the same rule instead of the component owning an untested copy.
 */

export type MilestoneDraft = {
  title: string
  description: string
  /** A string because it is bound to a text input; empty means "use the default". */
  weight: string
  /** `YYYY-MM-DD` from a date input, or empty. */
  dueDate: string
}

export type MilestoneCreatePayload = {
  title: string
  description?: string
  weight: number
  dueDate?: string
}

export function milestoneCreatePayload(
  draft: MilestoneDraft,
): { ok: true; body: MilestoneCreatePayload } | { ok: false; message: string } {
  const title = draft.title.trim()
  if (title === "") return { ok: false, message: "A milestone needs a title." }

  const weight = draft.weight.trim() === "" ? 1 : Number(draft.weight)
  if (!Number.isFinite(weight) || weight <= 0) {
    return { ok: false, message: "Weight must be a positive number." }
  }

  const body: MilestoneCreatePayload = { title, weight }
  const description = draft.description.trim()
  if (description !== "") body.description = description
  if (draft.dueDate.trim() !== "") body.dueDate = draft.dueDate
  return { ok: true, body }
}

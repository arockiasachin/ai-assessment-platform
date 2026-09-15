/**
 * Identity presentation for the real signed-in user.
 *
 * The `User` model has only `id` and `email` — there is **no name column**, so
 * the application cannot render a person's name and must not invent one. The
 * mockup shell shows "Dr. Meera Raman" because the fixture provides a name; real
 * data has no equivalent, so the app-scope shell shows the email as the label.
 *
 * When a name column is added (see the decision list in
 * `docs/plans/mockup-to-backend.md`), this module is the one place to change.
 */

/**
 * Initials for an avatar, derived from the email local part.
 *
 * `meera.raman@vit.ac.in` → `MR`, `aarav_mehta@…` → `AM`, `admin@…` → `AD`.
 * Splits on the separators people actually use in local parts, and never throws
 * on a degenerate address — it degrades to `?` rather than an empty avatar.
 */
export function initialsFromEmail(email: string): string {
  const local = (email.split("@")[0] ?? "").trim()
  const parts = local.split(/[._\-+]+/).filter(Boolean)
  const letters =
    parts.length >= 2
      ? `${parts[0]?.charAt(0) ?? ""}${parts[1]?.charAt(0) ?? ""}`
      : local.slice(0, 2).replace(/[^a-zA-Z0-9]/g, "")
  return letters.length > 0 ? letters.toUpperCase() : "?"
}

/** Human label for a session role: `teacher` → `Teacher`. */
export function roleLabelFromRole(role: string): string {
  if (role.length === 0) return ""
  return role.charAt(0).toUpperCase() + role.slice(1)
}

/**
 * Request normalization for the LMS-export routes (TN-54).
 *
 * An offering with no assessments has no weight configuration, and the export
 * read model represents that honestly as `{ categories: [] }`. The export
 * client round-trips whatever configuration it was given, so an empty offering's
 * download buttons send that empty config back. The request schema requires at
 * least one category — correctly, because every *real* configuration needs one —
 * so the routes normalize an empty category list to "no configuration supplied"
 * before validating.
 *
 * This does not weaken the rule: the service still refuses an empty
 * configuration for an offering that has assessments, through
 * `validateFinalGradeConfig`.
 */
export function dropEmptyFinalGradeConfig(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw
  const body = raw as Record<string, unknown>
  const config = body.config
  if (!config || typeof config !== "object" || Array.isArray(config)) return raw
  const categories = (config as { categories?: unknown }).categories
  if (!Array.isArray(categories) || categories.length > 0) return raw

  const rest = { ...body }
  delete rest.config
  return rest
}

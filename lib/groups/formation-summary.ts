/**
 * What a team-formation result actually means (TN-56).
 *
 * Formation accepts a list of weighted criteria, but a criterion is only
 * *active* when every member's roster profile carries the attribute it reads. The
 * seeded rosters do not, so the default criteria came back `active: false` with a
 * normalised weight of 0, every team scored 1, and the panel still announced
 * "worst-team score 1.000" — a number that looks like a strong result and means
 * "no criterion was applied".
 *
 * The score is real arithmetic; presenting it without saying that no criterion
 * was applied is the invented meaning. This decides the wording, so the notice
 * and the preview table cannot phrase it differently.
 */

/** The subset of a formation criterion this needs. */
export type FormationCriterionOutcome = {
  label: string
  active: boolean
}

export type FormationOutcome = {
  /** True when at least one criterion could be applied. */
  scored: boolean
  /** Labels of the criteria that could not be applied. */
  inactiveCriteria: string[]
  /** One sentence for the result heading. */
  headline: string
}

export function formationOutcome(
  criteria: readonly FormationCriterionOutcome[],
  objective: number,
): FormationOutcome {
  const active = criteria.filter((criterion) => criterion.active)
  const inactive = criteria.filter((criterion) => !criterion.active)
  const inactiveCriteria = inactive.map((criterion) => criterion.label)

  if (active.length > 0) {
    return {
      scored: true,
      inactiveCriteria,
      headline: `Worst-team score ${objective.toFixed(3)}`,
    }
  }

  if (criteria.length === 0) {
    return {
      scored: false,
      inactiveCriteria,
      headline: "No criteria were supplied, so teams were split by size alone.",
    }
  }

  return {
    scored: false,
    inactiveCriteria,
    headline:
      "No criterion could be applied — the roster has none of the attributes they read, so teams were split by size alone. The score below is not a quality measure.",
  }
}

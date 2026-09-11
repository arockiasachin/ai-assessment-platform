import { TeamFormationError } from "./errors"

/**
 * Instructor-weighted team formation, CATME-style.
 *
 * The established CATME objective is **maximise the worst-fitting team**: a set
 * of teams is good when its lowest-scoring team is as good as possible. This
 * module implements that objective as a pure, deterministic function so it can be
 * tested without a database.
 *
 * Formation criteria are instructor-controlled. Each criterion names a student
 * attribute and a preference:
 *
 *  - `categorical-diversity` — reward teams whose members differ (e.g. major).
 *  - `categorical-similarity` — reward teams whose members match (e.g. preferred
 *    meeting day).
 *  - `numeric-balance` — reward teams whose mean matches the cohort mean (e.g.
 *    GPA, so no team is stacked with high or low performers).
 *  - `numeric-spread` — reward teams that contain both high and low values.
 *
 * Schedule compatibility is a HARD constraint. A student may declare the slots
 * they are available for; a team is only ever formed when every declaring member
 * shares at least one slot. A student who declares an empty availability list
 * (`availability: []`) cannot be placed in any team and forces a loud failure
 * rather than a silently incompatible team.
 */

export type FormationCriterionKind =
  "categorical-diversity" | "categorical-similarity" | "numeric-balance" | "numeric-spread"

export type FormationCriterion = {
  id: string
  label: string
  kind: FormationCriterionKind
  /** Relative importance. Weights are normalised across the active criteria. */
  weight: number
  /** Key into `FormationStudent.attributes`. */
  attribute: string
}

export type FormationStudent = {
  studentId: string
  attributes: Readonly<Record<string, string | number | null | undefined>>
  /**
   * Availability slots the student can attend. `undefined` means "unknown /
   * unconstrained"; `[]` means "available never" and makes every team
   * incompatible for this student.
   */
  availability?: readonly string[]
}

export type FormationInput = {
  students: readonly FormationStudent[]
  criteria: readonly FormationCriterion[]
  /** Target members per team; used when `teamCount` is omitted. Default 4. */
  teamSize?: number
  /** Exact number of teams; takes precedence over `teamSize`. */
  teamCount?: number
  /** Bound on the maximin local-search passes. Default 200. */
  maxIterations?: number
}

export type FormationCriterionResult = {
  id: string
  label: string
  kind: FormationCriterionKind
  attribute: string
  weight: number
  /** Weight renormalised across the criteria that have usable cohort data. */
  normalizedWeight: number
  active: boolean
}

export type FormedTeam = {
  /** Stable index in the returned team list. */
  index: number
  memberIds: string[]
  /** Weighted criterion score in [0, 1]; higher is better-fitting. */
  score: number
  criterionScores: Record<string, number>
  compatible: boolean
  /** Intersection of members' declared slots; `[]` when all are unconstrained. */
  commonAvailability: string[]
}

export type FormationResult = {
  teams: FormedTeam[]
  /** The maximin objective: the score of the worst-fitting team. */
  objective: number
  criteria: FormationCriterionResult[]
  teamCount: number
  /** Always true on success: the algorithm never returns an incompatible team. */
  scheduleCompatible: boolean
}

const EPSILON = 1e-9
const DEFAULT_TEAM_SIZE = 4
const DEFAULT_MAX_ITERATIONS = 200

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

/** The members' shared availability slots (empty when nobody declared any). */
export function commonAvailability(members: readonly FormationStudent[]): string[] {
  const declared = members
    .filter((member) => member.availability !== undefined)
    .map((member) => member.availability ?? [])
  if (declared.length === 0) return []
  let intersection = unique(declared[0])
  for (const slots of declared.slice(1)) {
    const set = new Set(slots)
    intersection = intersection.filter((slot) => set.has(slot))
  }
  return intersection
}

/** A team is compatible when nobody declared availability or all declare a slot in common. */
export function isScheduleCompatible(members: readonly FormationStudent[]): boolean {
  const declaresAny = members.some((member) => member.availability !== undefined)
  if (!declaresAny) return true
  return commonAvailability(members).length > 0
}

function isCompatibleWith(
  members: readonly FormationStudent[],
  candidate: FormationStudent,
): boolean {
  return isScheduleCompatible([...members, candidate])
}

type CohortStats = {
  numericMean: number
  numericMaxDeviation: number
  numericRange: number
}

function numericAttributeValues(
  students: readonly FormationStudent[],
  attribute: string,
): number[] {
  const values: number[] = []
  for (const student of students) {
    const value = student.attributes[attribute]
    if (typeof value === "number" && Number.isFinite(value)) values.push(value)
  }
  return values
}

function categoricalAttributeValues(
  students: readonly FormationStudent[],
  attribute: string,
): string[] {
  const values: string[] = []
  for (const student of students) {
    const value = student.attributes[attribute]
    if (typeof value === "string" && value.trim().length > 0) values.push(value)
    else if (typeof value === "number" && Number.isFinite(value)) values.push(String(value))
  }
  return values
}

function buildCohortStats(
  criterion: FormationCriterion,
  students: readonly FormationStudent[],
): CohortStats {
  if (criterion.kind !== "numeric-balance" && criterion.kind !== "numeric-spread") {
    return { numericMean: 0, numericMaxDeviation: 0, numericRange: 0 }
  }
  const values = numericAttributeValues(students, criterion.attribute)
  if (values.length === 0) return { numericMean: 0, numericMaxDeviation: 0, numericRange: 0 }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const maxDeviation = values.reduce((max, value) => Math.max(max, Math.abs(value - mean)), 0)
  const range = Math.max(...values) - Math.min(...values)
  return { numericMean: mean, numericMaxDeviation: maxDeviation, numericRange: range }
}

/** True when a criterion can be scored for this cohort at all. */
function criterionHasData(criterion: FormationCriterion, students: readonly FormationStudent[]) {
  if (criterion.kind === "numeric-balance" || criterion.kind === "numeric-spread") {
    return numericAttributeValues(students, criterion.attribute).length >= 2
  }
  return categoricalAttributeValues(students, criterion.attribute).length >= 2
}

function scoreCategoricalDiversity(values: readonly string[]): number {
  if (values.length === 0) return 0
  return new Set(values).size / values.length
}

function scoreCategoricalSimilarity(values: readonly string[]): number {
  if (values.length === 0) return 0
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  const modal = Math.max(...counts.values())
  return modal / values.length
}

function scoreNumericBalance(values: readonly number[], stats: CohortStats): number {
  if (values.length === 0) return 0
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  if (stats.numericMaxDeviation <= 0) return 1
  const deviation = Math.abs(mean - stats.numericMean) / stats.numericMaxDeviation
  return Math.max(0, 1 - Math.min(1, deviation))
}

function scoreNumericSpread(values: readonly number[], stats: CohortStats): number {
  if (values.length === 0) return 0
  if (stats.numericRange <= 0) return 1
  const spread = Math.max(...values) - Math.min(...values)
  return Math.max(0, Math.min(1, spread / stats.numericRange))
}

function scoreTeamCriterion(
  criterion: FormationCriterion,
  members: readonly FormationStudent[],
  stats: CohortStats,
): number {
  if (criterion.kind === "categorical-diversity") {
    return scoreCategoricalDiversity(categoricalAttributeValues(members, criterion.attribute))
  }
  if (criterion.kind === "categorical-similarity") {
    return scoreCategoricalSimilarity(categoricalAttributeValues(members, criterion.attribute))
  }
  const values = numericAttributeValues(members, criterion.attribute)
  if (values.length < 2) return 0
  if (criterion.kind === "numeric-balance") return scoreNumericBalance(values, stats)
  return scoreNumericSpread(values, stats)
}

function resolveTeamCount(studentCount: number, teamSize?: number, teamCount?: number): number {
  if (teamCount !== undefined) {
    if (!Number.isInteger(teamCount) || teamCount < 1) {
      throw new TeamFormationError("teamCount must be a positive whole number.")
    }
    if (teamCount > studentCount) {
      throw new TeamFormationError("teamCount cannot exceed the number of students.")
    }
    return teamCount
  }
  const size = teamSize ?? DEFAULT_TEAM_SIZE
  if (!Number.isInteger(size) || size < 1) {
    throw new TeamFormationError("teamSize must be a positive whole number.")
  }
  return Math.max(1, Math.ceil(studentCount / size))
}

/** Distribute `count` students over `teams` as evenly as possible (largest first). */
function evenSizes(count: number, teams: number): number[] {
  const base = Math.floor(count / teams)
  const remainder = count % teams
  return Array.from({ length: teams }, (_, index) => base + (index < remainder ? 1 : 0))
}

/**
 * Form teams that maximise the worst-fitting team subject to schedule
 * compatibility. Deterministic: the same input always produces the same teams.
 */
export function formTeams(input: FormationInput): FormationResult {
  const studentById = new Map(input.students.map((student) => [student.studentId, student]))
  if (studentById.size !== input.students.length) {
    throw new TeamFormationError("Each student may appear only once in a formation run.")
  }
  if (input.students.length < 2) {
    throw new TeamFormationError("At least two students are required to form teams.")
  }
  if (input.criteria.length === 0) {
    throw new TeamFormationError("At least one formation criterion is required.")
  }
  for (const criterion of input.criteria) {
    if (!(criterion.weight >= 0) || !Number.isFinite(criterion.weight)) {
      throw new TeamFormationError(`Criterion ${criterion.id} has an invalid weight.`)
    }
  }

  const teamCount = resolveTeamCount(input.students.length, input.teamSize, input.teamCount)
  const sizes = evenSizes(input.students.length, teamCount)

  const criteriaWithData = new Set(
    input.criteria
      .filter((criterion) => criterionHasData(criterion, input.students))
      .map((criterion) => criterion.id),
  )
  const activeWeightTotal = input.criteria
    .filter((criterion) => criteriaWithData.has(criterion.id))
    .reduce((sum, criterion) => sum + criterion.weight, 0)

  const criterionResults: FormationCriterionResult[] = input.criteria.map((criterion) => {
    const active = criteriaWithData.has(criterion.id)
    const normalizedWeight =
      active && activeWeightTotal > 0
        ? criterion.weight / activeWeightTotal
        : active && criteriaWithData.size > 0
          ? 1 / criteriaWithData.size
          : 0
    return {
      id: criterion.id,
      label: criterion.label,
      kind: criterion.kind,
      attribute: criterion.attribute,
      weight: criterion.weight,
      normalizedWeight,
      active,
    }
  })

  const cohortStats = new Map<string, CohortStats>(
    input.criteria.map((criterion) => [criterion.id, buildCohortStats(criterion, input.students)]),
  )

  const activeCriteria = criterionResults.filter((criterion) => criterion.active)
  const scoreTeam = (
    members: readonly FormationStudent[],
  ): {
    score: number
    criterionScores: Record<string, number>
  } => {
    // Nothing to optimise (no criterion has usable cohort data): every team is
    // neutral, so the maximin objective does not punish an unconfigured run.
    if (activeCriteria.length === 0) return { score: 1, criterionScores: {} }
    const criterionScores: Record<string, number> = {}
    let score = 0
    for (const criterion of activeCriteria) {
      const value = scoreTeamCriterion(
        criterion,
        members,
        cohortStats.get(criterion.id) ?? {
          numericMean: 0,
          numericMaxDeviation: 0,
          numericRange: 0,
        },
      )
      criterionScores[criterion.id] = value
      score += criterion.normalizedWeight * value
    }
    return { score, criterionScores }
  }

  // Least-constrained-last deterministic construction: place the students whose
  // availability is tightest first, so a feasible arrangement is found whenever
  // one exists under this greedy rule.
  const constructionOrder = [...input.students].sort((left, right) => {
    const leftDeclared =
      left.availability === undefined ? Number.POSITIVE_INFINITY : left.availability.length
    const rightDeclared =
      right.availability === undefined ? Number.POSITIVE_INFINITY : right.availability.length
    if (leftDeclared !== rightDeclared) return leftDeclared - rightDeclared
    return left.studentId.localeCompare(right.studentId)
  })

  const assignment: FormationStudent[][] = Array.from({ length: teamCount }, () => [])
  for (const student of constructionOrder) {
    const candidates = assignment
      .map((members, index) => ({ members, index }))
      .filter(({ members, index }) => members.length < sizes[index])
      .filter(({ members }) => isCompatibleWith(members, student))
      .sort((left, right) => {
        // Prefer a team that already has members sharing a slot with the
        // candidate, so schedule-compatible students cluster into the same team.
        const affinity = (team: FormationStudent[]) => {
          if (!student.availability || student.availability.length === 0) return 0
          return team.filter(
            (member) =>
              member.availability !== undefined &&
              member.availability.some((slot) => student.availability!.includes(slot)),
          ).length
        }
        const affinityDelta = affinity(right.members) - affinity(left.members)
        if (affinityDelta !== 0) return affinityDelta
        return left.members.length - right.members.length || left.index - right.index
      })
    if (candidates.length === 0) {
      throw new TeamFormationError(
        `Student ${student.studentId} cannot be placed in a schedule-compatible team.`,
      )
    }
    candidates[0].members.push(student)
  }

  let scores = assignment.map((members) => scoreTeam(members).score)
  let objective = Math.min(...scores)

  const maxIterations = input.maxIterations ?? DEFAULT_MAX_ITERATIONS
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let best: { i: number; j: number; a: number; b: number; resultingMin: number } | null = null
    for (let i = 0; i < teamCount; i += 1) {
      for (let j = i + 1; j < teamCount; j += 1) {
        for (let a = 0; a < assignment[i].length; a += 1) {
          for (let b = 0; b < assignment[j].length; b += 1) {
            const left = assignment[i][a]
            const right = assignment[j][b]
            const nextLeft = [...assignment[i]]
            nextLeft[a] = right
            const nextRight = [...assignment[j]]
            nextRight[b] = left
            if (!isScheduleCompatible(nextLeft) || !isScheduleCompatible(nextRight)) continue
            const nextScores = [...scores]
            nextScores[i] = scoreTeam(nextLeft).score
            nextScores[j] = scoreTeam(nextRight).score
            const resultingMin = Math.min(...nextScores)
            if (resultingMin > objective + EPSILON) {
              if (!best || resultingMin > best.resultingMin + EPSILON) {
                best = { i, j, a, b, resultingMin }
              }
            }
          }
        }
      }
    }
    if (!best) break
    const { i, j, a, b } = best
    const left = assignment[i][a]
    assignment[i][a] = assignment[j][b]
    assignment[j][b] = left
    scores = assignment.map((members) => scoreTeam(members).score)
    objective = Math.min(...scores)
  }

  const teams: FormedTeam[] = assignment.map((members, index) => {
    const memberIds = members.map((member) => member.studentId).sort((a, b) => a.localeCompare(b))
    const { score, criterionScores } = scoreTeam(members)
    return {
      index,
      memberIds,
      score,
      criterionScores,
      compatible: isScheduleCompatible(members),
      commonAvailability: commonAvailability(members),
    }
  })

  return {
    teams,
    objective: Math.min(...teams.map((team) => team.score)),
    criteria: criterionResults,
    teamCount,
    scheduleCompatible: teams.every((team) => team.compatible),
  }
}

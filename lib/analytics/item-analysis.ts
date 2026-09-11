/**
 * Item analysis from real quiz attempts (classical test theory).
 *
 * Every index below is derived from `QuizResponse` rows only; nothing is
 * inferred from model-generated `Question.difficulty`. The two indices are
 * documented here because the exact formula and the small-sample policy are
 * part of the product contract.
 *
 * ## Difficulty
 *
 * The classical item difficulty (facility) index is the proportion of
 * *answered* attempts that were correct:
 *
 *     facilityIndex = correctAnswered / answered
 *
 * We report the mirror image as `difficultyIndex = 1 - facilityIndex` so that
 * a larger number always means "harder", which is how teachers read a
 * difficulty column. Unanswered/blank responses are excluded from the
 * denominator (they are counted in `unansweredCount`) so a question that
 * everyone skipped is not mistaken for a question everyone failed.
 *
 * ## Discrimination
 *
 * The discrimination index is the extreme-groups D at 27%:
 *
 *     D = (correctInUpper / upperSize) - (correctInLower / lowerSize)
 *
 * Students are ranked by their total score on that assessment (ties broken by
 * ascending student id so the result is deterministic). The upper group is the
 * top `round(n * 0.27)` students and the lower group the bottom
 * `round(n * 0.27)`; an unanswered item counts as zero (no credit), which is
 * standard for a 0/1 item score. D ranges `[-1, 1]`: positive means high
 * scorers answered it right more often than low scorers (the item behaves),
 * zero means the item is uninformative, negative means it discriminates
 * backwards and is a red flag.
 *
 * ## Small samples
 *
 * Both indices are volatile when few students have attempted the item, so
 * below a minimum we return `null` and say so instead of emitting a number
 * that would be read as real:
 *
 * - difficulty needs at least 10 answered attempts. At 9 answered, a single
 *   response moves the index by ~0.11, which is larger than the gap between
 *   "hard" and "easy" on most grading scales, so it is not actionable.
 * - discrimination needs at least 20 scored attempts. The extreme-groups
 *   method compares the top and bottom 27%; at 19 attempts each group holds
 *   5 students, so one response shifts D by 0.2 and one outlier can flip its
 *   sign. At 20 the groups hold 5-6 and the estimate is still noisy but no
 *   longer determined by a single student.
 */

export type ItemAnalysisThresholds = {
  /** Minimum answered responses before a difficulty index is reported. */
  minAttemptsForDifficulty: number
  /** Minimum scored responses before a discrimination index is reported. */
  minAttemptsForDiscrimination: number
  /** Fraction of the cohort placed in each extreme group (upper / lower). */
  extremeGroupFraction: number
}

export const DEFAULT_ITEM_ANALYSIS_THRESHOLDS: ItemAnalysisThresholds = {
  minAttemptsForDifficulty: 10,
  minAttemptsForDiscrimination: 20,
  extremeGroupFraction: 0.27,
}

export type ItemResponseInput = {
  studentId: string
  /** `null` means the student did not answer / no response row exists. */
  isCorrect: boolean | null
}

export type ItemAnalysisInput = {
  questionId: string
  /** One entry per student whose latest attempt covers this question. */
  responses: readonly ItemResponseInput[]
  /** Total score per student for the whole assessment, used to rank the groups. */
  studentTotals: ReadonlyMap<string, number>
  thresholds?: Partial<ItemAnalysisThresholds>
}

export type ItemAnalysis = {
  questionId: string
  /** Responses considered (one per student's latest attempt). */
  attemptCount: number
  /** Responses that were actually answered (`isCorrect !== null`). */
  answeredCount: number
  correctCount: number
  incorrectCount: number
  unansweredCount: number
  /** Proportion correct, `correctCount / answeredCount`. Higher = easier. */
  facilityIndex: number | null
  /** `1 - facilityIndex`. Higher = harder. */
  difficultyIndex: number | null
  /** Extreme-groups D at 27%. Positive = good discrimination. */
  discriminationIndex: number | null
  discriminationMethod: "extreme-groups-27" | null
  upperGroupSize: number
  lowerGroupSize: number
  upperCorrect: number
  lowerCorrect: number
  difficultyInsufficientData: boolean
  discriminationInsufficientData: boolean
  /** Aggregated convenience flag: either index is missing. */
  insufficientData: boolean
  /** Human-readable reasons for any withheld index. */
  notes: string[]
}

function roundTo(value: number, decimals = 4): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

export function analyzeItem(input: ItemAnalysisInput): ItemAnalysis {
  const thresholds = { ...DEFAULT_ITEM_ANALYSIS_THRESHOLDS, ...input.thresholds }
  const notes: string[] = []

  const answered = input.responses.filter((response) => response.isCorrect !== null)
  const correctCount = answered.filter((response) => response.isCorrect === true).length
  const incorrectCount = answered.length - correctCount
  const unansweredCount = input.responses.length - answered.length

  let facilityIndex: number | null = null
  let difficultyIndex: number | null = null
  const difficultyInsufficientData = answered.length < thresholds.minAttemptsForDifficulty
  if (!difficultyInsufficientData) {
    facilityIndex = roundTo(correctCount / answered.length)
    difficultyIndex = roundTo(1 - facilityIndex)
  } else {
    notes.push(
      `Difficulty withheld: ${answered.length} answered response(s) is below the minimum of ${thresholds.minAttemptsForDifficulty}.`,
    )
  }

  const scored = input.responses.filter((response) => input.studentTotals.has(response.studentId))
  const discriminationInsufficientData = scored.length < thresholds.minAttemptsForDiscrimination

  let discriminationIndex: number | null = null
  let discriminationMethod: ItemAnalysis["discriminationMethod"] = null
  let upperGroupSize = 0
  let lowerGroupSize = 0
  let upperCorrect = 0
  let lowerCorrect = 0

  if (!discriminationInsufficientData) {
    const ranked = [...scored].sort((left, right) => {
      const leftTotal = input.studentTotals.get(left.studentId) ?? 0
      const rightTotal = input.studentTotals.get(right.studentId) ?? 0
      if (rightTotal !== leftTotal) return rightTotal - leftTotal
      return left.studentId.localeCompare(right.studentId)
    })
    const n = ranked.length
    // `round(n * 0.27)`, never larger than half the cohort so the upper and
    // lower groups cannot overlap.
    const groupSize = Math.max(1, Math.min(Math.round(n * thresholds.extremeGroupFraction), n >> 1))
    upperGroupSize = groupSize
    lowerGroupSize = groupSize
    const upper = ranked.slice(0, groupSize)
    const lower = ranked.slice(n - groupSize)
    upperCorrect = upper.filter((response) => response.isCorrect === true).length
    lowerCorrect = lower.filter((response) => response.isCorrect === true).length
    discriminationIndex = roundTo(upperCorrect / groupSize - lowerCorrect / groupSize)
    discriminationMethod = "extreme-groups-27"
  } else {
    notes.push(
      `Discrimination withheld: ${scored.length} scored response(s) is below the minimum of ${thresholds.minAttemptsForDiscrimination}.`,
    )
  }

  return {
    questionId: input.questionId,
    attemptCount: input.responses.length,
    answeredCount: answered.length,
    correctCount,
    incorrectCount,
    unansweredCount,
    facilityIndex,
    difficultyIndex,
    discriminationIndex,
    discriminationMethod,
    upperGroupSize,
    lowerGroupSize,
    upperCorrect,
    lowerCorrect,
    difficultyInsufficientData,
    discriminationInsufficientData,
    insufficientData: difficultyInsufficientData || discriminationInsufficientData,
    notes,
  }
}

/**
 * The five behaviourally-anchored peer-evaluation dimensions of the CATME model,
 * the established standard for team peer evaluation. Each dimension carries five
 * anchors describing observable behaviour on a 1..5 scale so a rating means the
 * same thing to every student and to the instructor.
 *
 * This module is pure and dependency-free: the API contract, the student UI, and
 * the adjustment-factor maths all read the same definition from here.
 */

export type PeerEvaluationDimensionKey =
  | "contributing"
  | "interacting"
  | "keepingOnTrack"
  | "expectingQuality"
  | "knowledgeSkillsAbilities"

export type PeerEvaluationDimension = {
  key: PeerEvaluationDimensionKey
  label: string
  /** Short prompt shown above the 1..5 control. */
  prompt: string
  /** Descriptive anchors, index 0 = score 1 … index 4 = score 5. */
  anchors: readonly [string, string, string, string, string]
}

export const PEER_EVALUATION_ANCHOR_VERSION = "catme-5anchors-v1"

export const PEER_EVALUATION_SCALE_MIN = 1
export const PEER_EVALUATION_SCALE_MAX = 5

export const PEER_EVALUATION_DIMENSIONS: readonly PeerEvaluationDimension[] = [
  {
    key: "contributing",
    label: "Contributing to the team's work",
    prompt: "How much does this person contribute to the team's work?",
    anchors: [
      "Does not contribute; relies on teammates to do the work.",
      "Contributes only when prompted and does less than a fair share.",
      "Contributes an acceptable share of the work.",
      "Contributes more than a fair share and takes initiative.",
      "Contributes a great deal; the team's work depends on them.",
    ],
  },
  {
    key: "interacting",
    label: "Interacting with teammates",
    prompt: "How well does this person interact with the team?",
    anchors: [
      "Rarely listens; talks about unrelated things.",
      "Sometimes listens and shares, but often goes off topic.",
      "Listens and contributes to the team's discussion.",
      "Encourages and supports teammates regularly.",
      "Always encourages, supports, and helps teammates collaborate.",
    ],
  },
  {
    key: "keepingOnTrack",
    label: "Keeping the team on track",
    prompt: "How well does this person keep the team on track?",
    anchors: [
      "Does not help the team organise or stay on track.",
      "Occasionally reminds the team of deadlines or goals.",
      "Helps the team plan and stay on track.",
      "Actively plans and nudges the team toward its goals.",
      "Leads planning and keeps the team reliably on schedule.",
    ],
  },
  {
    key: "expectingQuality",
    label: "Expecting quality",
    prompt: "How much quality does this person expect from the team?",
    anchors: [
      "Accepts any output, regardless of quality.",
      "Expects some quality but rarely speaks up.",
      "Expects and asks for quality work.",
      "Encourages the team to meet a high standard.",
      "Demands and helps produce high-quality work.",
    ],
  },
  {
    key: "knowledgeSkillsAbilities",
    label: "Having relevant knowledge, skills and abilities",
    prompt: "Does this person bring the knowledge, skills and abilities the team needs?",
    anchors: [
      "Brings no relevant knowledge, skills or abilities.",
      "Brings some relevant knowledge, skills or abilities.",
      "Brings the knowledge, skills and abilities the team needs.",
      "Brings strong, relevant knowledge, skills and abilities.",
      "Brings excellent and highly relevant knowledge, skills and abilities.",
    ],
  },
] as const

export const PEER_EVALUATION_DIMENSION_KEYS: readonly PeerEvaluationDimensionKey[] =
  PEER_EVALUATION_DIMENSIONS.map((dimension) => dimension.key)

export function isPeerEvaluationDimensionKey(value: string): value is PeerEvaluationDimensionKey {
  return (PEER_EVALUATION_DIMENSION_KEYS as readonly string[]).includes(value)
}

export type PeerEvaluationRatings = Record<PeerEvaluationDimensionKey, number>

/** A comparable numeric summary of one rating set: the mean of the dimensions. */
export function overallFromRatings(ratings: PeerEvaluationRatings): number {
  let total = 0
  for (const key of PEER_EVALUATION_DIMENSION_KEYS) total += ratings[key]
  return total / PEER_EVALUATION_DIMENSION_KEYS.length
}

/**
 * Validate a rating set: every dimension present and each rating a whole number
 * within the 1..5 scale. Returns the list of problems (empty when valid) so
 * callers can surface all of them at once.
 */
export function findRatingIssues(ratings: Partial<Record<string, unknown>>): string[] {
  const issues: string[] = []
  for (const key of PEER_EVALUATION_DIMENSION_KEYS) {
    const value = ratings[key]
    if (typeof value !== "number" || !Number.isInteger(value)) {
      issues.push(`${key} must be a whole number.`)
      continue
    }
    if (value < PEER_EVALUATION_SCALE_MIN || value > PEER_EVALUATION_SCALE_MAX) {
      issues.push(
        `${key} must be between ${PEER_EVALUATION_SCALE_MIN} and ${PEER_EVALUATION_SCALE_MAX}.`,
      )
    }
  }
  return issues
}

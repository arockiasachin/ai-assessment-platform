import {
  PEER_EVALUATION_ANCHOR_VERSION,
  PEER_EVALUATION_DIMENSION_KEYS,
  type PeerEvaluationRatings,
} from "./dimensions"

/**
 * How a peer evaluation is persisted in `PeerEvaluation.dimensions` (a JSON
 * column). The schema is frozen and `PeerEvaluation` has no per-dimension
 * columns, so the five ratings live in this envelope together with the anchor
 * version that gives each number its meaning.
 */
export type StoredEvaluationDimensions = {
  anchorVersion: string
  ratings: PeerEvaluationRatings
}

export function toStoredDimensions(ratings: PeerEvaluationRatings): StoredEvaluationDimensions {
  return { anchorVersion: PEER_EVALUATION_ANCHOR_VERSION, ratings }
}

export function readStoredRatings(dimensions: unknown): PeerEvaluationRatings | null {
  if (!dimensions || typeof dimensions !== "object") return null
  const raw = (dimensions as { ratings?: unknown }).ratings
  if (!raw || typeof raw !== "object") return null
  const source = raw as Record<string, unknown>
  const ratings = {} as PeerEvaluationRatings
  for (const key of PEER_EVALUATION_DIMENSION_KEYS) {
    const value = source[key]
    if (typeof value !== "number") return null
    ratings[key] = value
  }
  return ratings
}

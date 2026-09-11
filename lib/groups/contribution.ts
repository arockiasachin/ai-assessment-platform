import type { ContributionEventType } from "@/lib/generated/prisma/client"

/**
 * Contribution signals (commits, pull requests, …) are a SECONDARY evidence
 * signal. The product rule is explicit: contribution metrics are presented as
 * evidence and must never be the sole basis for a grade. Every payload this pod
 * emits carries that disclaimer (`CONTRIBUTION_EVIDENCE_DISCLAIMER`), and the
 * free-rider detector refuses to flag a member on contribution data alone.
 */

export const CONTRIBUTION_EVIDENCE_NOTICE =
  "Contribution metrics are secondary evidence only and must never be the sole basis for a grade."

export const CONTRIBUTION_EVIDENCE_DISCLAIMER = {
  evidenceOnly: true,
  gradeBasis: false,
  notice: CONTRIBUTION_EVIDENCE_NOTICE,
} as const

export type ContributionSignalInput = {
  studentId: string | null
  type: ContributionEventType | string
  weight: number
  occurredAt: Date | string
}

export type ContributionSummary = {
  studentId: string | null
  eventCount: number
  totalWeight: number
  byType: Record<string, number>
  firstAt: string | null
  lastAt: string | null
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

/**
 * Aggregate contribution events per student. Unattributed events (`studentId`
 * null) are grouped under a `null` bucket so the instructor can see work that
 * was not linked to a person, rather than silently dropping it.
 */
export function summarizeContributions(
  events: readonly ContributionSignalInput[],
): ContributionSummary[] {
  const byStudent = new Map<string | null, ContributionSummary>()
  for (const event of events) {
    const key = event.studentId
    const existing = byStudent.get(key) ?? {
      studentId: key,
      eventCount: 0,
      totalWeight: 0,
      byType: {},
      firstAt: null,
      lastAt: null,
    }
    const occurredAt = toIso(event.occurredAt)
    existing.eventCount += 1
    existing.totalWeight += Number.isFinite(event.weight) ? event.weight : 0
    existing.byType[event.type] = (existing.byType[event.type] ?? 0) + 1
    if (existing.firstAt === null || occurredAt < existing.firstAt) existing.firstAt = occurredAt
    if (existing.lastAt === null || occurredAt > existing.lastAt) existing.lastAt = occurredAt
    byStudent.set(key, existing)
  }
  return [...byStudent.values()].sort((left, right) => {
    if (left.studentId === null) return 1
    if (right.studentId === null) return -1
    return left.studentId.localeCompare(right.studentId)
  })
}

/**
 * Mockup formatting helpers.
 *
 * The **real-data-safe** helpers now live in `lib/format.ts` and are re-exported
 * here, because eight real modules were importing them from this file — a
 * dependency on a tree that is scheduled for reduction to test fixtures. Same
 * move, and for the same reason, as `lib/labels.ts`.
 *
 * What stays here is the mockup-specific part: the fixed `MOCK_NOW` clock and the
 * three helpers anchored to it. **These must not be used on real data** — they
 * would state a "2 days ago" measured against a frozen 15 Sep 2026 clock.
 */

/** The fixed "now" the mockups are written against. */
export const MOCK_NOW = "2026-09-15T13:30:00.000Z"

export {
  daysBetween,
  formatConfidence,
  formatDate,
  formatDateTime,
  formatDuration,
  formatPercent,
  formatPoints,
  formatShortDate,
  initialsFromName,
  trimNumber,
} from "@/lib/format"

import { daysBetween, formatDate } from "@/lib/format"

/** "3 days ago", "in 2 hours", "just now". Deterministic via `MOCK_NOW`. */
export function formatRelativeTime(iso: string, now: string = MOCK_NOW): string {
  const deltaMs = new Date(iso).getTime() - new Date(now).getTime()
  const abs = Math.abs(deltaMs)
  const future = deltaMs > 0
  const suffix = (text: string) => (future ? `in ${text}` : `${text} ago`)

  if (abs < 60_000) return "just now"
  if (abs < 3_600_000) return suffix(`${Math.round(abs / 60_000)} min`)
  if (abs < 86_400_000) return suffix(`${Math.round(abs / 3_600_000)} h`)
  const days = Math.round(abs / 86_400_000)
  if (days <= 30) return suffix(`${days} ${days === 1 ? "day" : "days"}`)
  return formatDate(iso)
}

/** Whole days from `MOCK_NOW` to `iso`; negative when the date has passed. */
export function daysUntil(iso: string, now: string = MOCK_NOW): number {
  return daysBetween(iso, now)
}

/** "Due in 4 days" / "Overdue by 2 days" / "Due today". */
export function formatDueLabel(iso: string, now: string = MOCK_NOW): string {
  const days = daysUntil(iso, now)
  if (days === 0) return "Due today"
  if (days === 1) return "Due tomorrow"
  if (days > 1) return `Due in ${days} days`
  const overdue = Math.abs(days)
  return `Overdue by ${overdue} ${overdue === 1 ? "day" : "days"}`
}

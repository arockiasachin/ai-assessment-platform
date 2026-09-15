/**
 * Pure formatting helpers that are safe on **real** data.
 *
 * These used to live in `lib/mock/format.ts`, which meant eight real modules
 * imported from the mockup tree — the same trap `lib/labels.ts` was created to
 * close, because `lib/mock/**` is scheduled for reduction to test fixtures. The
 * mock module now re-exports these, so the mockups keep working and each helper
 * has one definition.
 *
 * Two deliberate properties, both of which this module exists to enforce:
 *
 * - every date is formatted in **UTC** with an explicit `timeZone`, so a Server
 *   Component and the browser cannot disagree about the rendered string. A
 *   `toLocaleString` without `timeZone` renders differently on a UTC server and a
 *   non-UTC browser, which is a hydration mismatch — this project has hit that
 *   class of bug more than once;
 * - every helper returns an em dash for "no value", never `0` or an empty string,
 *   so a missing value and a zero never look alike.
 *
 * Deliberately **not** here: `formatRelativeTime`, `daysUntil` and
 * `formatDueLabel`. They are anchored to the mockups' frozen `MOCK_NOW` clock, so
 * using them on real data would state a "2 days ago" the data cannot support.
 */

const DAY_MS = 24 * 60 * 60 * 1000

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
})

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
})

const dayMonthFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
})

/** "84%" — or an em dash when there is genuinely no value yet. */
export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—"
  return `${value.toFixed(digits)}%`
}

/** "17 / 20" — points out of a maximum. */
export function formatPoints(points: number | null | undefined, maxPoints: number): string {
  if (points === null || points === undefined || Number.isNaN(points)) return `— / ${maxPoints}`
  return `${trimNumber(points)} / ${maxPoints}`
}

/** "0.82" → "82%" for confidence values expressed as 0..1. */
export function formatConfidence(confidence: number | null | undefined): string {
  if (confidence === null || confidence === undefined || Number.isNaN(confidence)) return "—"
  return `${Math.round(confidence * 100)}%`
}

/** "12 Oct 2026" (UTC). */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  return dateFormatter.format(new Date(iso))
}

/** "12 Oct 2026, 14:05" (UTC). */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—"
  return dateTimeFormatter.format(new Date(iso))
}

/** "12 Oct" — for dense tables where the year is implied by the term. */
export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return "—"
  return dayMonthFormatter.format(new Date(iso))
}

/** Whole days between two instants. Callers must supply both — no implicit clock. */
export function daysBetween(iso: string, from: string): number {
  return Math.round((new Date(iso).getTime() - new Date(from).getTime()) / DAY_MS)
}

/** "1h 12m", "42m 10s", "8.4s" — for quiz timers and test runs. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return "—"
  if (ms < 1000) return `${Math.round(ms)}ms`
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return `${minutes}m ${seconds}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

/** Drop a trailing ".0" so "17.0" reads as "17". */
export function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

/** "Alexandria Catherine Montgomery-Worthington" → "AM". */
export function initialsFromName(name: string): string {
  const parts = name
    .split(/\s+/)
    .map((part) => part.replace(/[^\p{L}]/gu, ""))
    .filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

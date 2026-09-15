/**
 * Pure formatting helpers for the mockup layer.
 *
 * Two deliberate choices keep the mockups hydration-safe:
 *
 *  - every date is formatted in **UTC** with an explicit `timeZone`, so a
 *    Server Component and the browser cannot disagree about the rendered
 *    string;
 *  - relative time is measured against a fixed `MOCK_NOW` clock instead of
 *    `Date.now()`, so "2 days ago" cannot change between the server render and
 *    hydration (and the fixtures stay reproducible).
 */

/** The fixed "now" the mockups are written against. */
export const MOCK_NOW = "2026-09-15T13:30:00.000Z"

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

/** "3 days ago", "in 2 hours", "just now". Deterministic via `MOCK_NOW`. */
export function formatRelativeTime(iso: string, now: string = MOCK_NOW): string {
  const deltaMs = new Date(iso).getTime() - new Date(now).getTime()
  const abs = Math.abs(deltaMs)
  const future = deltaMs > 0
  const suffix = (text: string) => (future ? `in ${text}` : `${text} ago`)

  if (abs < 60_000) return "just now"
  if (abs < 3_600_000) return suffix(`${Math.round(abs / 60_000)} min`)
  if (abs < DAY_MS) return suffix(`${Math.round(abs / 3_600_000)} h`)
  const days = Math.round(abs / DAY_MS)
  if (days <= 30) return suffix(`${days} ${days === 1 ? "day" : "days"}`)
  return formatDate(iso)
}

/** Whole days from `MOCK_NOW` to `iso`; negative when the date has passed. */
export function daysUntil(iso: string, now: string = MOCK_NOW): number {
  const deltaMs = new Date(iso).getTime() - new Date(now).getTime()
  return Math.round(deltaMs / DAY_MS)
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

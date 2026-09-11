/**
 * RFC 4180 CSV serialization.
 *
 * Deliberately tiny and dependency-free. The only interesting behaviour is
 * quoting: a field is wrapped in double quotes when it contains a comma, a
 * double quote, or a line break, and embedded quotes are doubled. OneRoster
 * titles and comments are free text, so this escaping is load-bearing.
 */

/** OneRoster's CSV binding uses CRLF line endings. */
export const CSV_LINE_BREAK = "\r\n"

export type CsvValue = string | number | null | undefined

/** Quote a single field when it needs it, doubling embedded quotes. */
export function escapeCsvField(value: CsvValue): string {
  const text = value === null || value === undefined ? "" : String(value)
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

/**
 * Serialize rows to a CSV document. A trailing CRLF is emitted after the last
 * row, which is legal RFC 4180 and keeps the output stable for tests.
 */
export function toCsv(rows: readonly (readonly CsvValue[])[]): string {
  if (rows.length === 0) return ""
  const body = rows.map((row) => row.map(escapeCsvField).join(",")).join(CSV_LINE_BREAK)
  return `${body}${CSV_LINE_BREAK}`
}

/** Fixed-decimal formatting that never emits `NaN` or `Infinity`. */
export function formatCsvNumber(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return ""
  return value.toFixed(decimals)
}

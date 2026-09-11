"use client"

import { useMemo, useState } from "react"

type DatasetRow = Record<string, unknown>

type Dataset = {
  name: string
  count: number
  rows: DatasetRow[]
}

function cellText(value: unknown) {
  if (value === null || value === undefined) return "-"
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  return JSON.stringify(value)
}

export function AdminDatasetsView({ datasets }: { datasets: Dataset[] }) {
  const [view, setView] = useState<"table" | "json">("table")

  const prepared = useMemo(
    () =>
      datasets.map((dataset) => {
        const first = dataset.rows[0] ?? {}
        const columns = Object.keys(first)
        return {
          ...dataset,
          columns,
        }
      }),
    [datasets],
  )

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Table data</h2>
        <div className="inline-flex rounded-lg border border-border bg-muted/30 p-1">
          <button
            type="button"
            onClick={() => setView("table")}
            className={
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
              (view === "table" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")
            }
          >
            Table view
          </button>
          <button
            type="button"
            onClick={() => setView("json")}
            className={
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
              (view === "json" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")
            }
          >
            JSON view
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {prepared.map((dataset) => (
          <section key={dataset.name} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">{dataset.name}</h3>
              <span className="rounded-md border border-border bg-muted/50 px-2 py-0.5 text-xs font-medium">
                {dataset.count} rows
              </span>
            </div>

            {view === "json" ? (
              <pre className="max-h-64 overflow-auto rounded-lg bg-muted/25 p-3 text-xs leading-5">
                {JSON.stringify(dataset.rows, null, 2)}
              </pre>
            ) : dataset.rows.length === 0 ? (
              <p className="rounded-lg bg-muted/25 p-3 text-xs text-muted-foreground">No rows found.</p>
            ) : (
              <div className="max-h-64 overflow-auto rounded-lg border border-border">
                <table className="min-w-full divide-y divide-border text-xs">
                  <thead className="bg-muted/40">
                    <tr>
                      {dataset.columns.map((col) => (
                        <th key={col} className="px-2 py-2 text-left font-medium text-muted-foreground">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {dataset.rows.map((row, idx) => (
                      <tr key={`${dataset.name}-${idx}`} className="odd:bg-background even:bg-muted/20">
                        {dataset.columns.map((col) => (
                          <td key={col} className="max-w-[240px] truncate px-2 py-1.5" title={cellText(row[col])}>
                            {cellText(row[col])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}

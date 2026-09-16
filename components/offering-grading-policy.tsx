"use client"

import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StatusPill, type StatusKey } from "@/components/ui/status-pill"
import type { OfferingGradingResponse } from "@/lib/contracts/courses"

/**
 * The CAT/FAT grading policy for one offering.
 *
 * ## Why this exists at all
 *
 * `lib/grading/policy.ts` encoded the owner's rules — the CAT/FAT split, the minimum-CAT gate for
 * sitting the FAT, and which marks may enter a mean — but nothing called it, and a policy no
 * teacher can set is not a feature. This is the write surface that makes it real, alongside the
 * export, which now reads the stored policy.
 *
 * ## What it deliberately does not do
 *
 * **It does not apply a default to an unconfigured offering.** With nothing stored, this shows
 * the CAT 40 / FAT 60 default as a *prefill* and says plainly that nothing is in force yet. The
 * alternative — treating the default as stored — would put 60% of a course's weight on whichever
 * assessment happens to fall due last, because the FAT is derived by due date. That is the same
 * error the platform refuses to make with an exported letter grade: an institutional record that
 * disagrees with the result sheet is worse than one that is silent.
 *
 * The gate is likewise **reported, not enforced**: no verdicts are shown until a policy is
 * stored, and nothing here refuses a FAT attempt. Enforcement at attempt time is a separate
 * change, recorded as such rather than half-built.
 *
 * Data loads on expand rather than on mount, so a teacher with six offerings does not pay for six
 * grading queries to look at the page.
 */

const STATUS_LABEL: Record<string, string> = {
  eligible: "Eligible for FAT",
  "below-cat-minimum": "Below CAT minimum",
  "insufficient-cat-work": "Too little marked",
  "no-cat-gate": "No CAT gate",
}

const STATUS_PILL: Record<string, StatusKey> = {
  eligible: "passed",
  "below-cat-minimum": "failed",
  "insufficient-cat-work": "insufficient-data",
  "no-cat-gate": "draft",
}

type Draft = {
  catWeight: string
  fatWeight: string
  finalAssessmentId: string
  minimumCatPercent: string
  gateDisabled: boolean
}

function toDraft(payload: OfferingGradingResponse): Draft {
  return {
    catWeight: String(payload.config.catWeight),
    fatWeight: String(payload.config.fatWeight),
    finalAssessmentId: payload.config.finalAssessmentId ?? "",
    minimumCatPercent:
      payload.config.minimumCatPercent === null ? "30" : String(payload.config.minimumCatPercent),
    gateDisabled: payload.config.minimumCatPercent === null,
  }
}

export function OfferingGradingPolicy({ offeringId }: { offeringId: string }) {
  const [open, setOpen] = useState(false)
  const [payload, setPayload] = useState<OfferingGradingResponse | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/teacher/offerings/${offeringId}/grading`, {
        cache: "no-store",
      })
      if (!response.ok) {
        setError("Unable to load the grading policy.")
        return
      }
      const data = (await response.json()) as OfferingGradingResponse
      setPayload(data)
      setDraft(toDraft(data))
    } finally {
      setLoading(false)
    }
  }

  /**
   * Load on demand, from the click that opens the panel.
   *
   * Deliberately **not** a `useEffect` that watches `open`: fetching from an effect sets state
   * synchronously inside it, which this repo lints as a cascading-render hazard (see the
   * `react-hooks/set-state-in-effect` entries in `docs/development-workflow.md`). Loading from the
   * event that asked for it needs no effect at all, and the payload is cached for the session, so
   * re-opening does not re-fetch.
   */
  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && payload === null && !loading) void load()
  }

  const save = async () => {
    if (!draft) return
    const cat = Number(draft.catWeight)
    const fat = Number(draft.fatWeight)

    // The contract enforces this too; checking here turns a round trip into an inline message.
    if (!Number.isFinite(cat) || !Number.isFinite(fat) || Math.abs(cat + fat - 100) > 0.001) {
      setError("CAT and FAT weights must sum to 100.")
      return
    }

    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const response = await fetch(`/api/teacher/offerings/${offeringId}/grading`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          catWeight: cat,
          fatWeight: fat,
          finalAssessmentId: draft.finalAssessmentId === "" ? null : draft.finalAssessmentId,
          minimumCatPercent: draft.gateDisabled ? null : Number(draft.minimumCatPercent),
        }),
      })
      const data = (await response.json()) as OfferingGradingResponse | { message?: string }
      if (!response.ok) {
        setError(("message" in data && data.message) || "Unable to save the grading policy.")
        return
      }
      const saved = data as OfferingGradingResponse
      setPayload(saved)
      setDraft(toDraft(saved))
      setMessage("Grading policy saved.")
    } finally {
      setSaving(false)
    }
  }

  const sum = draft ? Number(draft.catWeight) + Number(draft.fatWeight) : 0
  const sumOk = draft !== null && Math.abs(sum - 100) < 0.001

  return (
    <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Grading policy</p>
          <p className="text-xs text-muted-foreground">
            {payload === null
              ? "CAT / FAT weights and the FAT gate."
              : payload.usingDefaults
                ? "Not set — the export weights every assessment equally."
                : `CAT ${payload.config.catWeight}% / FAT ${payload.config.fatWeight}%`}
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={toggle} aria-expanded={open}>
          {open ? "Hide" : "Edit policy"}
        </Button>
      </div>

      {open && (
        <div className="mt-3 space-y-3">
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

          {error && (
            <Callout tone="warning" title="Could not save">
              {error}
            </Callout>
          )}

          {message && !error && (
            <p className="text-sm text-muted-foreground" role="status">
              {message}
            </p>
          )}

          {payload && draft && !loading && (
            <>
              {payload.usingDefaults && (
                <Callout tone="info" title="No policy stored yet">
                  The CAT 40 / FAT 60 split below is the institutional default, offered as a
                  starting point. <strong>Nothing is in force until you save it</strong> — the
                  export currently weights every assessment equally, so no course weight is guessed
                  from your due dates.
                </Callout>
              )}

              {payload.derived === null && (
                <Callout tone="info" title="Not enough assessments">
                  A CAT/FAT split needs at least two assessments. Until then the export weights them
                  equally.
                </Callout>
              )}

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-sm">
                  <span className="mb-1 block text-xs text-muted-foreground">CAT weight (%)</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={draft.catWeight}
                    onChange={(event) =>
                      setDraft((previous) =>
                        previous ? { ...previous, catWeight: event.target.value } : previous,
                      )
                    }
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5"
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-xs text-muted-foreground">FAT weight (%)</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={draft.fatWeight}
                    onChange={(event) =>
                      setDraft((previous) =>
                        previous ? { ...previous, fatWeight: event.target.value } : previous,
                      )
                    }
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5"
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-xs text-muted-foreground">
                    Minimum CAT to sit the FAT
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    disabled={draft.gateDisabled}
                    value={draft.minimumCatPercent}
                    onChange={(event) =>
                      setDraft((previous) =>
                        previous
                          ? { ...previous, minimumCatPercent: event.target.value }
                          : previous,
                      )
                    }
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 disabled:opacity-50"
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-xs text-muted-foreground">Final assessment</span>
                  <select
                    value={draft.finalAssessmentId}
                    onChange={(event) =>
                      setDraft((previous) =>
                        previous
                          ? { ...previous, finalAssessmentId: event.target.value }
                          : previous,
                      )
                    }
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5"
                  >
                    <option value="">Derive it (last to fall due)</option>
                    {payload.assessments.map((assessment) => (
                      <option key={assessment.id} value={assessment.id}>
                        {assessment.title}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={draft.gateDisabled}
                    onChange={(event) =>
                      setDraft((previous) =>
                        previous ? { ...previous, gateDisabled: event.target.checked } : previous,
                      )
                    }
                  />
                  This course has no CAT gate
                </label>
                <span
                  className={sumOk ? "text-xs text-muted-foreground" : "text-xs text-destructive"}
                >
                  Weights sum to {Number.isFinite(sum) ? sum : 0}%{sumOk ? "" : " — must be 100%"}
                </span>
              </div>

              {payload.derived && (
                <p className="text-xs text-muted-foreground">
                  Continuous assessment:{" "}
                  {payload.derived.catAssessmentIds.length === 0
                    ? "none"
                    : `${payload.derived.catAssessmentIds.length} assessment(s)`}
                  {" · "}
                  Final:{" "}
                  {payload.assessments.find(
                    (assessment) => assessment.id === payload.derived?.fatAssessmentId,
                  )?.title ?? "none"}
                  {payload.derived.fatDerived && " (derived from due dates)"}
                </p>
              )}

              <div className="flex items-center gap-2">
                <Button type="button" size="sm" onClick={save} disabled={saving || !sumOk}>
                  {saving ? "Saving…" : "Save policy"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setDraft(toDraft(payload))}
                  disabled={saving}
                >
                  Reset
                </Button>
              </div>

              {payload.roster.length > 0 && (
                <Card className="border-border/60 shadow-none">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm tracking-tight">
                      FAT eligibility from CAT
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Reported, not enforced — no attempt is refused on this basis yet.
                    </p>
                    <ul className="divide-y divide-border/60 text-sm">
                      {payload.roster.map((row) => (
                        <li
                          key={row.studentId}
                          className="flex flex-wrap items-center justify-between gap-2 py-1.5"
                        >
                          <span>
                            {row.name}{" "}
                            <span className="font-mono text-xs text-muted-foreground">
                              {row.registerNumber}
                            </span>
                          </span>
                          <span className="flex items-center gap-2">
                            <span className="font-mono text-xs tabular-nums">
                              {row.catPercent === null ? "—" : `${row.catPercent}%`}
                            </span>
                            <Badge variant="outline">
                              {row.markedCount}/{row.totalCount} marked
                            </Badge>
                            <StatusPill
                              status={STATUS_PILL[row.status] ?? "pending"}
                              label={STATUS_LABEL[row.status] ?? row.status}
                            />
                          </span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

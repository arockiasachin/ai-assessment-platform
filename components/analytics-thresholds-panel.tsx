"use client"

import { useCallback, useEffect, useState } from "react"
import { SlidersHorizontal } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Callout } from "@/components/ui/callout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  effectivePlaceholder,
  INTERVENTION_FIELDS,
  ITEM_ANALYSIS_FIELDS,
  settingsSummary,
  thresholdDraftToSettings,
  toThresholdDraft,
  type ThresholdDraft,
  type ThresholdField,
} from "@/lib/analytics/settings-view"
import type { AnalyticsSettingsResponse } from "@/lib/contracts/analytics"

/**
 * The analytics thresholds for one offering.
 *
 * ## Why this exists
 *
 * `GET`/`PUT /api/teacher/analytics/settings` shipped in Wave 2 and **had no caller** — the one route
 * in the analytics pod with no UI. It was dropped from the Wave 3 port on purpose: the mockup's
 * "Analytics settings" control was inert, and porting it inert would have violated the rule against
 * shipping a control that does nothing. Wiring it is a form, not a port, so it needed its own slice.
 *
 * ## The field rule, which is the whole design
 *
 * Every threshold is **optional**: an omitted key keeps the code default. So a blank input means "use
 * the default" and is **omitted from the payload** rather than sent as `0` — for a field whose valid
 * range includes zero, sending 0 would be a real and wrong override. The effective value is shown as
 * the input's **placeholder**, so a teacher can see what applies without turning it into an override.
 *
 * ## Loads on expand, and follows the offering selector
 *
 * Fetching on mount would repeat the P2 finding this project just spent a slice removing. The panel
 * instead fetches when it is opened, and re-fetches when the offering changes — comparing
 * `payload.offeringId` rather than tracking the id in a second piece of state, which is the same
 * idiom `TeacherAnalyticsDashboard` already uses for its overview.
 */
export function AnalyticsThresholdsPanel({
  offeringId,
  initialPayload = null,
  onSaved,
}: {
  offeringId: string
  initialPayload?: AnalyticsSettingsResponse | null
  /**
   * Called after a successful save. The thresholds govern the alerts and item-analysis withholds
   * rendered elsewhere on the page, so the caller refetches its overview instead of leaving the
   * header sentence and the alert card describing the old numbers until the offering changes
   * (TN-8).
   */
  onSaved?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [payload, setPayload] = useState<AnalyticsSettingsResponse | null>(initialPayload)
  const [draft, setDraft] = useState<ThresholdDraft>(() =>
    initialPayload ? toThresholdDraft(initialPayload.settings) : {},
  )
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async (id: string) => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/teacher/analytics/settings?offeringId=${encodeURIComponent(id)}`,
        { cache: "no-store" },
      )
      const data = (await response.json()) as AnalyticsSettingsResponse & { message?: string }
      if (!response.ok) {
        setError(data.message ?? "Unable to load the analytics thresholds.")
        return
      }
      setPayload(data)
      setDraft(toThresholdDraft(data.settings))
    } catch {
      setError("Unable to load the analytics thresholds.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open || !offeringId) return
    if (payload?.offeringId === offeringId) return
    // Deferred to a task so the effect body does not call setState synchronously
    // (`react-hooks/set-state-in-effect`); the fetch still starts immediately.
    const handle = setTimeout(() => void load(offeringId), 0)
    return () => clearTimeout(handle)
  }, [open, offeringId, payload?.offeringId, load])

  const save = async () => {
    const result = thresholdDraftToSettings(draft, payload?.settings)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const response = await fetch("/api/teacher/analytics/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offeringId, settings: result.settings }),
      })
      const data = (await response.json()) as AnalyticsSettingsResponse & { message?: string }
      if (!response.ok) {
        setError(data.message ?? "Unable to save the analytics thresholds.")
        return
      }
      setPayload(data)
      setDraft(toThresholdDraft(data.settings))
      setMessage("Thresholds saved.")
      onSaved?.()
    } catch {
      setError("Unable to save the analytics thresholds.")
    } finally {
      setSaving(false)
    }
  }

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && offeringId && payload?.offeringId !== offeringId && !loading) void load(offeringId)
  }

  const renderField = (field: ThresholdField) => (
    <label className="text-sm" key={field.key}>
      <span className="mb-1 block text-xs text-muted-foreground">{field.label}</span>
      <Input
        type="number"
        inputMode="decimal"
        value={draft[field.key] ?? ""}
        placeholder={effectivePlaceholder(payload, field)}
        onChange={(event) =>
          setDraft((previous) => ({ ...previous, [field.key]: event.target.value }))
        }
        aria-label={field.label}
      />
      <span className="mt-1 block text-xs text-muted-foreground">{field.hint}</span>
    </label>
  )

  return (
    <Card className="border-border/70 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base tracking-tight">
          <span className="flex items-center gap-2">
            <SlidersHorizontal className="size-4" aria-hidden="true" />
            Analytics thresholds
          </span>
          <Button type="button" size="sm" variant="outline" onClick={toggle} aria-expanded={open}>
            {open ? "Hide" : "Configure"}
          </Button>
        </CardTitle>
        <p className="text-xs text-muted-foreground">{settingsSummary(payload)}</p>
      </CardHeader>

      {open && (
        <CardContent className="space-y-4">
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

          {!loading && (
            <>
              <Callout tone="info" title="Blank means the code default">
                An empty field keeps the built-in default — shown greyed in the box. Only what you
                type is stored as an override for this offering.
              </Callout>

              <div>
                <h3 className="mb-2 text-sm font-medium">Intervention alerts</h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {INTERVENTION_FIELDS.map(renderField)}
                </div>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-medium">Item analysis</h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {ITEM_ANALYSIS_FIELDS.map(renderField)}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button type="button" size="sm" onClick={save} disabled={saving || loading}>
                  {saving ? "Saving…" : "Save thresholds"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => payload && setDraft(toThresholdDraft(payload.settings))}
                  disabled={saving || !payload}
                >
                  Reset
                </Button>
              </div>
            </>
          )}
        </CardContent>
      )}
    </Card>
  )
}

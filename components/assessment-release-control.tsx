"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Send } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { StatusPill } from "@/components/ui/status-pill"
import { RELEASE_CONFIRMATION_BODY, assessmentReleaseView } from "@/lib/assessment-release-view"

/**
 * The release control (TN-1 / TN-31).
 *
 * This is the write path the audit found missing: the release API worked, but nothing in
 * the product called it, so no assessment could reach a student. The control replaces the
 * read-only *Not released* pill the teacher used to be stuck behind.
 *
 * Releasing is one-way at the API, so the confirmation names that rather than promising an
 * undo, and once released the component offers no action at all — see
 * `lib/assessment-release-view.ts`. On success it calls `router.refresh()` so the server
 * components that own the payload (the planner's deadline table, the dashboard's progress
 * table) re-read the assessment rather than trusting local state.
 */
export function AssessmentReleaseControl({
  assessmentId,
  assessmentTitle,
  released,
  releasedAt,
}: {
  assessmentId: string
  assessmentTitle: string
  released: boolean
  releasedAt: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const view = assessmentReleaseView({ released, releasedAt })

  const release = async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/teacher/assessments/${assessmentId}/release`, {
        method: "POST",
        cache: "no-store",
      })
      const payload = (await response.json().catch(() => null)) as { message?: string } | null
      if (!response.ok) {
        throw new Error(payload?.message ?? "Unable to release this assessment.")
      }
      setOpen(false)
      router.refresh()
    } catch (releaseError) {
      setError(
        releaseError instanceof Error ? releaseError.message : "Unable to release this assessment.",
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-1">
      <StatusPill status={view.status} label={view.label} dot />
      <p className="text-xs text-muted-foreground">{view.detail}</p>
      {view.canRelease && (
        <>
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
            <Send />
            Release
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{`Release "${assessmentTitle}"?`}</DialogTitle>
                <DialogDescription>{RELEASE_CONFIRMATION_BODY}</DialogDescription>
              </DialogHeader>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="button" disabled={busy} onClick={() => void release()}>
                  {busy ? <Loader2 className="animate-spin" /> : <Send />}
                  Release to students
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  )
}

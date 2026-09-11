"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type ActionState = {
  loading: boolean
  message: string | null
  error: string | null
}

function useActionState(): [ActionState, (next: Partial<ActionState>) => void] {
  const [state, setState] = useState<ActionState>({ loading: false, message: null, error: null })
  return [state, (next) => setState((prev) => ({ ...prev, ...next }))]
}

export function AdminToolsPanel() {
  const [seedState, setSeedState] = useActionState()
  const [rebalanceState, setRebalanceState] = useActionState()

  async function runSeed() {
    setSeedState({ loading: true, message: null, error: null })
    try {
      const response = await fetch("/api/auth/seed", { method: "POST" })
      const data = (await response.json()) as { success?: boolean; message?: string }
      if (!response.ok || !data.success) {
        setSeedState({ loading: false, error: data.message ?? "Seed failed." })
        return
      }
      setSeedState({ loading: false, message: data.message ?? "Seed completed." })
    } catch {
      setSeedState({ loading: false, error: "Seed failed." })
    }
  }

  async function runRebalance() {
    setRebalanceState({ loading: true, message: null, error: null })
    try {
      const response = await fetch("/api/admin/dev/rebalance-offerings", { method: "POST" })
      const data = (await response.json()) as {
        success?: boolean
        message?: string
        summary?: { updated: number; unchanged: number; skipped: number }
      }

      if (!response.ok || !data.success || !data.summary) {
        setRebalanceState({ loading: false, error: data.message ?? "Rebalance failed." })
        return
      }

      setRebalanceState({
        loading: false,
        message: `Updated ${data.summary.updated}, unchanged ${data.summary.unchanged}, skipped ${data.summary.skipped}.`,
      })
    } catch {
      setRebalanceState({ loading: false, error: "Rebalance failed." })
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Seed development dataset</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Recreate and normalize the development identities, classes, assessments, and support records.
          </p>
          <Button onClick={runSeed} disabled={seedState.loading}>
            {seedState.loading ? "Seeding..." : "Run seed"}
          </Button>
          {seedState.message && <p className="text-sm text-emerald-700">{seedState.message}</p>}
          {seedState.error && <p className="text-sm text-destructive">{seedState.error}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rebalance offering ownership</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Reassign dev offerings to the intended teachers if ownership drifted during tests.
          </p>
          <Button variant="outline" onClick={runRebalance} disabled={rebalanceState.loading}>
            {rebalanceState.loading ? "Rebalancing..." : "Run rebalance"}
          </Button>
          {rebalanceState.message && <p className="text-sm text-emerald-700">{rebalanceState.message}</p>}
          {rebalanceState.error && <p className="text-sm text-destructive">{rebalanceState.error}</p>}
        </CardContent>
      </Card>
    </div>
  )
}

"use client"

import { useEffect } from "react"
import { DashboardHeader } from "@/components/dashboard-header"
import { RoleRoutesMenu } from "@/components/role-routes-menu"
import { useGradebook } from "@/components/gradebook-provider"

type RolePageShellProps = {
  role: "teacher" | "student"
  title?: string
  description?: string
  children: React.ReactNode
}

export function RolePageShell({ role, title, description, children }: RolePageShellProps) {
  const { setRole } = useGradebook()

  useEffect(() => {
    setRole(role)
  }, [role, setRole])

  return (
    <div className="min-h-screen bg-background text-foreground" suppressHydrationWarning>
      <DashboardHeader />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8" suppressHydrationWarning>
        <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
          <section className="order-2 lg:order-1 lg:col-span-9">
            {title && (
              <div className="mb-5 rounded-xl border border-border/70 bg-card px-4 py-4">
                <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
                {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
              </div>
            )}
            {children}
          </section>

          <aside className="order-1 lg:order-2 lg:col-span-3">
            <div className="lg:sticky lg:top-24">
              <RoleRoutesMenu role={role} />
            </div>
          </aside>
        </div>
      </main>
    </div>
  )
}

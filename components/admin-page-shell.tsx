import { LogoutButton } from "@/components/logout-button"
import { AdminRoutesMenu } from "@/components/admin-routes-menu"

type AdminPageShellProps = {
  title: string
  description: string
  children: React.ReactNode
}

export function AdminPageShell({ title, description, children }: AdminPageShellProps) {
  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6 sm:py-8">
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-12 lg:items-start">
        <section className="order-2 lg:order-1 lg:col-span-9">
          <div className="mb-5 rounded-xl border border-border bg-card px-4 py-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                  Admin workspace
                </p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
                <p className="mt-1 text-sm text-muted-foreground">{description}</p>
              </div>
              <LogoutButton />
            </div>
          </div>
          {children}
        </section>

        <aside className="order-1 lg:order-2 lg:col-span-3">
          <div className="lg:sticky lg:top-8">
            <AdminRoutesMenu />
          </div>
        </aside>
      </div>
    </main>
  )
}

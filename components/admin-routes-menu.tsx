"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Database, LayoutDashboard, Settings2, Users, Layers } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

type RouteItem = {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

const items: RouteItem[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/offerings", label: "Offerings", icon: Layers },
  { href: "/admin/data", label: "Data Explorer", icon: Database },
  { href: "/admin/tools", label: "Tools", icon: Settings2 },
]

export function AdminRoutesMenu() {
  const pathname = usePathname()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Admin routes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((item) => {
          const Icon = item.icon
          const active = pathname === item.href

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                active
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-background hover:bg-muted",
              )}
            >
              <Icon className="size-4" />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </CardContent>
    </Card>
  )
}

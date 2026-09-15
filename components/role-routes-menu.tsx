"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  FilePlus2,
  Home,
  Layers,
  ListChecks,
  RefreshCw,
  Route,
  Share2,
  Settings2,
  Sparkles,
  Terminal,
  Users,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type Role = "student" | "teacher"

type RouteItem = {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
}

const studentRoutes: RouteItem[] = [
  { label: "Dashboard", href: "/student", icon: Home },
  { label: "Assessments", href: "/student/assessments", icon: ClipboardList },
  { label: "Quizzes", href: "/student/quizzes", icon: ClipboardCheck },
  { label: "Courses", href: "/student/courses", icon: BookOpen },
  { label: "Events", href: "/student/events", icon: CalendarDays },
  { label: "Peer eval", href: "/student/peer-evaluation", icon: Users },
  { label: "Code", href: "/student/code-submissions", icon: Terminal },
  { label: "Retake", href: "/student/retake", icon: RefreshCw },
  { label: "Resources", href: "/student/resources", icon: Sparkles },
]

const teacherRoutes: RouteItem[] = [
  { label: "Dashboard", href: "/teacher", icon: Home },
  { label: "Assignments", href: "/teacher/assignments", icon: FilePlus2 },
  { label: "Quiz AI", href: "/teacher/quiz-generation", icon: Sparkles },
  { label: "Rubrics", href: "/teacher/rubrics", icon: ListChecks },
  { label: "Reviews", href: "/teacher/reviews", icon: ClipboardCheck },
  { label: "Code tasks", href: "/teacher/code-tasks", icon: Terminal },
  { label: "Groups", href: "/teacher/groups", icon: Users },
  { label: "Analytics", href: "/teacher/analytics", icon: BarChart3 },
  { label: "Activity log", href: "/teacher/observability", icon: ClipboardList },
  { label: "Export", href: "/teacher/export", icon: Share2 },
  { label: "Classes", href: "/teacher/classes", icon: Layers },
  { label: "Offerings", href: "/teacher/offerings", icon: Settings2 },
  { label: "Planner", href: "/teacher/planner", icon: CalendarDays },
  { label: "Reports", href: "/teacher/reports", icon: ClipboardList },
]

export function RoleRoutesMenu({ role }: { role: Role }) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  const items = useMemo(() => (role === "teacher" ? teacherRoutes : studentRoutes), [role])

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          {!collapsed && (
            <div>
              <CardTitle className="text-sm">Quick routes</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                {role === "teacher" ? "Teaching workspace" : "Student workspace"}
              </p>
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? "Expand menu" : "Collapse menu"}
          >
            {collapsed ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        <nav className="space-y-2" aria-label="Role routes">
          {items.map((item) => {
            const isActive = pathname === item.href
            const Icon = item.icon

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-label={item.label}
                aria-current={isActive ? "page" : undefined}
                className={[
                  "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border bg-background hover:bg-muted",
                  collapsed ? "justify-center px-2" : "justify-start",
                ].join(" ")}
                title={item.label}
              >
                <Icon className="size-4" />
                {!collapsed && <span>{item.label}</span>}
              </Link>
            )
          })}
          {!collapsed && (
            <div className="mt-3 rounded-lg border border-dashed border-border/80 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <div className="inline-flex items-center gap-1.5 font-medium text-foreground">
                <Route className="size-3.5" />
                Extendable menu
              </div>
              <p className="mt-1">Add new pages any time and wire them here.</p>
            </div>
          )}
        </nav>
      </CardContent>
    </Card>
  )
}

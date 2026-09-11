"use client"

import { useEffect } from "react"
import { DashboardHeader } from "@/components/dashboard-header"
import { StudentView } from "@/components/student-view"
import { TeacherView } from "@/components/teacher-view"
import { useGradebook } from "@/components/gradebook-provider"

export function Dashboard({ initialRole }: { initialRole?: "teacher" | "student" }) {
  const { role, setRole } = useGradebook()

  useEffect(() => {
    if (initialRole) {
      setRole(initialRole)
    }
  }, [initialRole, setRole])

  return (
    <div className="min-h-screen bg-background text-foreground" suppressHydrationWarning>
      <DashboardHeader />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8" suppressHydrationWarning>
        {role === "teacher" ? <TeacherView /> : <StudentView />}
      </main>
    </div>
  )
}

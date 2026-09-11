import { redirect } from "next/navigation"

import { getSessionUser } from "@/lib/auth"

type RoleGuardProps = {
  role: "student" | "teacher" | "admin"
  children: React.ReactNode
}

export async function RoleGuard({ role, children }: RoleGuardProps) {
  const user = await getSessionUser()

  if (!user || user.role !== role) {
    redirect("/login")
  }

  return <>{children}</>
}

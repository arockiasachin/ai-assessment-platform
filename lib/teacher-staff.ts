import "server-only"

import { prisma } from "@/lib/prisma"

/**
 * The acting teacher's `StaffProfile.id`, or `null` when they have no profile.
 *
 * `lib/teacher-submissions.ts` and `lib/teacher-roster.ts` share this one rather
 * than each carrying a copy. (Seven other modules still have their own, taking an
 * `AuthUser`; consolidating those is a separate change — this module exists so
 * the count at least stops growing.)
 */
export async function resolveTeacherStaffId(userId: string): Promise<string | null> {
  const staff = await prisma.staffProfile.findUnique({
    where: { userId },
    select: { id: true },
  })
  return staff?.id ?? null
}

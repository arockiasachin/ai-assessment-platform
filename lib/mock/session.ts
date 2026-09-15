import type { MockNotification, MockUser } from "./types"

/**
 * The identities the shell pretends to be signed in as, one per mockup role.
 * `roleTone` feeds `StatusPill` in the account menu.
 */
export const MOCK_CURRENT_USER: Record<MockUser["role"], MockUser> = {
  teacher: {
    id: "usr_teacher_01",
    name: "Dr. Meera Raman",
    email: "meera.raman@vit.ac.in",
    role: "teacher",
    roleLabel: "Teacher",
    roleTone: "active",
    initials: "MR",
    detail: "Algebra Foundations · Section A",
  },
  student: {
    id: "usr_student_01",
    name: "Aarav Mehta",
    email: "aarav.mehta@vitstudent.ac.in",
    role: "student",
    roleLabel: "Student",
    roleTone: "completed",
    initials: "AM",
    detail: "B.Sc. Data Science · Year 2",
  },
  admin: {
    id: "usr_admin_01",
    name: "Ada Okonkwo",
    email: "ada.okonkwo@vit.ac.in",
    role: "admin",
    roleLabel: "Admin",
    roleTone: "pending",
    initials: "AO",
    detail: "Institution administrator",
  },
}

/**
 * Notification feed for the top bar. `read: false` drives the unread count.
 * Two are unread so the badge has something to show.
 */
export const MOCK_NOTIFICATIONS: MockNotification[] = [
  {
    id: "ntf_01",
    title: "6 AI suggestions need review",
    description: "Descriptive — Modelling with Functions · 2 flagged low confidence.",
    createdAt: "2026-09-15T11:05:00.000Z",
    read: false,
    tone: "needs-review",
    href: "/mockup/teacher/reviews",
  },
  {
    id: "ntf_02",
    title: "Similarity check flagged a pair",
    description: "Code Task — Sorting & Big-O: 0.91 similarity between two submissions.",
    createdAt: "2026-09-15T08:40:00.000Z",
    read: false,
    tone: "flagged",
    href: "/mockup/teacher/code-tasks",
  },
  {
    id: "ntf_03",
    title: "Quiz 1 grades published",
    description: "12 students notified. Cohort mean 79%.",
    createdAt: "2026-09-12T16:20:00.000Z",
    read: true,
    tone: "published",
    href: "/mockup/teacher/analytics",
  },
  {
    id: "ntf_04",
    title: "LTI passback needs mappings",
    description: "3 students have no LMS user id, so their grades will not sync.",
    createdAt: "2026-09-11T09:15:00.000Z",
    read: true,
    tone: "pending",
    href: "/mockup/teacher/export",
  },
]

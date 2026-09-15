import type { Metadata } from "next"

import { StubPage } from "../../_components/stub-page"

export const metadata: Metadata = {
  title: "Assignments",
}

export default function TeacherAssignmentsPage() {
  return <StubPage href="/mockup/teacher/assignments" />
}

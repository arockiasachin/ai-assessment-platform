import type { Metadata } from "next"

import { StubPage } from "../../_components/stub-page"

export const metadata: Metadata = {
  title: "Code tasks",
}

export default function TeacherCodeTasksPage() {
  return <StubPage href="/mockup/teacher/code-tasks" />
}

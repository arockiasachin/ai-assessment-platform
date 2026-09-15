import type { Metadata } from "next"

import { StubPage } from "../../_components/stub-page"

export const metadata: Metadata = {
  title: "Submissions",
}

export default function TeacherSubmissionsPage() {
  return <StubPage href="/mockup/teacher/submissions" />
}

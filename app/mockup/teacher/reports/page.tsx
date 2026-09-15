import type { Metadata } from "next"

import { StubPage } from "../../_components/stub-page"

export const metadata: Metadata = {
  title: "Reports",
}

export default function TeacherReportsPage() {
  return <StubPage href="/mockup/teacher/reports" />
}

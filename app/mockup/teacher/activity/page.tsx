import type { Metadata } from "next"

import { StubPage } from "../../_components/stub-page"

export const metadata: Metadata = {
  title: "Activity log",
}

export default function TeacherActivityPage() {
  return <StubPage href="/mockup/teacher/activity" />
}

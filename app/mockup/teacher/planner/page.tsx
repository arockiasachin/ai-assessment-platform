import type { Metadata } from "next"

import { StubPage } from "../../_components/stub-page"

export const metadata: Metadata = {
  title: "Planner",
}

export default function TeacherPlannerPage() {
  return <StubPage href="/mockup/teacher/planner" />
}

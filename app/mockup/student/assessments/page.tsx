import type { Metadata } from "next"

import { StubPage } from "../../_components/stub-page"

export const metadata: Metadata = {
  title: "Assessments",
}

export default function StudentAssessmentsPage() {
  return <StubPage href="/mockup/student/assessments" />
}

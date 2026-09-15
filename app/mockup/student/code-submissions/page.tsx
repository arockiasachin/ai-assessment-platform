import type { Metadata } from "next"

import { StubPage } from "../../_components/stub-page"

export const metadata: Metadata = {
  title: "Code submissions",
}

export default function StudentCodeSubmissionsPage() {
  return <StubPage href="/mockup/student/code-submissions" />
}

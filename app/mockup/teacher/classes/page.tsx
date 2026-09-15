import type { Metadata } from "next"

import { StubPage } from "../../_components/stub-page"

export const metadata: Metadata = {
  title: "Classes",
}

export default function TeacherClassesPage() {
  return <StubPage href="/mockup/teacher/classes" />
}

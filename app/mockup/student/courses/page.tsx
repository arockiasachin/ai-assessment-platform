import type { Metadata } from "next"

import { StubPage } from "../../_components/stub-page"

export const metadata: Metadata = {
  title: "Courses",
}

export default function StudentCoursesPage() {
  return <StubPage href="/mockup/student/courses" />
}

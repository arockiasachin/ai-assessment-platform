import type { Metadata } from "next"

import { StubPage } from "../../_components/stub-page"

export const metadata: Metadata = {
  title: "Groups",
}

export default function TeacherGroupsPage() {
  return <StubPage href="/mockup/teacher/groups" />
}

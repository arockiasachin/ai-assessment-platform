import type { Metadata } from "next"

import { StubPage } from "../../_components/stub-page"

export const metadata: Metadata = {
  title: "Profile",
}

export default function TeacherProfilePage() {
  return <StubPage href="/mockup/teacher/profile" />
}

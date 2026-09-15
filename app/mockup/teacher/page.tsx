import type { Metadata } from "next"

import { StubPage } from "../_components/stub-page"

export const metadata: Metadata = {
  title: "Dashboard",
}

export default function TeacherHomePage() {
  return <StubPage href="/mockup/teacher" />
}

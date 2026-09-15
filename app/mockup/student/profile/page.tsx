import type { Metadata } from "next"

import { StubPage } from "../../_components/stub-page"

export const metadata: Metadata = {
  title: "Profile",
}

export default function StudentProfilePage() {
  return <StubPage href="/mockup/student/profile" />
}

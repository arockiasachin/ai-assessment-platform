import type { Metadata } from "next"

import { StubPage } from "../../_components/stub-page"

export const metadata: Metadata = {
  title: "Resources",
}

export default function StudentResourcesPage() {
  return <StubPage href="/mockup/student/resources" />
}

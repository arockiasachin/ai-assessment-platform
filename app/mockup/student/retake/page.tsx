import type { Metadata } from "next"

import { StubPage } from "../../_components/stub-page"

export const metadata: Metadata = {
  title: "Retake",
}

export default function StudentRetakePage() {
  return <StubPage href="/mockup/student/retake" />
}

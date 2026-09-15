import type { Metadata } from "next"

import { StubPage } from "../../_components/stub-page"

export const metadata: Metadata = {
  title: "Events",
}

export default function StudentEventsPage() {
  return <StubPage href="/mockup/student/events" />
}

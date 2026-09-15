import type { Metadata } from "next"

import { StubPage } from "../_components/stub-page"

export const metadata: Metadata = {
  title: "Dashboard",
}

export default function StudentHomePage() {
  return <StubPage href="/mockup/student" />
}

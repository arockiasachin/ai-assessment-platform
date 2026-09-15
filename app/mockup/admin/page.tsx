import type { Metadata } from "next"

import { StubPage } from "../_components/stub-page"

export const metadata: Metadata = {
  title: "Overview",
}

export default function AdminHomePage() {
  return <StubPage href="/mockup/admin" />
}

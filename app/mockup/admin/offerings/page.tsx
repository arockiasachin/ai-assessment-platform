import type { Metadata } from "next"

import { StubPage } from "../../_components/stub-page"

export const metadata: Metadata = {
  title: "Course offerings",
}

export default function AdminOfferingsPage() {
  return <StubPage href="/mockup/admin/offerings" />
}

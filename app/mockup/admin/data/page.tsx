import type { Metadata } from "next"

import { StubPage } from "../../_components/stub-page"

export const metadata: Metadata = {
  title: "Data",
}

export default function AdminDataPage() {
  return <StubPage href="/mockup/admin/data" />
}

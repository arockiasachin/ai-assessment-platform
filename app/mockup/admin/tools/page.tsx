import type { Metadata } from "next"

import { StubPage } from "../../_components/stub-page"

export const metadata: Metadata = {
  title: "Tools",
}

export default function AdminToolsPage() {
  return <StubPage href="/mockup/admin/tools" />
}

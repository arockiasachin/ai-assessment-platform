import type { Metadata } from "next"

import { StubPage } from "../../_components/stub-page"

export const metadata: Metadata = {
  title: "Settings",
}

export default function AdminSettingsPage() {
  return <StubPage href="/mockup/admin/settings" />
}

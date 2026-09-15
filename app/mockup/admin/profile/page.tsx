import type { Metadata } from "next"

import { StubPage } from "../../_components/stub-page"

export const metadata: Metadata = {
  title: "Profile",
}

export default function AdminProfilePage() {
  return <StubPage href="/mockup/admin/profile" />
}

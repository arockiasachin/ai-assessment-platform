import type { Metadata } from "next"

import { StubPage } from "../../_components/stub-page"

export const metadata: Metadata = {
  title: "Users",
}

export default function AdminUsersPage() {
  return <StubPage href="/mockup/admin/users" />
}

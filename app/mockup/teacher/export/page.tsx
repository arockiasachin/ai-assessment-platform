import type { Metadata } from "next"

import { StubPage } from "../../_components/stub-page"

export const metadata: Metadata = {
  title: "Export",
}

export default function TeacherExportPage() {
  return <StubPage href="/mockup/teacher/export" />
}

import type { Metadata } from "next"

import { StubPage } from "../../_components/stub-page"

export const metadata: Metadata = {
  title: "Reviews",
}

export default function TeacherReviewsPage() {
  return <StubPage href="/mockup/teacher/reviews" />
}

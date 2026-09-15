import type { Metadata } from "next"

import { StubPage } from "../../_components/stub-page"

export const metadata: Metadata = {
  title: "Quizzes",
}

export default function StudentQuizzesPage() {
  return <StubPage href="/mockup/student/quizzes" />
}

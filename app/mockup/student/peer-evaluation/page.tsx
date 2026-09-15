import type { Metadata } from "next"

import { StubPage } from "../../_components/stub-page"

export const metadata: Metadata = {
  title: "Peer evaluation",
}

export default function StudentPeerEvaluationPage() {
  return <StubPage href="/mockup/student/peer-evaluation" />
}

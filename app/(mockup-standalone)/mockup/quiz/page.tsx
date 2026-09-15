import type { Metadata } from "next"

import { MockQuizRunner } from "./mock-quiz-runner"

export const metadata: Metadata = {
  title: "Quiz",
}

export default function MockupQuizPage() {
  return <MockQuizRunner />
}

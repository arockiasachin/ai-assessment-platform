import { redirect } from "next/navigation"

/**
 * The legacy quiz centre is retired.
 *
 * `/quiz` was a second, unrecorded grader: it graded against the modern question store but
 * persisted no `QuizAttempt` and no `Grade`, and its results screen disclosed the full answer
 * key and explanation. A student could therefore preview the key an unlimited number of times
 * before sitting the graded attempt (`SN-12`, a `confidentiality-leak`). The recorded pipeline
 * at `/student/quizzes` already does everything this page claimed to do — it starts a sitting,
 * autosaves answers, submits, and only reveals the key after a scored attempt — so the honest
 * fix is that this route should not exist as a destination.
 *
 * The redirect (rather than a delete) keeps the old URL working for bookmarks and for the
 * `proxy.ts` rule that treats `/quiz` as signed-in-only. The unrecorded grader it pointed at
 * (`POST /api/quiz/grade`) and its runner component were removed with this change.
 */
export default function QuizPage() {
  redirect("/student/quizzes")
}

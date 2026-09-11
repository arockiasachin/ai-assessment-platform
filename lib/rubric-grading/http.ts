import type { NextResponse } from "next/server"
import { ZodError } from "zod"

import { isDatabaseError, jsonError } from "@/lib/api"
import { GradePipelineError } from "@/lib/grading/errors"

import { RubricGradingError } from "./errors"

/**
 * Translate a thrown error into a JSON response. Known domain errors keep their
 * status and message; database errors and anything unexpected are logged and
 * reduced to a generic 500 so internal paths and query fragments never leak
 * (bug-fix run 1, BUG-4).
 */
export function rubricErrorResponse(error: unknown): NextResponse {
  if (error instanceof RubricGradingError) {
    return jsonError(error.message, error.status)
  }
  if (error instanceof GradePipelineError) {
    return jsonError(error.message, error.status)
  }
  if (error instanceof ZodError) {
    return jsonError(error.issues[0]?.message ?? "Invalid request.", 400)
  }
  if (error instanceof Error && error.message === "Forbidden") {
    return jsonError("Forbidden", 403)
  }
  if (isDatabaseError(error)) {
    console.error("Rubric grading database error:", error)
    return jsonError("Unable to complete the request.", 500)
  }
  console.error("Rubric grading error:", error)
  return jsonError("Unable to complete the request.", 500)
}

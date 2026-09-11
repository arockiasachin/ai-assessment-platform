import type { NextResponse } from "next/server"
import { ZodError } from "zod"

import { isDatabaseError, jsonError } from "@/lib/api"
import { firstIssueMessage } from "@/lib/contracts/common"

import { CodeEvalError } from "./errors"

/**
 * Translate a thrown error into a JSON response. Known domain errors keep their
 * status and message; database errors and anything unexpected are logged and
 * reduced to a generic 500 so internal paths and query fragments never leak
 * (bug-fix run 1, BUG-4).
 */
export function codeEvalErrorResponse(error: unknown): NextResponse {
  if (error instanceof CodeEvalError) {
    return jsonError(error.message, error.status)
  }
  if (error instanceof ZodError) {
    return jsonError(firstIssueMessage(error), 400)
  }
  if (isDatabaseError(error)) {
    console.error("Code evaluation database error:", error)
    return jsonError("Unable to complete the request.", 500)
  }
  console.error("Code evaluation error:", error)
  return jsonError("Unable to complete the request.", 500)
}

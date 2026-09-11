import { NextResponse } from "next/server"
import type { ZodType } from "zod"

import { firstIssueMessage } from "@/lib/contracts"

/** Small helpers shared by route handlers. */

export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ success: false, message }, { status })
}

export function jsonSuccess(body: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ success: true, ...body })
}

export type ParsedBody<T> = { ok: true; data: T } | { ok: false; response: NextResponse }

/**
 * Parse and validate a JSON request body against a zod contract. Returns a
 * ready-to-return 400 response instead of throwing, so route handlers stay flat.
 */
export async function parseJsonBody<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<ParsedBody<T>> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return { ok: false, response: jsonError("Invalid JSON body.", 400) }
  }

  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, response: jsonError(firstIssueMessage(parsed.error), 400) }
  }

  return { ok: true, data: parsed.data }
}

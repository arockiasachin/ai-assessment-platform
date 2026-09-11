import { LlmError } from "./errors"
import type { LlmProviderName } from "./types"

export type FetchLike = typeof fetch

export type JsonRequestOptions = {
  provider: LlmProviderName
  body: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
  timeoutMs?: number
  fetchImpl?: FetchLike
}

const MAX_ERROR_BODY = 2000

function truncate(value: string): string {
  return value.length > MAX_ERROR_BODY ? `${value.slice(0, MAX_ERROR_BODY)}…` : value
}

/** Combine caller cancellation with the internal timeout without AbortSignal.any. */
function combineSignals(a?: AbortSignal, b?: AbortSignal): AbortSignal | undefined {
  if (!a) return b
  if (!b) return a

  const controller = new AbortController()
  if (a.aborted || b.aborted) {
    controller.abort()
    return controller.signal
  }
  a.addEventListener("abort", () => controller.abort(), { once: true })
  b.addEventListener("abort", () => controller.abort(), { once: true })
  return controller.signal
}

/**
 * POST JSON with a timeout and uniform error handling. All providers go
 * through here so a single `LlmError` shape reaches callers regardless of
 * which vendor failed.
 */
export async function postJson<T>(url: string, options: JsonRequestOptions): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 60_000
  const timeoutController = new AbortController()
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs)
  const signal = combineSignals(options.signal, timeoutController.signal)

  let response: Response
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(options.headers ?? {}),
      },
      body: JSON.stringify(options.body),
      signal,
    })
  } catch (error) {
    clearTimeout(timer)
    if (timeoutController.signal.aborted) {
      throw new LlmError(`${options.provider} request timed out after ${timeoutMs}ms`, {
        provider: options.provider,
        cause: error,
      })
    }
    throw new LlmError(`${options.provider} request failed`, {
      provider: options.provider,
      cause: error,
    })
  }
  clearTimeout(timer)

  const text = await response.text()

  if (!response.ok) {
    throw new LlmError(`${options.provider} request failed with HTTP ${response.status}`, {
      provider: options.provider,
      status: response.status,
      responseBody: truncate(text),
    })
  }

  try {
    return JSON.parse(text) as T
  } catch {
    throw new LlmError(`${options.provider} returned a non-JSON response`, {
      provider: options.provider,
      status: response.status,
      responseBody: truncate(text),
    })
  }
}

/** Bounded, honest latency measurement for the explainability envelope. */
export function measureLatency(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt)
}

import type { AgsLineItemPayload, AgsScorePayload } from "@/lib/contracts/lms-export"

/**
 * The typed LTI 1.3 AGS client surface.
 *
 * The interface is the seam a real integration implements over `fetch` +
 * OAuth2 client-credentials (JWT signed with the registration's private key).
 * The only implementation shipped here is an in-memory dry run, so tests can
 * exercise the whole flow with **no network calls** — that property is
 * structural: this module imports no HTTP client and the dry-run client only
 * touches Maps and arrays. `AgsResultRecord` mirrors the read-only result
 * service so the interface is complete for a live implementation.
 */

export type AgsLineItemRecord = AgsLineItemPayload & {
  id: string
  lineItemUrl: string
}

export type AgsScoreReceipt = {
  lineItemId: string
  acceptedAt: string
  payload: AgsScorePayload
}

export type AgsResultRecord = {
  id: string
  lineItemId: string
  userId: string
  scoreGiven: number
  scoreMaximum: number
}

export type LtiAgsCallLogEntry = {
  service: "lineItems" | "scores" | "results"
  operation: string
  detail: unknown
}

export interface LtiAgsLineItemsService {
  createLineItem(payload: AgsLineItemPayload): Promise<AgsLineItemRecord>
  listLineItems(): Promise<AgsLineItemRecord[]>
  getLineItem(id: string): Promise<AgsLineItemRecord | null>
}

export interface LtiAgsScoresService {
  putScore(lineItemId: string, payload: AgsScorePayload): Promise<AgsScoreReceipt>
}

export interface LtiAgsResultsService {
  listResults(lineItemId: string): Promise<AgsResultRecord[]>
}

export interface LtiAgsClient {
  readonly mode: "dry-run" | "live"
  readonly lineItems: LtiAgsLineItemsService
  readonly scores: LtiAgsScoresService
  readonly results: LtiAgsResultsService
}

export type DryRunLtiAgsClient = LtiAgsClient & {
  readonly log: readonly LtiAgsCallLogEntry[]
}

export type DryRunLtiAgsClientOptions = {
  /**
   * Prefix for synthesized URLs. The default uses the reserved `.invalid` TLD
   * so a URL produced by the dry run can never resolve even if it leaks.
   */
  baseUrl?: string
  now?: () => Date
}

/** An in-memory, network-free AGS client used by tests and the dry-run route. */
export function createDryRunLtiAgsClient(
  options: DryRunLtiAgsClientOptions = {},
): DryRunLtiAgsClient {
  const baseUrl = options.baseUrl ?? "https://lms.invalid/ags"
  const now = options.now ?? (() => new Date())
  const log: LtiAgsCallLogEntry[] = []
  const lineItemStore = new Map<string, AgsLineItemRecord>()
  const scoreStore: AgsScoreReceipt[] = []
  let counter = 0

  const nextId = (prefix: string): string => {
    counter += 1
    return `${prefix}-${counter}`
  }

  const lineItems: LtiAgsLineItemsService = {
    async createLineItem(payload) {
      const id = nextId("lineitem")
      const record: AgsLineItemRecord = {
        ...payload,
        id,
        lineItemUrl: `${baseUrl}/lineitems/${id}`,
      }
      lineItemStore.set(id, record)
      log.push({ service: "lineItems", operation: "createLineItem", detail: { id, payload } })
      return record
    },
    async listLineItems() {
      return [...lineItemStore.values()]
    },
    async getLineItem(id) {
      return lineItemStore.get(id) ?? null
    },
  }

  const scores: LtiAgsScoresService = {
    async putScore(lineItemId, payload) {
      const receipt: AgsScoreReceipt = {
        lineItemId,
        acceptedAt: now().toISOString(),
        payload,
      }
      scoreStore.push(receipt)
      log.push({ service: "scores", operation: "putScore", detail: { lineItemId, payload } })
      return receipt
    },
  }

  const results: LtiAgsResultsService = {
    async listResults(lineItemId) {
      log.push({ service: "results", operation: "listResults", detail: { lineItemId } })
      return scoreStore
        .filter((receipt) => receipt.lineItemId === lineItemId)
        .map((receipt, index) => ({
          id: `${lineItemId}-result-${index + 1}`,
          lineItemId,
          userId: receipt.payload.userId,
          scoreGiven: receipt.payload.scoreGiven,
          scoreMaximum: receipt.payload.scoreMaximum,
        }))
    },
  }

  return { mode: "dry-run", lineItems, scores, results, log }
}

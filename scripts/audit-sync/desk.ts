import "dotenv/config"

import type { TicketRow } from "./status"

/**
 * A client for the support desk's member API.
 *
 * ## Credentials
 *
 * The sync acts as a support-desk **member**, so it signs in with an email and
 * password. That is the desk's only credential for its member API — the workspace
 * API keys are scoped to intake and cannot read the queue or change a ticket.
 *
 * A password in the environment is not ideal, and it is flagged as a limitation
 * rather than presented as a design: the better shape is a scoped service token
 * that can read tickets and set status but not administer the workspace. Until the
 * desk has one, a dedicated agent account with a long random password is the
 * least-privilege option available, and `AUDIT_SYNC_DESK_EMAIL` should point at
 * that account rather than at a person's.
 */

export type DeskConfig = {
  baseUrl: string
  email: string
  password: string
  workspace: string
}

export function deskConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DeskConfig {
  const baseUrl = (env.AUDIT_SYNC_DESK_URL ?? "").trim().replace(/\/+$/, "")
  const email = (env.AUDIT_SYNC_DESK_EMAIL ?? "").trim()
  const password = env.AUDIT_SYNC_DESK_PASSWORD ?? ""
  const workspace = (env.AUDIT_SYNC_WORKSPACE ?? "").trim()

  const missing = [
    ["AUDIT_SYNC_DESK_URL", baseUrl],
    ["AUDIT_SYNC_DESK_EMAIL", email],
    ["AUDIT_SYNC_DESK_PASSWORD", password],
    ["AUDIT_SYNC_WORKSPACE", workspace],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name)

  if (missing.length > 0) {
    throw new Error(
      `Support desk credentials are not configured. Missing: ${missing.join(", ")}.\n` +
        `Set them in .env — see docs/audit-sync.md for what each one is for.`,
    )
  }

  return { baseUrl, email, password, workspace }
}

export class DeskClient {
  private cookie: string | null = null

  constructor(private readonly config: DeskConfig) {}

  private url(path: string): string {
    return `${this.config.baseUrl}${path}`
  }

  async signIn(): Promise<void> {
    const response = await fetch(this.url("/api/auth/login"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: this.config.email, password: this.config.password }),
    })

    if (!response.ok) {
      throw new Error(
        `Could not sign in to the support desk as ${this.config.email} (HTTP ${response.status}). ` +
          `Check AUDIT_SYNC_DESK_EMAIL and AUDIT_SYNC_DESK_PASSWORD.`,
      )
    }

    // Keep the cookie explicitly rather than relying on a cookie jar. The member
    // session is a signed cookie, so preserving it verbatim is the whole of the
    // authentication.
    const setCookie = response.headers.getSetCookie?.() ?? []
    const session = setCookie.find((value) => value.startsWith("desk-member="))
    if (!session) {
      throw new Error("The support desk signed in but returned no session cookie.")
    }
    this.cookie = session.split(";")[0]
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    if (!this.cookie) await this.signIn()

    const response = await fetch(this.url(path), {
      ...init,
      headers: { ...(init.headers ?? {}), cookie: this.cookie as string },
    })

    // One silent re-authentication, so a session that expired mid-run does not
    // fail the whole sync.
    if (response.status === 401) {
      await this.signIn()
      return fetch(this.url(path), {
        ...init,
        headers: { ...(init.headers ?? {}), cookie: this.cookie as string },
      })
    }

    return response
  }

  /**
   * Every ticket in the workspace, walked page by page.
   *
   * The queue is ordered so that a page is not a recency slice, which means
   * paging is the only correct way to enumerate it — asking for one large page
   * would return a valid but partial set.
   */
  async listTickets(pageSize = 100): Promise<TicketRow[]> {
    const tickets: TicketRow[] = []

    for (let page = 0; ; page += 1) {
      const response = await this.request(
        `/api/workspaces/${encodeURIComponent(this.config.workspace)}/tickets?limit=${pageSize}&page=${page}`,
      )
      if (!response.ok) {
        throw new Error(`Listing tickets failed (HTTP ${response.status}).`)
      }

      const body = (await response.json()) as {
        tickets?: { id: string; status: string; externalRef?: string | null; updatedAt?: string }[]
        total?: number
      }

      const rows = body.tickets ?? []
      for (const row of rows) {
        // A ticket with no externalRef was not filed by a machine that had one, so
        // it has no finding to reconcile with.
        if (!row.externalRef) continue
        tickets.push({
          externalRef: row.externalRef,
          id: row.id,
          status: row.status as TicketRow["status"],
          updatedAt: row.updatedAt ? new Date(row.updatedAt) : new Date(),
        })
      }

      if (rows.length < pageSize) break
      if (page > 50) break // A guard against an unexpected loop, not a real limit.
    }

    return tickets
  }

  async setStatus(ticketId: string, status: TicketRow["status"]): Promise<void> {
    const response = await this.request(
      `/api/workspaces/${encodeURIComponent(this.config.workspace)}/tickets/${ticketId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      },
    )

    if (!response.ok) {
      const detail = await response.text().catch(() => "")
      throw new Error(
        `Setting ${ticketId} to ${status} failed (HTTP ${response.status}) ${detail.slice(0, 200)}`,
      )
    }
  }
}

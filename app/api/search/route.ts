import { NextResponse, type NextRequest } from "next/server"

import { requireUser } from "@/lib/authz"
import { isSearchableQuery, normalizeSearchQuery } from "@/lib/search"
import { searchForUser } from "@/lib/search-query"

/**
 * `GET /api/search?q=…`
 *
 * The caller's **own** entities only, grouped by type. `requireUser` is the same
 * refusal convention every route uses, so an unauthenticated request gets a
 * 401 rather than an empty result that reads as "no matches" — an oracle that
 * cannot tell "not signed in" from "nothing matched" is still an oracle.
 *
 * The query is normalised and length-checked here (not only in the client), so a
 * hand-crafted request cannot bypass the floor and ask for a bare wildcard.
 */
export async function GET(request: NextRequest) {
  const auth = await requireUser()
  if (!auth.authorized) return auth.response

  const query = normalizeSearchQuery(request.nextUrl.searchParams.get("q"))
  if (!isSearchableQuery(query)) {
    return NextResponse.json(
      { success: false, message: "Type at least two characters to search." },
      { status: 400 },
    )
  }

  const groups = await searchForUser(auth.user, query)
  return NextResponse.json({ success: true, query, groups })
}

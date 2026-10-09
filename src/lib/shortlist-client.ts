import type { Entry } from './entry.js'
import { localRank, type Pick } from './local-rank.js'

const LIMIT = 8
const MAX_REASON_LENGTH = 300

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface ShortlistResult {
  picks: Pick[]
  offline: boolean
  notice: string | null
}

const NOTICE = {
  rateLimited: 'The daily limit for smart search is used up, so this is offline matching. Smart search is back tomorrow.',
  unavailable: 'Smart search is unavailable, so this is offline matching. Try again in a moment for fuller answers.',
  unusable: 'Smart search sent back something we could not use, so this is offline matching. Try again in a moment.',
  unreachable: 'Smart search could not be reached, so this is offline matching. Check your connection and try again.',
}

function fallback(entries: Entry[], query: string, notice: string): ShortlistResult {
  return { picks: localRank(entries, query, LIMIT), offline: true, notice }
}

// The server answer is untrusted: keep only well formed picks for entries on the board.
function usablePicks(body: unknown, entries: Entry[]): Pick[] | null {
  const raw = (body as { picks?: unknown } | null)?.picks
  if (!Array.isArray(raw)) return null
  const known = new Set(entries.map((e) => e.slug))
  const picks: Pick[] = raw
    .filter((p) => typeof p?.slug === 'string' && typeof p?.reason === 'string' && known.has(p.slug))
    .map((p) => ({ slug: p.slug, reason: p.reason.slice(0, MAX_REASON_LENGTH) }))
  return raw.length > 0 && picks.length === 0 ? null : picks
}

export async function fetchShortlist(
  query: string,
  entries: Entry[],
  fetchImpl: FetchLike = fetch,
): Promise<ShortlistResult> {
  try {
    const res = await fetchImpl('/api/shortlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    })

    if (res.status === 429) return fallback(entries, query, NOTICE.rateLimited)
    if (!res.ok) return fallback(entries, query, NOTICE.unavailable)

    const picks = usablePicks(await res.json().catch(() => null), entries)
    if (!picks) return fallback(entries, query, NOTICE.unusable)
    return { picks, offline: false, notice: null }
  } catch {
    return fallback(entries, query, NOTICE.unreachable)
  }
}

import type { Entry } from '../src/lib/entry.js'

export const MAX_PICKS = 8
export const MAX_QUERY_LENGTH = 400
export const MAX_REASON_LENGTH = 200
export const DAILY_LIMIT = 60

export interface Pick {
  slug: string
  reason: string
}

const orUnknown = (value: string | null | undefined): string => value?.trim() || 'unknown'

export function buildCatalog(entries: Entry[]): string {
  return entries
    .map((e) => {
      const offers = e.offers.map((o) => `${o.meal} $${o.price}`).join(', ')
      const moods = e.moods.map((m) => m.tag).join(', ')
      return [
        e.slug,
        orUnknown(e.name),
        orUnknown(e.neighborhood),
        orUnknown(e.cuisine),
        orUnknown(offers),
        e.menuCoverage === 'none' ? 'no menu published' : moods || 'no mood tags',
        orUnknown(e.blurb),
      ].join(' | ')
    })
    .join('\n')
}

export function validateShortlist(raw: unknown, knownIds: Set<string>): Pick[] {
  if (typeof raw !== 'object' || raw === null) return []
  const picks = (raw as Record<string, unknown>).picks
  if (!Array.isArray(picks)) return []

  const seen = new Set<string>()
  const out: Pick[] = []

  for (const p of picks) {
    if (typeof p !== 'object' || p === null) continue
    const { slug, reason } = p as Record<string, unknown>
    if (typeof slug !== 'string' || typeof reason !== 'string') continue
    if (!knownIds.has(slug) || seen.has(slug)) continue
    seen.add(slug)
    out.push({ slug, reason: reason.slice(0, MAX_REASON_LENGTH) })
    if (out.length === MAX_PICKS) break
  }
  return out
}

export const SHORTLIST_SYSTEM_PROMPT = `You pick restaurants for San Francisco Restaurant Week, 16 to 25 October 2026.

You receive a catalog, one restaurant per line, in this shape:
slug | name | neighborhood | cuisine | offers | mood tags | blurb

Return only JSON: { "picks": [{ "slug": string, "reason": string }] }

Rules:
- Use at most ${MAX_PICKS} picks. Fewer is better when fewer genuinely fit.
- "slug" must be copied exactly from the catalog. Never invent one.
- "reason" is one sentence, under 15 words, naming the concrete thing that
  matches the request. Do not restate the request.
- When nothing fits well, return fewer picks rather than padding the list.`

export function validateQuery(query: unknown): 'bad_request' | 'query_too_long' | null {
  if (typeof query !== 'string' || !query.trim()) return 'bad_request'
  if (query.length > MAX_QUERY_LENGTH) return 'query_too_long'
  return null
}

export async function overDailyLimit(kv: KVNamespace, ip: string): Promise<boolean> {
  const key = `rate:${ip}:${new Date().toISOString().slice(0, 10)}`
  const stored = Number((await kv.get(key)) ?? '0')
  const used = Number.isFinite(stored) ? stored : 0
  if (used >= DAILY_LIMIT) return true
  await kv.put(key, String(used + 1), { expirationTtl: 60 * 60 * 25 })
  return false
}

// An API key that is not bound to one workspace must name the workspace on
// every request, or the API rejects it. A key that is bound must not send the
// header at all, so it is omitted when the binding is unset.
export function anthropicHeaders(apiKey: string, workspaceId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  }
  if (workspaceId) headers['anthropic-workspace-id'] = workspaceId
  return headers
}

import indexData from '../public/data/index.json' with { type: 'json' }
import type { Entry } from '../src/lib/entry.js'
import {
  buildCatalog,
  overDailyLimit,
  SHORTLIST_SYSTEM_PROMPT,
  validateQuery,
  validateShortlist,
} from './shortlist.js'

export interface Env {
  ASSETS: Fetcher
  KV: KVNamespace
  ANTHROPIC_API_KEY: string
}

const ENTRIES = indexData as unknown as Entry[]
const KNOWN = new Set(ENTRIES.map((e) => e.slug))
const CATALOG = buildCatalog(ENTRIES)

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function shortlist(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  let query: unknown
  try {
    query = ((await request.json()) as { query?: unknown } | null)?.query
  } catch {
    return json({ error: 'bad_request' }, 400)
  }

  const invalid = validateQuery(query)
  if (invalid) return json({ error: invalid }, 400)

  if (!env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not configured; skipping rate limit and upstream call')
    return json({ error: 'upstream_failed' }, 502)
  }

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  try {
    if (await overDailyLimit(env.KV, ip)) return json({ error: 'rate_limited' }, 429)
  } catch (err) {
    console.error('rate limit store failed', err instanceof Error ? err.name : 'unknown')
    return json({ error: 'unavailable' }, 503)
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5-5',
        max_tokens: 1000,
        system: [
          { type: 'text', text: SHORTLIST_SYSTEM_PROMPT },
          { type: 'text', text: CATALOG, cache_control: { type: 'ephemeral' } },
        ],
        messages: [{ role: 'user', content: query as string }],
      }),
    })
    if (!res.ok) {
      console.error('upstream returned status', res.status)
      return json({ error: 'upstream_failed' }, 502)
    }

    const body = (await res.json()) as { content: Array<{ type: string; text?: string }> }
    const text = body.content.find((c) => c.type === 'text')?.text ?? ''
    const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
    return json({ picks: validateShortlist(parsed, KNOWN) })
  } catch (err) {
    console.error('upstream call failed', err instanceof Error ? err.name : 'unknown')
    return json({ error: 'upstream_failed' }, 502)
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/api/shortlist') return shortlist(request, env)
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>

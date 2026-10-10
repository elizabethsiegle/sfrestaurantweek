import { env, SELF } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../../worker/index.js'
import { anthropicHeaders,
  buildCatalog,
  DAILY_LIMIT,
  MAX_PICKS,
  MAX_QUERY_LENGTH,
  overDailyLimit,
  SHORTLIST_SCHEMA,
  validateQuery,
  MAX_REASON_LENGTH,
  validateShortlist,
} from '../../worker/shortlist.js'
import type { Entry } from '../../src/lib/entry.js'

const known = new Set(['54-mint', 'a-mano', 'abaca'])

const entry = (slug: string): Entry => ({
  slug, name: slug, neighborhood: 'Mission', cuisine: 'Italian', diningOptions: ['Indoor Dining'],
  openTableUrl: null, websiteUrl: null,
  offers: [{ meal: 'Dinner', price: 75, courses: 3, dealDelta: 0, medianCourses: 3 }],
  menuCoverage: 'full', moods: [{ tag: 'date-night', evidence: 'shared plates' }],
  blurb: 'A three course Italian dinner.', vegetarianFriendly: false,
  lat: null, lng: null, address: null, personal: null,
})

describe('validateShortlist', () => {
  it('keeps well formed picks in order', () => {
    const picks = validateShortlist(
      { picks: [{ slug: '54-mint', reason: 'Shared plates suit a date.' }] }, known,
    )
    expect(picks).toEqual([{ slug: '54-mint', reason: 'Shared plates suit a date.' }])
  })

  it('drops a hallucinated slug that is not in the catalog', () => {
    const picks = validateShortlist(
      { picks: [{ slug: 'not-a-restaurant', reason: 'invented' }, { slug: 'a-mano', reason: 'real' }] },
      known,
    )
    expect(picks).toEqual([{ slug: 'a-mano', reason: 'real' }])
  })

  it('drops a repeated slug, keeping the first mention', () => {
    const picks = validateShortlist(
      { picks: [{ slug: 'abaca', reason: 'first' }, { slug: 'abaca', reason: 'second' }] }, known,
    )
    expect(picks).toEqual([{ slug: 'abaca', reason: 'first' }])
  })

  it('caps the number of picks at MAX_PICKS', () => {
    const slugs = Array.from({ length: 30 }, (_, i) => `slug-${i}`)
    const manyKnown = new Set(slugs)
    const picks = slugs.map((slug) => ({ slug, reason: 'x' }))
    expect(validateShortlist({ picks }, manyKnown)).toHaveLength(MAX_PICKS)
  })

  it('does not rely on the schema to cap picks, because structured outputs rejects maxItems', () => {
    expect(SHORTLIST_SCHEMA.properties.picks).not.toHaveProperty('maxItems')

    const slugs = Array.from({ length: MAX_PICKS + 5 }, (_, i) => `slug-${i}`)
    const overLongModelReply = { picks: slugs.map((slug) => ({ slug, reason: 'x' })) }
    expect(validateShortlist(overLongModelReply, new Set(slugs))).toHaveLength(MAX_PICKS)
  })

  it('rejects prototype keys used as slugs', () => {
    const picks = validateShortlist(
      { picks: [{ slug: '__proto__', reason: 'x' }, { slug: 'constructor', reason: 'y' }, { slug: 'toString', reason: 'z' }] },
      known,
    )
    expect(picks).toEqual([])
  })

  it('returns an empty array when every slug is unknown', () => {
    expect(validateShortlist({ picks: [{ slug: 'nope', reason: 'a' }, { slug: 'nada', reason: 'b' }] }, known)).toEqual([])
  })

  it('rejects entries with a wrong typed reason, a missing reason, or a null entry', () => {
    expect(validateShortlist({ picks: [{ slug: 'a-mano', reason: 42 }] }, known)).toEqual([])
    expect(validateShortlist({ picks: [{ slug: 'a-mano' }] }, known)).toEqual([])
    expect(validateShortlist({ picks: [null] }, known)).toEqual([])
  })

  it('truncates a reason to MAX_REASON_LENGTH', () => {
    const [pick] = validateShortlist({ picks: [{ slug: 'a-mano', reason: 'x'.repeat(500) }] }, known)
    expect(pick?.reason).toHaveLength(MAX_REASON_LENGTH)
  })

  it('returns an empty list for malformed input rather than throwing', () => {
    expect(validateShortlist('not json', known)).toEqual([])
    expect(validateShortlist({ picks: 'nope' }, known)).toEqual([])
    expect(validateShortlist({ picks: [{ slug: 54 }] }, known)).toEqual([])
  })
})

describe('buildCatalog', () => {
  it('includes the fields the model ranks on', () => {
    const catalog = buildCatalog([entry('54-mint')])
    expect(catalog).toContain('54-mint')
    expect(catalog).toContain('Mission')
    expect(catalog).toContain('date-night')
    expect(catalog).toContain('Dinner $75')
  })

  it('keeps columns positional when cuisine and offers are empty', () => {
    const sparse = { ...entry('a-mano'), cuisine: '', offers: [] }
    const columns = (line: string) => line.split(' | ')
    expect(columns(buildCatalog([sparse]))).toHaveLength(columns(buildCatalog([entry('a-mano')])).length)
    expect(columns(buildCatalog([sparse]))[3]).toBe('unknown')
    expect(columns(buildCatalog([sparse]))[4]).toBe('unknown')
  })

  it('separates a published menu with no mood tags from no menu at all', () => {
    const column = (e: Entry) => buildCatalog([e]).split(' | ')[5]
    expect(column({ ...entry('a-mano'), menuCoverage: 'full', moods: [] })).toBe('no mood tags')
    expect(column({ ...entry('abaca'), menuCoverage: 'none', moods: [] })).toBe('no menu published')
  })

  it('exposes the query length cap', () => {
    expect(MAX_QUERY_LENGTH).toBe(400)
  })
})

describe('validateQuery', () => {
  it('accepts a query of exactly MAX_QUERY_LENGTH characters', () => {
    expect(validateQuery('a'.repeat(MAX_QUERY_LENGTH))).toBeNull()
  })

  it('rejects a query one character over the limit', () => {
    expect(validateQuery('a'.repeat(MAX_QUERY_LENGTH + 1))).toBe('query_too_long')
  })

  it('rejects non-string queries', () => {
    expect(validateQuery(42)).toBe('bad_request')
    expect(validateQuery(null)).toBe('bad_request')
    expect(validateQuery({})).toBe('bad_request')
  })

  it('rejects an empty or blank query', () => {
    expect(validateQuery('')).toBe('bad_request')
    expect(validateQuery('   ')).toBe('bad_request')
  })
})

describe('overDailyLimit', () => {
  const today = () => new Date().toISOString().slice(0, 10)

  it('pins the daily limit', () => {
    expect(DAILY_LIMIT).toBe(60)
  })

  it('counts the first request of the day as 1', async () => {
    expect(await overDailyLimit(env.KV, 'first-of-day')).toBe(false)
    expect(await env.KV.get(`rate:first-of-day:${today()}`)).toBe('1')
  })

  it('keeps a separate bucket per IP', async () => {
    await env.KV.put(`rate:busy-ip:${today()}`, String(DAILY_LIMIT))
    expect(await overDailyLimit(env.KV, 'busy-ip')).toBe(true)
    expect(await overDailyLimit(env.KV, 'quiet-ip')).toBe(false)
  })

  it('treats a corrupt stored counter as zero', async () => {
    await env.KV.put(`rate:corrupt-ip:${today()}`, 'garbage')
    expect(await overDailyLimit(env.KV, 'corrupt-ip')).toBe(false)
    expect(await env.KV.get(`rate:corrupt-ip:${today()}`)).toBe('1')
  })

  it('allows a caller one below the limit and counts the call', async () => {
    const ip = 'below-limit'
    const key = `rate:${ip}:${new Date().toISOString().slice(0, 10)}`
    await env.KV.put(key, String(DAILY_LIMIT - 1))
    expect(await overDailyLimit(env.KV, ip)).toBe(false)
    expect(await env.KV.get(key)).toBe(String(DAILY_LIMIT))
  })

  it('rejects a caller at exactly the limit without counting further', async () => {
    const ip = 'at-limit'
    const key = `rate:${ip}:${new Date().toISOString().slice(0, 10)}`
    await env.KV.put(key, String(DAILY_LIMIT))
    expect(await overDailyLimit(env.KV, ip)).toBe(true)
    expect(await env.KV.get(key)).toBe(String(DAILY_LIMIT))
  })
})

describe('POST /api/shortlist', () => {
  it('returns 400 when the body is not JSON', async () => {
    const res = await SELF.fetch('https://example.com/api/shortlist', { method: 'POST', body: 'not json at all' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'bad_request' })
  })

  it('returns 405 for a GET', async () => {
    const res = await SELF.fetch('https://example.com/api/shortlist')
    expect(res.status).toBe(405)
  })
})

describe('POST /api/shortlist with a stubbed upstream', () => {
  const SECRET = 'sk-ant-test-secret-do-not-leak'
  const workerEnv = { KV: env.KV, ASSETS: env.ASSETS, ANTHROPIC_API_KEY: SECRET }
  afterEach(() => vi.unstubAllGlobals())

  const stubModelText = (text: string, status = 200) => {
    const stub = vi.fn(async () => new Response(JSON.stringify({ content: [{ type: 'text', text }] }), { status }))
    vi.stubGlobal('fetch', stub)
    return stub
  }

  const ask = (ip: string) =>
    worker.fetch(
      new Request('https://example.com/api/shortlist', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': ip },
        body: JSON.stringify({ query: 'somewhere warm for four' }),
      }),
      workerEnv,
    )

  const firstRealSlug = async (): Promise<string> => {
    const index = (await import('../../public/data/index.json')).default as Array<{ slug: string }>
    return index[0]!.slug
  }

  it('returns the parsed picks for a well formed model response', async () => {
    const slug = await firstRealSlug()
    const stub = stubModelText(JSON.stringify({ picks: [{ slug, reason: 'Warm room.' }] }))
    const res = await ask('stub-ok')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ picks: [{ slug, reason: 'Warm room.' }] })
    expect(stub).toHaveBeenCalledOnce()
  })

  it('keeps only known ids from a mixed response', async () => {
    const slug = await firstRealSlug()
    stubModelText(`Here you go: ${JSON.stringify({ picks: [{ slug: 'invented', reason: 'a' }, { slug, reason: 'b' }] })}`)
    const res = await ask('stub-mixed')
    expect(await res.json()).toEqual({ picks: [{ slug, reason: 'b' }] })
  })

  it('returns 502 when the model text has no JSON object', async () => {
    stubModelText('Sorry, I cannot help with that.')
    const res = await ask('stub-nojson')
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'upstream_failed' })
  })

  it('returns 502 on an upstream error status and never exposes the key', async () => {
    stubModelText('{}', 401)
    const res = await ask('stub-401')
    expect(res.status).toBe(502)
    expect(await res.text()).not.toContain(SECRET)
  })

  it('never puts the key in a successful response body', async () => {
    const slug = await firstRealSlug()
    stubModelText(JSON.stringify({ picks: [{ slug, reason: 'ok' }] }))
    expect(await (await ask('stub-key')).text()).not.toContain(SECRET)
  })

  const today = () => new Date().toISOString().slice(0, 10)

  it('returns 502 without spending a rate limit slot or calling out when the key is missing', async () => {
    const stub = vi.fn()
    vi.stubGlobal('fetch', stub)
    const res = await worker.fetch(
      new Request('https://example.com/api/shortlist', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': 'no-key-ip' },
        body: JSON.stringify({ query: 'somewhere warm for four' }),
      }),
      { KV: env.KV, ASSETS: env.ASSETS, ANTHROPIC_API_KEY: '' },
    )
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'upstream_failed' })
    expect(stub).not.toHaveBeenCalled()
    expect(await env.KV.get(`rate:no-key-ip:${today()}`)).toBeNull()
  })

  it('still spends a rate limit slot when the key is present', async () => {
    stubModelText(JSON.stringify({ picks: [] }))
    const res = await ask('with-key-ip')
    expect(res.status).toBe(200)
    expect(await env.KV.get(`rate:with-key-ip:${today()}`)).toBe('1')
  })
})

describe('anthropicHeaders', () => {
  it('omits the workspace header when no workspace is configured', () => {
    const headers = anthropicHeaders('test-key')
    expect(headers['x-api-key']).toBe('test-key')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect('anthropic-workspace-id' in headers).toBe(false)
  })

  it('names the workspace when one is configured', () => {
    const headers = anthropicHeaders('test-key', 'wrkspc_abc123')
    expect(headers['anthropic-workspace-id']).toBe('wrkspc_abc123')
  })

  it('omits the header for an empty workspace id rather than sending a blank one', () => {
    expect('anthropic-workspace-id' in anthropicHeaders('test-key', '')).toBe(false)
  })
})

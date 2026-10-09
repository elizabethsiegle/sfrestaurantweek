import { describe, expect, it } from 'vitest'
import { fetchShortlist } from '../src/lib/shortlist-client.js'
import type { Entry } from '../src/lib/entry.js'

const entries: Entry[] = [{
  slug: 'pasta', name: 'Pasta Place', neighborhood: 'Marina', cuisine: 'Italian',
  diningOptions: [], openTableUrl: null, websiteUrl: null,
  offers: [{ meal: 'Dinner', price: 75, courses: 3, dealDelta: 0, medianCourses: 3 }],
  menuCoverage: 'full', moods: [], blurb: null, vegetarianFriendly: false,
  lat: null, lng: null, address: null, personal: null,
}]

describe('fetchShortlist', () => {
  it('returns the server picks when the call succeeds', async () => {
    const ok = async () =>
      new Response(JSON.stringify({ picks: [{ slug: 'pasta', reason: 'Italian in the Marina.' }] }), { status: 200 })
    const result = await fetchShortlist('italian', entries, ok)
    expect(result.offline).toBe(false)
    expect(result.picks).toHaveLength(1)
    expect(result.notice).toBeNull()
  })

  it('falls back to local matching and says so when the server fails', async () => {
    const boom = async () => new Response(JSON.stringify({ error: 'upstream_failed' }), { status: 502 })
    const result = await fetchShortlist('italian', entries, boom)
    expect(result.offline).toBe(true)
    expect(result.picks[0]!.slug).toBe('pasta')
    expect(result.notice).toMatch(/offline matching/i)
  })

  it('names rate limiting specifically so the person knows to wait', async () => {
    const limited = async () => new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429 })
    const result = await fetchShortlist('italian', entries, limited)
    expect(result.offline).toBe(true)
    expect(result.notice).toMatch(/daily limit/i)
  })

  it('gives rate limiting and a generic failure different notices with different remedies', async () => {
    const limited = await fetchShortlist('italian', entries, async () => new Response('{}', { status: 429 }))
    const failed = await fetchShortlist('italian', entries, async () => new Response('{}', { status: 502 }))
    expect(limited.notice).not.toBe(failed.notice)
    expect(limited.notice).toMatch(/tomorrow/i)
    expect(failed.notice).toMatch(/try again/i)
  })

  it('falls back when the network throws outright', async () => {
    const dead = async () => { throw new Error('network down') }
    const result = await fetchShortlist('italian', entries, dead)
    expect(result.offline).toBe(true)
    expect(result.picks[0]!.slug).toBe('pasta')
  })

  it('falls back when the body is not JSON', async () => {
    const result = await fetchShortlist('italian', entries, async () => new Response('<html>', { status: 200 }))
    expect(result.offline).toBe(true)
  })

  it('falls back when the server names only slugs that are not on the board', async () => {
    const ghost = async () =>
      new Response(JSON.stringify({ picks: [{ slug: 'nowhere', reason: 'Made up.' }] }), { status: 200 })
    const result = await fetchShortlist('italian', entries, ghost)
    expect(result.offline).toBe(true)
    expect(result.picks.map((p) => p.slug)).toEqual(['pasta'])
  })

  it('keeps an empty server answer as a real answer, not an outage', async () => {
    const none = async () => new Response(JSON.stringify({ picks: [] }), { status: 200 })
    const result = await fetchShortlist('italian', entries, none)
    expect(result).toEqual({ picks: [], offline: false, notice: null })
  })

  it('caps a very long reason', async () => {
    const long = async () =>
      new Response(JSON.stringify({ picks: [{ slug: 'pasta', reason: 'x'.repeat(5000) }] }), { status: 200 })
    const result = await fetchShortlist('italian', entries, long)
    expect(result.picks[0]!.reason).toHaveLength(300)
  })

  it('keeps technical words and status codes out of every notice', async () => {
    for (const status of [400, 429, 500, 502, 503]) {
      const result = await fetchShortlist('italian', entries, async () => new Response('{}', { status }))
      expect(result.notice).not.toMatch(/\b(4\d\d|5\d\d|error|failed|exception)\b/i)
    }
  })
})

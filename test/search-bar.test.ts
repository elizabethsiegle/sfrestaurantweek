import { beforeEach, describe, expect, it } from 'vitest'
import { entries, filters, shortlistReasons, showShortlistOrder, sort, visible } from '../src/state/board.js'
import { EMPTY_FILTERS } from '../src/lib/filter.js'
import { busy, clearSearch, notice, query, runSearch, SEARCH_PLACEHOLDER } from '../src/components/SearchBar.js'
import { localRank } from '../src/lib/local-rank.js'
import { readFileSync } from 'node:fs'
import type { Entry } from '../src/lib/entry.js'

const make = (slug: string, cuisine: string): Entry => ({
  slug, name: slug, neighborhood: 'Mission', cuisine,
  diningOptions: ['Indoor Dining'], openTableUrl: null, websiteUrl: null,
  offers: [{ meal: 'Dinner', price: 75, courses: null, dealDelta: null, medianCourses: null }],
  menuCoverage: 'none', moods: [], blurb: null, vegetarianFriendly: false,
  lat: null, lng: null, address: null, personal: null,
})

const board = [make('pasta', 'Italian'), make('sushi', 'Japanese'), make('tacos', 'Mexican')]
const respond = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status })
const baseFilters = { ...EMPTY_FILTERS, neighborhoods: ['Mission'], maxPrice: 100 }

beforeEach(() => {
  entries.value = board
  filters.value = baseFilters
  shortlistReasons.value = new Map()
  query.value = ''
  notice.value = null
  busy.value = false
  sort.value = 'value'
})

describe('runSearch', () => {
  it('applies the server shortlist and leaves other filters and entries alone', async () => {
    query.value = 'something light'
    await runSearch(respond(200, { picks: [{ slug: 'sushi', reason: 'Light fish.' }] }))
    expect(filters.value).toEqual({ ...baseFilters, shortlist: ['sushi'] })
    expect(entries.value).toBe(board)
    expect(visible.value.map((e) => e.slug)).toEqual(['sushi'])
    expect(shortlistReasons.value.get('sushi')).toBe('Light fish.')
    expect(notice.value).toBe('1 restaurant shown.')
    expect(busy.value).toBe(false)
  })

  it('falls back offline with a notice and leaves other filters and entries alone', async () => {
    query.value = 'italian'
    await runSearch(respond(502, { error: 'upstream_failed' }))
    expect(filters.value).toEqual({ ...baseFilters, shortlist: ['pasta'] })
    expect(entries.value).toBe(board)
    expect(notice.value).toMatch(/offline matching/i)
    expect(notice.value).toMatch(/1 restaurant shown\.$/)
    expect(busy.value).toBe(false)
  })

  it('shows a distinct notice when rate limited', async () => {
    query.value = 'italian'
    await runSearch(respond(502, {}))
    const generic = notice.value
    await runSearch(respond(429, {}))
    expect(notice.value).toMatch(/daily limit/i)
    expect(notice.value).not.toBe(generic)
  })

  it('shows a plain nothing-matched state and keeps the full board', async () => {
    query.value = 'zzzzz'
    await runSearch(respond(502, {}))
    expect(notice.value).toMatch(/nothing matched/i)
    expect(filters.value.shortlist).toBeNull()
    expect(visible.value).toHaveLength(3)
    expect(busy.value).toBe(false)
  })

  it('does nothing for a blank query', async () => {
    query.value = '   '
    await runSearch(respond(200, { picks: [] }))
    expect(filters.value.shortlist).toBeNull()
    expect(notice.value).toBeNull()
  })

  it('re-enables the button when the fetch throws', async () => {
    query.value = 'italian'
    await runSearch(async () => { throw new Error('down') })
    expect(busy.value).toBe(false)
  })

  it('ignores a slow answer that arrives after the search was cleared', async () => {
    query.value = 'italian'
    let release!: (r: Response) => void
    const slow = () => new Promise<Response>((resolve) => { release = resolve })
    const pending = runSearch(slow)
    clearSearch()
    release(new Response(JSON.stringify({ picks: [{ slug: 'pasta', reason: 'x' }] }), { status: 200 }))
    await pending
    expect(filters.value.shortlist).toBeNull()
    expect(notice.value).toBeNull()
    expect(busy.value).toBe(false)
  })
})

describe('SEARCH_PLACEHOLDER', () => {
  it('returns relevant picks from local ranking on the real index', () => {
    const real = JSON.parse(readFileSync(new URL('../public/data/index.json', import.meta.url), 'utf8')) as Entry[]
    const bySlug = new Map(real.map((e) => [e.slug, e]))
    const picks = localRank(real, SEARCH_PLACEHOLDER, 8).map((p) => bySlug.get(p.slug)!)
    expect(picks.length).toBeGreaterThan(0)
    const [first] = picks
    expect(first!.cuisine === 'Italian' || /mission/i.test(first!.neighborhood)).toBe(true)
  })
})

describe('overlapping searches', () => {
  it('keeps the newer answer when the older one arrives last', async () => {
    const releases: Array<(r: Response) => void> = []
    const slow = () => new Promise<Response>((resolve) => { releases.push(resolve) })
    const answer = (slug: string) => new Response(JSON.stringify({ picks: [{ slug, reason: slug }] }), { status: 200 })

    query.value = 'first'
    const older = runSearch(slow)
    query.value = 'second'
    const newer = runSearch(slow)

    releases[1]!(answer('tacos'))
    await newer
    releases[0]!(answer('pasta'))
    await older

    expect(filters.value.shortlist).toEqual(['tacos'])
    expect(shortlistReasons.value.has('pasta')).toBe(false)
    expect(busy.value).toBe(false)
  })
})

describe('the order the picks arrive in', () => {
  const ranked = respond(200, {
    picks: [
      { slug: 'tacos', reason: 'Closest to the theater.' },
      { slug: 'pasta', reason: 'The cheapest lunch.' },
      { slug: 'sushi', reason: 'Quiet enough to talk.' },
    ],
  })

  it('shows the board in the order the picks came back, not alphabetically', async () => {
    query.value = 'something before a show'
    await runSearch(ranked)
    expect(sort.value).toBe('shortlist')
    expect(visible.value.map((e) => e.slug)).toEqual(['tacos', 'pasta', 'sushi'])
  })

  it('gives the sort back when the search is cleared', async () => {
    sort.value = 'price'
    query.value = 'something before a show'
    await runSearch(ranked)
    expect(sort.value).toBe('shortlist')
    clearSearch()
    expect(sort.value).toBe('price')
  })

  it('keeps a sort the visitor picked after the search', async () => {
    query.value = 'something before a show'
    await runSearch(ranked)
    sort.value = 'name'
    clearSearch()
    expect(sort.value).toBe('name')
    expect(visible.value.map((e) => e.slug)).toEqual(['pasta', 'sushi', 'tacos'])
  })

  it('remembers the sort the visitor chose mid-search when they go back to the picks', async () => {
    sort.value = 'value'
    query.value = 'something before a show'
    await runSearch(ranked)
    sort.value = 'price'
    showShortlistOrder()
    clearSearch()
    expect(sort.value).toBe('price')
  })

  it('leaves the sort alone when nothing matched', async () => {
    sort.value = 'price'
    query.value = 'zzzzz'
    await runSearch(respond(502, {}))
    expect(notice.value).toMatch(/nothing matched/i)
    expect(sort.value).toBe('price')
  })
})

describe('clearSearch', () => {
  it('restores the full list and drops the stale shortlist and reasons', async () => {
    query.value = 'italian'
    await runSearch(respond(502, {}))
    expect(visible.value).toHaveLength(1)
    clearSearch()
    expect(filters.value.shortlist).toBeNull()
    expect(shortlistReasons.value.size).toBe(0)
    expect(query.value).toBe('')
    expect(notice.value).toBeNull()
    expect(visible.value).toHaveLength(3)
    expect(filters.value.neighborhoods).toEqual(['Mission'])
  })
})

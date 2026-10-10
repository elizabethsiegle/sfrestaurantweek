import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { localRank } from '../src/lib/local-rank.js'
import type { Entry } from '../src/lib/entry.js'

const make = (over: Partial<Entry>): Entry => ({
  slug: 'x', name: 'X', neighborhood: 'Mission', cuisine: 'Italian',
  diningOptions: ['Indoor Dining'], openTableUrl: null, websiteUrl: null,
  offers: [{ meal: 'Dinner', price: 75, courses: 3, dealDelta: 0, medianCourses: 3 }],
  menuCoverage: 'full', moods: [], blurb: null, vegetarianFriendly: false,
  lat: null, lng: null, address: null, personal: null, ...over,
})

describe('localRank', () => {
  const entries = [
    make({ slug: 'sushi', name: 'Sushi Place', cuisine: 'Japanese' }),
    make({ slug: 'pasta', name: 'Pasta Place', cuisine: 'Italian', neighborhood: 'Marina' }),
    make({ slug: 'date', name: 'Candle Room', moods: [{ tag: 'date-night', evidence: 'shared plates' }] }),
  ]

  it('matches on cuisine', () => {
    expect(localRank(entries, 'japanese', 5)[0]!.slug).toBe('sushi')
  })

  it('matches on neighborhood', () => {
    expect(localRank(entries, 'marina', 5)[0]!.slug).toBe('pasta')
  })

  it('matches a mood phrase against the tag', () => {
    expect(localRank(entries, 'date night', 5)[0]!.slug).toBe('date')
  })

  it('returns nothing when no term matches', () => {
    expect(localRank(entries, 'zzzzz', 5)).toEqual([])
  })

  it('respects the limit', () => {
    expect(localRank(entries, 'place', 1)).toHaveLength(1)
  })

  it('gives every pick a reason naming what matched', () => {
    expect(localRank(entries, 'japanese', 5)[0]!.reason).toMatch(/japanese/i)
  })
})

describe('localRank on a plausible board', () => {
  const offer = (meal: 'Dinner' | 'Lunch' | 'Brunch', price: number) => ({
    meal, price, courses: null, dealDelta: null, medianCourses: null,
  })
  const board = [
    make({ slug: 'a', name: 'Alfa Trattoria', cuisine: 'Italian', neighborhood: 'North Beach', offers: [offer('Dinner', 45)] }),
    make({ slug: 'b', name: 'Zuni Casa', cuisine: 'Italian', neighborhood: 'Mission', offers: [offer('Lunch', 25)] }),
    make({ slug: 'c', name: 'Zesty Taqueria', cuisine: 'Mexican', neighborhood: 'Mission', offers: [offer('Dinner', 30)], diningOptions: ['Outdoor Dining'] }),
    make({ slug: 'd', name: 'Prime Cut', cuisine: 'Steakhouse', neighborhood: 'Financial District', offers: [offer('Dinner', 90)] }),
    make({ slug: 'e', name: 'Greens Table', cuisine: 'Californian', neighborhood: 'Marina', offers: [offer('Dinner', 60)], vegetarianFriendly: true }),
  ]

  it('finds a cuisine when moods and blurb are empty', () => {
    expect(localRank(board, 'italian', 8).map((p) => p.slug).sort()).toEqual(['a', 'b'])
  })

  it('finds a neighborhood when moods and blurb are empty', () => {
    expect(localRank(board, 'mission', 8).map((p) => p.slug).sort()).toEqual(['b', 'c'])
  })

  it('treats cheap as a price limit and lists the cheapest first', () => {
    const picks = localRank(board, 'cheap dinner', 8)
    expect(picks.map((p) => p.slug)).toEqual(['c'])
    expect(picks[0]!.reason).toMatch(/\$30/)
  })

  it('applies an under-dollar budget', () => {
    const slugs = localRank(board, 'dinner under $50', 8).map((p) => p.slug)
    expect(slugs).toEqual(['c', 'a'])
    expect(localRank(board, 'dinner under $50', 8).map((p) => p.reason)).toEqual([
      'Dinner from $30.',
      'Dinner from $45.',
    ])
  })

  it('keeps only entries that serve a named meal', () => {
    expect(localRank(board, 'italian lunch', 8).map((p) => p.slug)).toEqual(['b'])
  })

  it('understands plurals and cuisine words like tacos', () => {
    expect(localRank(board, 'tacos', 8)[0]!.slug).toBe('c')
  })

  it('matches outdoor seating', () => {
    expect(localRank(board, 'outdoor', 8)[0]!.slug).toBe('c')
  })

  it('matches vegetarian', () => {
    expect(localRank(board, 'vegetarian', 8)[0]!.slug).toBe('e')
  })

  it('returns nothing when a text term matches nothing, even if a budget would match', () => {
    expect(localRank(board, 'somewhere warm for four people under $50', 8)).toEqual([])
    expect(localRank(board, 'japanese under $50', 8)).toEqual([])
  })

  it('still ranks by price when the query is only a constraint', () => {
    expect(localRank(board, 'under $50', 8).map((p) => p.slug)).toEqual(['b', 'c', 'a'])
  })

  it('does not treat object prototype keys as meals or aliases', () => {
    for (const word of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
      expect(localRank(board, word, 8)).toEqual([])
    }
  })

  it('uses mood tags and blurbs once they exist', () => {
    const tagged = [
      make({ slug: 'warm', name: 'Hearth', cuisine: 'American', moods: [{ tag: 'comfort-food', evidence: 'braises' }] }),
      make({ slug: 'plain', name: 'Plain', cuisine: 'American' }),
      make({ slug: 'blurbed', name: 'Orchard', cuisine: 'American', blurb: 'A seasonal tasting of foraged mushrooms.' }),
    ]
    expect(localRank(tagged, 'somewhere warm', 5)[0]!.slug).toBe('warm')
    expect(localRank(tagged, 'mushrooms', 5)[0]!.slug).toBe('blurbed')
  })

  it('ranks a stronger match above a weaker one', () => {
    expect(localRank(board, 'italian mission', 8).map((p) => p.slug)).toEqual(['b', 'a', 'c'])
  })
})

describe("localRank on today's real index", () => {
  const real = JSON.parse(readFileSync(new URL('../public/data/index.json', import.meta.url), 'utf8')) as Entry[]
  const bySlug = new Map(real.map((e) => [e.slug, e]))
  const pickEntries = (query: string) => localRank(real, query, 8).map((p) => bySlug.get(p.slug)!)
  const dinnerPrice = (e: Entry) => Math.min(...e.offers.filter((o) => o.meal === 'Dinner').map((o) => o.price))

  it('returns only Italian entries for italian, each with a reason', () => {
    const picks = localRank(real, 'italian', 8)
    expect(picks.length).toBeGreaterThan(0)
    expect(picks.every((p) => /italian/i.test(p.reason))).toBe(true)
    expect(pickEntries('italian').every((e) => e.cuisine === 'Italian')).toBe(true)
  })

  it('returns dinners at $35 or less, cheapest first, for cheap dinner', () => {
    const prices = pickEntries('cheap dinner').map(dinnerPrice)
    expect(prices.length).toBeGreaterThan(0)
    expect(prices.every((p) => p <= 35)).toBe(true)
    expect(prices).toEqual([...prices].sort((a, b) => a - b))
  })

  it('puts entries that are both Italian and in Mission first for mission italian', () => {
    const both = real.filter((e) => e.cuisine === 'Italian' && e.neighborhood === 'Mission')
    expect(both.length).toBeGreaterThan(0)
    const picks = pickEntries('mission italian')
    const leaders = picks.slice(0, Math.min(both.length, picks.length))
    expect(leaders.every((e) => e.cuisine === 'Italian' && e.neighborhood === 'Mission')).toBe(true)
  })

  it('leads with steakhouses for steak, before menus that merely serve steak', () => {
    const picks = pickEntries('steak')
    const houses = picks.filter((e) => /steak/i.test(e.cuisine))
    expect(houses.length).toBeGreaterThan(0)
    expect(picks.slice(0, houses.length)).toEqual(houses)
  })

  it('returns only entries with outdoor dining for outdoor dining', () => {
    const picks = pickEntries('outdoor dining')
    expect(picks.length).toBeGreaterThan(0)
    expect(picks.every((e) => e.diningOptions.includes('Outdoor Dining'))).toBe(true)
  })

  it('returns only restaurants in the neighborhood for mission', () => {
    const picks = pickEntries('mission')
    expect(picks.length).toBeGreaterThan(0)
    expect(picks.every((e) => /mission/i.test(e.neighborhood))).toBe(true)
  })

  it('returns nothing for italian under $20 rather than unrelated cheap entries', () => {
    expect(localRank(real, 'italian under $20', 8)).toEqual([])
  })

  it('answers the placeholder query with comfort food inside the budget', () => {
    const picks = pickEntries('somewhere warm for four people under $50')
    expect(picks.length).toBeGreaterThan(0)
    expect(picks.every((e) => e.offers.some((o) => o.price <= 50))).toBe(true)
    expect(picks.every((e) => e.moods.some((m) => m.tag === 'comfort-food'))).toBe(true)
  })

  it('still returns cheap entries for a bare budget', () => {
    const picks = pickEntries('under $20')
    expect(picks.length).toBeGreaterThan(0)
    expect(picks.every((e) => e.offers.some((o) => o.price <= 20))).toBe(true)
  })
})

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { toFeatureCollection } from '../src/lib/markers.js'
import { applyFilters, EMPTY_FILTERS } from '../src/lib/filter.js'
import type { Entry } from '../src/lib/entry.js'

const make = (over: Partial<Entry>): Entry => ({
  slug: 'x', name: 'X', neighborhood: 'Mission', cuisine: 'Italian',
  diningOptions: [], openTableUrl: null, websiteUrl: null,
  offers: [{ meal: 'Dinner', price: 75, courses: 3, dealDelta: 0, medianCourses: 3 }],
  menuCoverage: 'full', moods: [], blurb: null, vegetarianFriendly: false,
  lat: null, lng: null, address: null, personal: null, ...over,
})

describe('toFeatureCollection', () => {
  it('maps a located restaurant to a point in lng,lat order', () => {
    const fc = toFeatureCollection([make({ slug: 'a', lat: 37.78, lng: -122.41 })])
    expect(fc.features).toHaveLength(1)
    expect(fc.features[0]!.geometry).toEqual({ type: 'Point', coordinates: [-122.41, 37.78] })
  })

  it('omits restaurants that failed geocoding rather than placing them at zero', () => {
    const fc = toFeatureCollection([make({ slug: 'a' }), make({ slug: 'b', lat: 37.78, lng: -122.41 })])
    expect(fc.features).toHaveLength(1)
    expect(fc.features[0]!.properties.slug).toBe('b')
  })

  it('carries the name and lowest price for the popup', () => {
    const fc = toFeatureCollection([
      make({ name: 'Two Offers', lat: 37.78, lng: -122.41, offers: [
        { meal: 'Dinner', price: 75, courses: 3, dealDelta: 0, medianCourses: 3 },
        { meal: 'Lunch', price: 25, courses: 3, dealDelta: 0, medianCourses: 3 },
      ] }),
    ])
    expect(fc.features[0]!.properties).toMatchObject({ name: 'Two Offers', lowestPrice: 25 })
  })

  it('does not throw on the real data and places only entries that have both coordinates', () => {
    const real = JSON.parse(readFileSync('public/data/index.json', 'utf8')) as Entry[]
    expect(real.length).toBeGreaterThan(0)
    const fc = toFeatureCollection(real)
    const located = real.filter((e) => typeof e.lat === 'number' && typeof e.lng === 'number')
    expect(fc.features).toHaveLength(located.length)
    expect(toFeatureCollection(real.filter((e) => !located.includes(e))).features).toEqual([])
  })

  it('omits an entry whose coordinate keys are missing entirely', () => {
    const bare = { ...make({ slug: 'bare' }) } as Partial<Entry>
    delete bare.lat
    delete bare.lng
    expect(toFeatureCollection([bare as Entry]).features).toEqual([])
  })

  it('omits an entry with only one coordinate instead of defaulting the other to zero', () => {
    const fc = toFeatureCollection([
      make({ slug: 'lat-only', lat: 37.78 }),
      make({ slug: 'lng-only', lng: -122.41 }),
    ])
    expect(fc.features).toEqual([])
  })

  it('keeps a legitimate zero coordinate', () => {
    const fc = toFeatureCollection([make({ slug: 'eq', lat: 0, lng: 0 })])
    expect(fc.features).toHaveLength(1)
  })

  it('follows the filtered list so filtering the list also filters the pins', () => {
    const all = [
      make({ slug: 'a', neighborhood: 'Mission', lat: 37.76, lng: -122.42 }),
      make({ slug: 'b', neighborhood: 'Marina', lat: 37.8, lng: -122.43 }),
    ]
    const slugs = (list: Entry[]) => toFeatureCollection(list).features.map((f) => f.properties.slug)
    expect(slugs(applyFilters(all, EMPTY_FILTERS))).toEqual(['a', 'b'])
    expect(slugs(applyFilters(all, { ...EMPTY_FILTERS, neighborhoods: ['Marina'] }))).toEqual(['b'])
  })

  it('puts San Francisco at longitude first, so it is not mistaken for Kazakhstan', () => {
    const [lng, lat] = toFeatureCollection([make({ lat: 37.7749, lng: -122.4194 })]).features[0]!.geometry.coordinates
    expect(lng).toBeLessThan(-100)
    expect(lat).toBeGreaterThan(30)
    expect(lat).toBeLessThan(90)
  })
})

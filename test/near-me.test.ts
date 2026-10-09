import { beforeEach, describe, expect, it } from 'vitest'
import { entries, filters, origin, sort } from '../src/state/board.js'
import { busy, locate, problem } from '../src/components/NearMe.js'
import type { Entry } from '../src/lib/entry.js'

const make = (slug: string, lat: number | null, lng: number | null): Entry => ({
  slug, name: slug, neighborhood: 'Mission', cuisine: 'Italian',
  diningOptions: ['Indoor Dining'], openTableUrl: null, websiteUrl: null,
  offers: [{ meal: 'Dinner', price: 75, courses: 3, dealDelta: 0, medianCourses: 3 }],
  menuCoverage: 'full', moods: [], blurb: null, vegetarianFriendly: false,
  lat, lng, address: null, personal: null,
})

const granting = {
  getCurrentPosition: (ok: PositionCallback) =>
    ok({ coords: { latitude: 37.77, longitude: -122.42 } } as GeolocationPosition),
} as Geolocation

const failing = (code: number) =>
  ({
    getCurrentPosition: (_ok: PositionCallback, fail?: PositionErrorCallback) =>
      fail?.({ code, message: 'x' } as GeolocationPositionError),
  }) as Geolocation

beforeEach(() => {
  entries.value = [make('a', null, null), make('b', null, null)]
  filters.value = { ...filters.value, neighborhoods: ['Mission'] }
  sort.value = 'price'
  origin.value = null
  problem.value = null
  busy.value = false
})

describe('locate', () => {
  it.each([1, 2, 3])('leaves board state untouched when the request fails with code %i', async (code) => {
    const filtersBefore = filters.value
    const entriesBefore = entries.value
    await locate(failing(code))
    expect(origin.value).toBeNull()
    expect(sort.value).toBe('price')
    expect(filters.value).toBe(filtersBefore)
    expect(entries.value).toBe(entriesBefore)
    expect(problem.value).toBeTruthy()
    expect(busy.value).toBe(false)
  })

  it('says different things for a declined permission and a failed fix', async () => {
    await locate(failing(1))
    const declined = problem.value
    await locate(failing(2))
    expect(declined).not.toBe(problem.value)
  })

  it('reports an unsupported browser without touching the board', async () => {
    await locate(undefined)
    expect(problem.value).toMatch(/does not support location/i)
    expect(origin.value).toBeNull()
    expect(sort.value).toBe('price')
  })

  it('shows the authored unavailable sentence when a non-Error is thrown', async () => {
    const throwing = {
      getCurrentPosition: () => {
        throw 'boom'
      },
    } as unknown as Geolocation
    await locate(throwing)
    expect(problem.value).toMatch(/^Location is unavailable right now/)
    expect(problem.value).not.toMatch(/boom/)
    expect(origin.value).toBeNull()
    expect(sort.value).toBe('price')
  })

  it('tells a declined visitor how to undo it', async () => {
    await locate(failing(1))
    expect(problem.value).toMatch(/browser settings/i)
    expect(problem.value).toMatch(/press near me again/i)
  })

  it('sorts by distance after a grant when restaurants have coordinates', async () => {
    entries.value = [make('a', 37.78, -122.42), make('b', null, null)]
    await locate(granting)
    expect(origin.value).toEqual({ lat: 37.77, lng: -122.42 })
    expect(sort.value).toBe('distance')
    expect(problem.value).toBeNull()
  })

  it('keeps the current sort and says so when no restaurant has coordinates yet', async () => {
    await locate(granting)
    expect(origin.value).toEqual({ lat: 37.77, lng: -122.42 })
    expect(sort.value).toBe('price')
    expect(problem.value).toMatch(/walking times are not available yet/i)
  })

  it('clears a previous problem when a new attempt starts', async () => {
    await locate(failing(1))
    entries.value = [make('a', 37.78, -122.42)]
    await locate(granting)
    expect(problem.value).toBeNull()
  })
})

import type { Entry } from './entry.js'
import type { MoodTag } from './moods.js'
import type { Meal } from './types.js'
import { distanceMeters, type Origin } from './geo.js'

export type SortKey = 'shortlist' | 'value' | 'price' | 'name' | 'distance'

export interface FilterState {
  meals: Meal[]
  neighborhoods: string[]
  cuisines: string[]
  diningOptions: string[]
  moods: MoodTag[]
  maxPrice: number | null
  vegetarianOnly: boolean
  shortlist: string[] | null
}

export const EMPTY_FILTERS: FilterState = {
  meals: [],
  neighborhoods: [],
  cuisines: [],
  diningOptions: [],
  moods: [],
  maxPrice: null,
  vegetarianOnly: false,
  shortlist: null,
}

export function applyFilters(entries: Entry[], f: FilterState): Entry[] {
  return entries.filter((e) => {
    if (f.shortlist && !f.shortlist.includes(e.slug)) return false
    if (f.neighborhoods.length && !f.neighborhoods.includes(e.neighborhood)) return false
    if (f.cuisines.length && !f.cuisines.includes(e.cuisine)) return false
    if (f.vegetarianOnly && !e.vegetarianFriendly) return false
    if (f.diningOptions.length && !f.diningOptions.every((d) => e.diningOptions.includes(d))) return false
    if (f.moods.length && !f.moods.every((m) => e.moods.some((claim) => claim.tag === m))) return false

    // Meal and price describe one offer together. A $45 cap on a dinner search has to be
    // met by a dinner, never by the same restaurant's cheaper lunch.
    const asked = f.meals.length ? e.offers.filter((o) => f.meals.includes(o.meal)) : e.offers
    if (f.meals.length && asked.length === 0) return false
    if (f.maxPrice !== null && !asked.some((o) => o.price <= f.maxPrice!)) return false
    return true
  })
}

function bestDelta(e: Entry): number | null {
  const deltas = e.offers.map((o) => o.dealDelta).filter((d): d is number => typeof d === 'number')
  return deltas.length ? Math.max(...deltas) : null
}

function lowestPrice(e: Entry): number | null {
  return e.offers.length ? Math.min(...e.offers.map((o) => o.price)) : null
}

function distanceFrom(origin: Origin | null, e: Entry): number | null {
  if (!origin || typeof e.lat !== 'number' || typeof e.lng !== 'number') return null
  return distanceMeters(origin, { lat: e.lat, lng: e.lng })
}

// A missing key sorts after every present one. It is never treated as zero.
function compareMissingLast(
  a: number | null,
  b: number | null,
  present: (a: number, b: number) => number,
  byName: number,
): number {
  if (a === null && b === null) return byName
  if (a === null) return 1
  if (b === null) return -1
  return present(a, b)
}

export function sortEntries(
  entries: Entry[],
  sort: SortKey,
  origin: Origin | null,
  shortlist: string[] | null = null,
): Entry[] {
  const out = [...entries]
  const byName = (a: Entry, b: Entry) => a.name.localeCompare(b.name)

  if (sort === 'name') return out.sort(byName)
  if (sort === 'shortlist') {
    const rank = new Map((shortlist ?? []).map((slug, i) => [slug, i]))
    return out.sort((a, b) =>
      compareMissingLast(rank.get(a.slug) ?? null, rank.get(b.slug) ?? null, (x, y) => x - y, byName(a, b)),
    )
  }
  if (sort === 'price') {
    return out.sort((a, b) => compareMissingLast(lowestPrice(a), lowestPrice(b), (x, y) => x - y, byName(a, b)))
  }
  if (sort === 'distance') {
    return out.sort((a, b) =>
      compareMissingLast(distanceFrom(origin, a), distanceFrom(origin, b), (x, y) => x - y, byName(a, b)),
    )
  }
  return out.sort((a, b) => compareMissingLast(bestDelta(a), bestDelta(b), (x, y) => y - x, byName(a, b)))
}

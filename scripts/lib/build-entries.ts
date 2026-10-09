import { buildTierStats, dealDelta, tierKey, type ScoredOffer } from '../../src/lib/deal-score.js'
import type { Entry, Meta } from '../../src/lib/entry.js'
import type { Meal, Offer, Restaurant } from '../../src/lib/types.js'
import { isPublishable } from './match-guard.js'
import type { PersonalLayer } from './personal.js'
import type { MenuTagging } from './tagging.js'

export const EVENT_START = '2026-10-16'
export const EVENT_END = '2026-10-25'

export interface ResolvedPlace {
  placeId: string
  formattedAddress: string
  lat: number
  lng: number
}

export interface BuildInputs {
  restaurants: Restaurant[]
  places: Record<string, ResolvedPlace>
  personal: PersonalLayer
  tagged: Record<string, MenuTagging>
}

export interface BuildResult {
  entries: Entry[]
  excludedPersonal: number
  personalWithoutVisits: number
}

// A menu document covers every Restaurant Week offer a restaurant makes, so a count is
// claimed only for the meal the menu attributes it to. A document that attributes
// nothing describes the restaurant's single offer, and nothing beyond it.
export function courseCount(
  tagging: MenuTagging | undefined,
  offers: Offer[],
  meal: Meal,
): number | null {
  if (!tagging) return null
  if (offers.filter((o) => o.meal === meal).length > 1) return null

  const attributed = tagging.courses.filter((c) => c.meal !== null)
  if (attributed.length === 0) return offers.length === 1 ? tagging.courses.length : null
  // A document that names the meal for some sections and not others is telling us it
  // could not tell. Adding the unnamed ones to a meal would claim courses at a price
  // the menu never put them under.
  if (attributed.length !== tagging.courses.length) return null

  const forMeal = attributed.filter((c) => c.meal === meal).length
  return forMeal > 0 ? forMeal : null
}

export function buildEntries({ restaurants, places, personal, tagged }: BuildInputs): BuildResult {
  const taggingFor = (r: Restaurant) => (r.menuId ? tagged[r.menuId] : undefined)

  const allOffers: ScoredOffer[] = restaurants.flatMap((r) =>
    r.offers.map((o) => ({
      meal: o.meal,
      price: o.price,
      courses: courseCount(taggingFor(r), r.offers, o.meal),
    })),
  )
  const stats = buildTierStats(allOffers)

  let excludedPersonal = 0
  let personalWithoutVisits = 0

  const entries = restaurants.map((r): Entry => {
    const tagging = taggingFor(r)
    const place = places[r.slug]
    const candidate = personal[r.slug]
    const mine = candidate && isPublishable(candidate.verification) ? candidate : undefined
    if (candidate && !mine) excludedPersonal += 1
    const firstVisit = mine?.visits[0]
    if (mine && !firstVisit) personalWithoutVisits += 1

    return {
      slug: r.slug,
      name: r.name,
      neighborhood: r.neighborhood,
      cuisine: r.cuisine,
      diningOptions: r.diningOptions,
      openTableUrl: r.openTableUrl,
      websiteUrl: r.websiteUrl,
      offers: r.offers.map((o) => {
        const stat = stats.get(tierKey(o.meal, o.price))
        const courses = courseCount(tagging, r.offers, o.meal)
        return {
          meal: o.meal,
          price: o.price,
          courses,
          dealDelta: dealDelta(courses, stat),
          medianCourses: stat?.medianCourses ?? null,
        }
      }),
      menuCoverage: tagging ? 'full' : 'none',
      moods: tagging?.moods ?? [],
      blurb: tagging?.blurb ?? null,
      vegetarianFriendly:
        tagging?.dietary.vegetarianFriendly?.value ?? r.diningOptions.includes('Vegetarian Options'),
      lat: place?.lat ?? null,
      lng: place?.lng ?? null,
      address: place?.formattedAddress ?? null,
      personal: firstVisit
        ? {
            rating: mine?.rating ?? null,
            yelpUrl: mine?.yelpUrl ?? null,
            excerpt: firstVisit.text.slice(0, 280),
            visitDate: firstVisit.date,
          }
        : null,
    }
  })

  return { entries, excludedPersonal, personalWithoutVisits }
}

export function buildMeta(entries: Entry[], builtAt: Date): Meta {
  return {
    eventStart: EVENT_START,
    eventEnd: EVENT_END,
    builtAt: builtAt.toISOString(),
    restaurants: entries.length,
    withMenus: entries.filter((e) => e.menuCoverage === 'full').length,
    mapped: entries.filter((e) => e.lat !== null).length,
    personal: entries.filter((e) => e.personal !== null).length,
    neighborhoods: new Set(entries.map((e) => e.neighborhood)).size,
    cuisines: new Set(entries.map((e) => e.cuisine)).size,
  }
}

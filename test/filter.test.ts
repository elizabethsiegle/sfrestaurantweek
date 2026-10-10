import { describe, expect, it } from 'vitest'
import { applyFilters, EMPTY_FILTERS, sortEntries } from '../src/lib/filter.js'
import type { Entry } from '../src/lib/entry.js'

const make = (over: Partial<Entry>): Entry => ({
  slug: 'x', name: 'X', neighborhood: 'Mission', cuisine: 'Italian',
  diningOptions: ['Indoor Dining'], openTableUrl: null, websiteUrl: null,
  offers: [{ meal: 'Dinner', price: 75, courses: 3, dealDelta: 0, medianCourses: 3 }],
  menuCoverage: 'full', moods: [], blurb: null, vegetarianFriendly: false,
  lat: null, lng: null, address: null, personal: null, ...over,
})

const unscoredOffer = { meal: 'Dinner' as const, price: 75, courses: null, dealDelta: null, medianCourses: null }
const scoredOffer = (dealDelta: number) => ({ meal: 'Dinner' as const, price: 75, courses: 3, dealDelta, medianCourses: 3 })

describe('applyFilters', () => {
  const entries = [
    make({ slug: 'a', neighborhood: 'Mission', offers: [{ meal: 'Lunch', price: 25, courses: 3, dealDelta: 0, medianCourses: 3 }] }),
    make({ slug: 'b', neighborhood: 'Marina', cuisine: 'Japanese', moods: [{ tag: 'date-night', evidence: 'shared plates' }] }),
    make({ slug: 'c', vegetarianFriendly: true }),
  ]

  it('returns everything when nothing is selected', () => {
    expect(applyFilters(entries, EMPTY_FILTERS)).toHaveLength(3)
  })

  it('filters by neighborhood', () => {
    expect(applyFilters(entries, { ...EMPTY_FILTERS, neighborhoods: ['Marina'] }).map((e) => e.slug)).toEqual(['b'])
  })

  it('filters by meal', () => {
    expect(applyFilters(entries, { ...EMPTY_FILTERS, meals: ['Lunch'] }).map((e) => e.slug)).toEqual(['a'])
  })

  it('filters by maximum price across any offer', () => {
    expect(applyFilters(entries, { ...EMPTY_FILTERS, maxPrice: 30 }).map((e) => e.slug)).toEqual(['a'])
  })

  it('filters by mood tag', () => {
    expect(applyFilters(entries, { ...EMPTY_FILTERS, moods: ['date-night'] }).map((e) => e.slug)).toEqual(['b'])
  })

  it('filters by vegetarian friendliness', () => {
    expect(applyFilters(entries, { ...EMPTY_FILTERS, vegetarianOnly: true }).map((e) => e.slug)).toEqual(['c'])
  })

  it('combines filters with AND and can return nothing', () => {
    expect(applyFilters(entries, { ...EMPTY_FILTERS, neighborhoods: ['Marina'], meals: ['Lunch'] })).toEqual([])
  })

  it('narrows with AND across categories and does not fall back to everything', () => {
    const matching = applyFilters(entries, { ...EMPTY_FILTERS, neighborhoods: ['Marina'], cuisines: ['Japanese'], moods: ['date-night'] })
    expect(matching.map((e) => e.slug)).toEqual(['b'])
    const none = applyFilters(entries, { ...EMPTY_FILTERS, neighborhoods: ['Marina'], vegetarianOnly: true })
    expect(none).toEqual([])
  })

  it('restricts to a shortlist, and an empty shortlist matches nothing', () => {
    expect(applyFilters(entries, { ...EMPTY_FILTERS, shortlist: ['c', 'a'] }).map((e) => e.slug)).toEqual(['a', 'c'])
    expect(applyFilters(entries, { ...EMPTY_FILTERS, shortlist: [] })).toEqual([])
  })

  it('requires every selected dining option (AND within the category)', () => {
    const list = [
      make({ slug: 'both', diningOptions: ['Indoor Dining', 'Outdoor Dining'] }),
      make({ slug: 'indoor', diningOptions: ['Indoor Dining'] }),
    ]
    const result = applyFilters(list, { ...EMPTY_FILTERS, diningOptions: ['Indoor Dining', 'Outdoor Dining'] })
    expect(result.map((e) => e.slug)).toEqual(['both'])
  })

  it('requires every selected mood (AND within the category)', () => {
    const list = [
      make({ slug: 'both', moods: [{ tag: 'date-night', evidence: 'x' }, { tag: 'celebration', evidence: 'y' }] }),
      make({ slug: 'one', moods: [{ tag: 'date-night', evidence: 'x' }] }),
    ]
    const result = applyFilters(list, { ...EMPTY_FILTERS, moods: ['date-night', 'celebration'] })
    expect(result.map((e) => e.slug)).toEqual(['both'])
  })

  it('accepts any selected neighborhood (OR within the category)', () => {
    const list = [
      make({ slug: 'm', neighborhood: 'Mission' }),
      make({ slug: 'r', neighborhood: 'Marina' }),
      make({ slug: 'n', neighborhood: 'Nob Hill' }),
    ]
    const result = applyFilters(list, { ...EMPTY_FILTERS, neighborhoods: ['Mission', 'Marina'] })
    expect(result.map((e) => e.slug)).toEqual(['m', 'r'])
  })

  it('treats a maximum price of 0 as a real limit, not as unset', () => {
    expect(applyFilters(entries, { ...EMPTY_FILTERS, maxPrice: 0 })).toEqual([])
  })

  it('applies the price cap to the chosen meal, not to a cheaper offer at another meal', () => {
    const list = [
      make({
        slug: 'cheap-lunch-only',
        offers: [
          { meal: 'Lunch', price: 25, courses: null, dealDelta: null, medianCourses: null },
          { meal: 'Dinner', price: 75, courses: null, dealDelta: null, medianCourses: null },
        ],
      }),
      make({
        slug: 'cheap-dinner',
        offers: [
          { meal: 'Lunch', price: 25, courses: null, dealDelta: null, medianCourses: null },
          { meal: 'Dinner', price: 45, courses: null, dealDelta: null, medianCourses: null },
        ],
      }),
    ]
    const result = applyFilters(list, { ...EMPTY_FILTERS, meals: ['Dinner'], maxPrice: 45 })
    expect(result.map((e) => e.slug)).toEqual(['cheap-dinner'])
  })

  it('still caps on any offer when no meal is chosen', () => {
    const list = [
      make({
        slug: 'cheap-lunch-only',
        offers: [
          { meal: 'Lunch', price: 25, courses: null, dealDelta: null, medianCourses: null },
          { meal: 'Dinner', price: 75, courses: null, dealDelta: null, medianCourses: null },
        ],
      }),
    ]
    expect(applyFilters(list, { ...EMPTY_FILTERS, maxPrice: 45 }).map((e) => e.slug)).toEqual(['cheap-lunch-only'])
  })

  it('matches a price tier exactly, so a cheaper menu is not listed under a dearer band', () => {
    const list = [
      make({
        slug: 'lunch-45-dinner-60',
        offers: [
          { meal: 'Lunch', price: 45, courses: null, dealDelta: null, medianCourses: null },
          { meal: 'Dinner', price: 60, courses: null, dealDelta: null, medianCourses: null },
        ],
      }),
      make({
        slug: 'dinner-90',
        offers: [{ meal: 'Dinner', price: 90, courses: null, dealDelta: null, medianCourses: null }],
      }),
    ]
    expect(applyFilters(list, { ...EMPTY_FILTERS, priceTier: 90 }).map((e) => e.slug)).toEqual(['dinner-90'])
    expect(applyFilters(list, { ...EMPTY_FILTERS, priceTier: 60 }).map((e) => e.slug)).toEqual([
      'lunch-45-dinner-60',
    ])
  })

  it('reads a tier against the chosen meal only', () => {
    const list = [
      make({
        slug: 'lunch-45-dinner-90',
        offers: [
          { meal: 'Lunch', price: 45, courses: null, dealDelta: null, medianCourses: null },
          { meal: 'Dinner', price: 90, courses: null, dealDelta: null, medianCourses: null },
        ],
      }),
    ]
    expect(applyFilters(list, { ...EMPTY_FILTERS, meals: ['Lunch'], priceTier: 90 })).toEqual([])
    expect(applyFilters(list, { ...EMPTY_FILTERS, meals: ['Dinner'], priceTier: 90 })).toHaveLength(1)
  })

  it('keeps a restaurant whose only offer at the chosen meal is inside the cap', () => {
    const list = [
      make({ slug: 'brunch-only', offers: [{ meal: 'Brunch', price: 30, courses: null, dealDelta: null, medianCourses: null }] }),
    ]
    expect(applyFilters(list, { ...EMPTY_FILTERS, meals: ['Brunch', 'Dinner'], maxPrice: 45 })).toHaveLength(1)
  })
})

describe('sortEntries', () => {
  it('ranks a better value above the tier median first', () => {
    const entries = [
      make({ slug: 'par', offers: [{ meal: 'Dinner', price: 75, courses: 3, dealDelta: 0, medianCourses: 3 }] }),
      make({ slug: 'good', offers: [{ meal: 'Dinner', price: 75, courses: 5, dealDelta: 2, medianCourses: 3 }] }),
    ]
    expect(sortEntries(entries, 'value', null).map((e) => e.slug)).toEqual(['good', 'par'])
  })

  it('sorts unscored restaurants last rather than treating them as poor value', () => {
    const entries = [
      make({ slug: 'unscored', menuCoverage: 'none', offers: [{ meal: 'Dinner', price: 75, courses: null, dealDelta: null, medianCourses: null }] }),
      make({ slug: 'par', offers: [{ meal: 'Dinner', price: 75, courses: 3, dealDelta: 0, medianCourses: 3 }] }),
    ]
    expect(sortEntries(entries, 'value', null).map((e) => e.slug)).toEqual(['par', 'unscored'])
  })

  it('places every unscored entry after every scored one, including negative scores', () => {
    const entries = [
      make({ slug: 'u1', name: 'Zed', offers: [unscoredOffer] }),
      make({ slug: 'neg', offers: [scoredOffer(-2)] }),
      make({ slug: 'u2', name: 'Abe', offers: [unscoredOffer] }),
      make({ slug: 'top', offers: [scoredOffer(3)] }),
      make({ slug: 'u3', name: 'Moe', offers: [] }),
      make({ slug: 'par', offers: [scoredOffer(0)] }),
    ]
    expect(sortEntries(entries, 'value', null).map((e) => e.slug)).toEqual(['top', 'par', 'neg', 'u2', 'u3', 'u1'])
  })

  it('scores an entry by its best offer when only some offers are scored', () => {
    const entries = [
      make({ slug: 'none', offers: [unscoredOffer] }),
      make({ slug: 'mixed', offers: [unscoredOffer, scoredOffer(1)] }),
    ]
    expect(sortEntries(entries, 'value', null).map((e) => e.slug)).toEqual(['mixed', 'none'])
  })

  it('sorts by distance when an origin is known, putting unmapped last', () => {
    const entries = [
      make({ slug: 'far', lat: 37.81, lng: -122.41 }),
      make({ slug: 'unmapped' }),
      make({ slug: 'near', lat: 37.7751, lng: -122.4194 }),
    ]
    const sorted = sortEntries(entries, 'distance', { lat: 37.7749, lng: -122.4194 })
    expect(sorted.map((e) => e.slug)).toEqual(['near', 'far', 'unmapped'])
  })

  it('falls back to name order when an origin is set but no entry has coordinates', () => {
    const entries = [
      make({ slug: 'c', name: 'Cotogna' }),
      make({ slug: 'a', name: 'Anchor' }),
      make({ slug: 'b', name: 'Bar Crudo' }),
    ]
    const sorted = sortEntries(entries, 'distance', { lat: 37.7749, lng: -122.4194 })
    expect(sorted.map((e) => e.slug)).toEqual(['a', 'b', 'c'])
  })

  it('falls back to name order for distance when there is no origin', () => {
    const entries = [
      make({ slug: 'b', name: 'Bar Crudo', lat: 37.8, lng: -122.4 }),
      make({ slug: 'a', name: 'Anchor', lat: 37.7, lng: -122.5 }),
    ]
    expect(sortEntries(entries, 'distance', null).map((e) => e.slug)).toEqual(['a', 'b'])
  })

  it('puts an unmapped entry last even when the origin is near (0,0)', () => {
    const entries = [
      make({ slug: 'unmapped', name: 'Aardvark' }),
      make({ slug: 'sf', name: 'Zuni', lat: 37.7749, lng: -122.4194 }),
    ]
    const sorted = sortEntries(entries, 'distance', { lat: 0.01, lng: 0.01 })
    expect(sorted.map((e) => e.slug)).toEqual(['sf', 'unmapped'])
  })

  it('treats an entry with only one coordinate as unmapped', () => {
    const entries = [
      make({ slug: 'latOnly', name: 'Aardvark', lat: 37.7749 }),
      make({ slug: 'lngOnly', name: 'Bistro', lng: -122.4194 }),
      make({ slug: 'mapped', name: 'Zuni', lat: 37.8, lng: -122.4 }),
    ]
    const sorted = sortEntries(entries, 'distance', { lat: 37.7749, lng: -122.4194 })
    expect(sorted.map((e) => e.slug)).toEqual(['mapped', 'latOnly', 'lngOnly'])
  })

  it('sorts entries with no offers after priced ones, in name order', () => {
    const entries = [
      make({ slug: 'noneB', name: 'Bravo', offers: [] }),
      make({ slug: 'priced', name: 'Zulu', offers: [scoredOffer(0)] }),
      make({ slug: 'noneA', name: 'Alpha', offers: [] }),
    ]
    expect(sortEntries(entries, 'price', null).map((e) => e.slug)).toEqual(['priced', 'noneA', 'noneB'])
  })

  it('treats a coordinate or score key that is absent, not null, as missing', () => {
    const noLat = make({ slug: 'noLat', name: 'Aardvark' }) as Partial<Entry>
    delete noLat.lat
    const noDelta = make({ slug: 'noDelta', name: 'Aardvark' })
    delete (noDelta.offers[0] as Partial<Entry['offers'][number]>).dealDelta
    const mapped = make({ slug: 'mapped', name: 'Zuni', lat: 37.8, lng: -122.4, offers: [scoredOffer(1)] })

    const byDistance = sortEntries([noLat as Entry, mapped], 'distance', { lat: 37.7749, lng: -122.4194 })
    expect(byDistance.map((e) => e.slug)).toEqual(['mapped', 'noLat'])
    const byValue = sortEntries([noDelta, mapped], 'value', null)
    expect(byValue.map((e) => e.slug)).toEqual(['mapped', 'noDelta'])
  })

  it('sorts by lowest price and by name', () => {
    const entries = [
      make({ slug: 'dear', name: 'A', offers: [{ meal: 'Dinner', price: 90, courses: 3, dealDelta: 0, medianCourses: 3 }] }),
      make({ slug: 'cheap', name: 'B', offers: [{ meal: 'Dinner', price: 90, courses: 3, dealDelta: 0, medianCourses: 3 }, { meal: 'Lunch', price: 30, courses: 2, dealDelta: 0, medianCourses: 2 }] }),
    ]
    expect(sortEntries(entries, 'price', null).map((e) => e.slug)).toEqual(['cheap', 'dear'])
    expect(sortEntries(entries, 'name', null).map((e) => e.slug)).toEqual(['dear', 'cheap'])
  })

  it("keeps the model's ranking, which is neither alphabetical nor best value", () => {
    const entries = [
      make({ slug: 'abaca', name: 'Abaca', offers: [scoredOffer(1)] }),
      make({ slug: 'bar-crudo', name: 'Bar Crudo', offers: [scoredOffer(3)] }),
      make({ slug: 'cotogna', name: 'Cotogna', offers: [scoredOffer(0)] }),
    ]
    const picks = ['cotogna', 'abaca', 'bar-crudo']

    expect(sortEntries(entries, 'shortlist', null, picks).map((e) => e.slug)).toEqual(picks)
    expect(sortEntries(entries, 'value', null).map((e) => e.slug)).toEqual(['bar-crudo', 'abaca', 'cotogna'])
    expect(sortEntries(entries, 'name', null).map((e) => e.slug)).toEqual(['abaca', 'bar-crudo', 'cotogna'])
  })

  it('puts an entry the shortlist does not name after every pick, in name order', () => {
    const entries = [
      make({ slug: 'walk-in', name: 'Zuni' }),
      make({ slug: 'second', name: 'Cotogna' }),
      make({ slug: 'other', name: 'Abaca' }),
      make({ slug: 'first', name: 'Bar Crudo' }),
    ]
    const sorted = sortEntries(entries, 'shortlist', null, ['first', 'second'])
    expect(sorted.map((e) => e.slug)).toEqual(['first', 'second', 'other', 'walk-in'])
  })

  it('falls back to name order when the shortlist sort has no shortlist', () => {
    const entries = [make({ slug: 'z', name: 'Zuni' }), make({ slug: 'a', name: 'Abaca' })]
    expect(sortEntries(entries, 'shortlist', null).map((e) => e.slug)).toEqual(['a', 'z'])
  })

  it('returns a new array and leaves the input order untouched for every sort key', () => {
    const entries = [
      make({ slug: 'b', name: 'B', lat: 37.8, lng: -122.4, offers: [scoredOffer(1)] }),
      make({ slug: 'a', name: 'A', lat: 37.7, lng: -122.5, offers: [scoredOffer(2)] }),
    ]
    for (const key of ['value', 'price', 'name', 'distance'] as const) {
      const sorted = sortEntries(entries, key, { lat: 37.7, lng: -122.5 })
      expect(sorted).not.toBe(entries)
      expect(entries.map((e) => e.slug)).toEqual(['b', 'a'])
    }
  })
})

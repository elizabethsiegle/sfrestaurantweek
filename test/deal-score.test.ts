import { describe, expect, it } from 'vitest'
import { buildTierStats, dealDelta, median, MIN_TIER_SAMPLE, tierKey } from '../src/lib/deal-score.js'
import { buildEntries, buildMeta, type BuildInputs } from '../scripts/lib/build-entries.js'
import type { Verification } from '../scripts/lib/match-guard.js'
import type { MenuTagging } from '../scripts/lib/tagging.js'
import type { Course } from '../src/lib/entry.js'
import type { Meal, Offer, Restaurant } from '../src/lib/types.js'

const offer = (price: number, courses: number | null) => ({ meal: 'Lunch' as const, price, courses })

describe('median', () => {
  it('returns the middle value for an odd count', () => {
    expect(median([3, 1, 2])).toBe(2)
  })

  it('averages the two middles for an even count', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })
})

describe('buildTierStats', () => {
  it('reports a median once the tier has enough offers', () => {
    const stats = buildTierStats([
      offer(45, 3), offer(45, 3), offer(45, 3), offer(45, 4), offer(45, 4),
    ])
    const tier = stats.get(tierKey('Lunch', 45))!
    expect(tier.sampleSize).toBe(5)
    expect(tier.medianCourses).toBe(3)
  })

  it('withholds the median when the tier is too thin to compare', () => {
    const stats = buildTierStats([offer(15, 2), offer(15, 3)])
    const tier = stats.get(tierKey('Lunch', 15))!
    expect(tier.sampleSize).toBe(2)
    expect(tier.medianCourses).toBeNull()
  })

  it('ignores offers with no course count when computing the median', () => {
    const stats = buildTierStats([
      offer(45, 3), offer(45, 3), offer(45, 3), offer(45, 9), offer(45, 9), offer(45, null),
    ])
    expect(stats.get(tierKey('Lunch', 45))!.sampleSize).toBe(5)
  })

  it('does not drag the median down by counting a missing menu as zero courses', () => {
    const stats = buildTierStats([
      offer(45, 3), offer(45, 3), offer(45, 3), offer(45, 3), offer(45, 3),
      offer(45, null), offer(45, null), offer(45, null), offer(45, null),
    ])
    expect(stats.get(tierKey('Lunch', 45))!.medianCourses).toBe(3)
  })
})

describe('buildTierStats threshold', () => {
  it('compares MIN_TIER_SAMPLE to the non-null course count, not the offer count', () => {
    const stats = buildTierStats([offer(45, 3), offer(45, 3), offer(45, 3), offer(45, null), offer(45, null)])
    const tier = stats.get(tierKey('Lunch', 45))!
    expect(tier.sampleSize).toBe(3)
    expect(tier.medianCourses).toBeNull()
  })
})

describe('dealDelta', () => {
  const stat = { meal: 'Lunch' as const, price: 45, medianCourses: 3, sampleSize: 8 }

  it('scores an extra course above the median as positive', () => {
    expect(dealDelta(4, stat)).toBe(1)
  })

  it('returns null for a restaurant with no menu rather than scoring it zero', () => {
    expect(dealDelta(null, stat)).toBeNull()
  })

  it('returns null when the tier withheld its median', () => {
    expect(dealDelta(4, { ...stat, medianCourses: null, sampleSize: 2 })).toBeNull()
  })

  it('exposes the agreed minimum sample size', () => {
    expect(MIN_TIER_SAMPLE).toBe(5)
  })
})

const restaurant = (slug: string, menuId: string | null, offers: Offer[] = [{ meal: 'Lunch', price: 45 }]): Restaurant => ({
  slug,
  name: slug,
  neighborhood: 'Mission',
  cuisine: 'Italian',
  diningOptions: [],
  offers,
  menuId,
  openTableUrl: null,
  websiteUrl: null,
})

const sections = (meal: Meal | null, count: number): Course[] =>
  Array.from({ length: count }, (_, i) => ({ name: `${meal ?? 'Unmarked'} ${i + 1}`, meal, dishes: [] }))

const taggingOf = (courses: Course[]): MenuTagging => ({
  courses,
  moods: [],
  dietary: {},
  blurb: 'A blurb.',
})

const tagging = (courseCount: number): MenuTagging => taggingOf(sections(null, courseCount))

const personalFor = (verification: Verification) => ({
  rating: 4,
  yelpUrl: 'https://www.yelp.com/biz/x',
  verification,
  visits: [{ date: '2025-06-16T05:54:12+00:00', rating: 4, text: 'Great meal.' }],
  photos: [],
})

const inputs = (overrides: Partial<BuildInputs> = {}): BuildInputs => ({
  restaurants: [restaurant('a', 'm1')],
  places: {},
  personal: {},
  tagged: {},
  ...overrides,
})

describe('buildEntries with no menu', () => {
  it('leaves dealDelta null and courses null, never zero', () => {
    const rs = Array.from({ length: 6 }, (_, i) => restaurant(`r${i}`, null))
    const { entries } = buildEntries(inputs({ restaurants: rs }))
    for (const e of entries) {
      expect(e.offers[0]!.courses).toBeNull()
      expect(e.offers[0]!.dealDelta).toBeNull()
      expect(e.offers[0]!.medianCourses).toBeNull()
    }
  })

  it('scores tagged restaurants and leaves an untagged one null in the same tier', () => {
    const rs = [
      restaurant('t1', 'm1'), restaurant('t2', 'm2'), restaurant('t3', 'm3'),
      restaurant('t4', 'm4'), restaurant('t5', 'm5'), restaurant('untagged', null),
    ]
    const tagged = { m1: tagging(3), m2: tagging(3), m3: tagging(3), m4: tagging(3), m5: tagging(4) }
    const { entries } = buildEntries(inputs({ restaurants: rs, tagged }))
    const bySlug = Object.fromEntries(entries.map((e) => [e.slug, e.offers[0]!]))
    expect(bySlug.untagged).toMatchObject({ courses: null, dealDelta: null, medianCourses: 3 })
    expect(bySlug.t5).toMatchObject({ courses: 4, dealDelta: 1, medianCourses: 3 })
    expect(bySlug.t1).toMatchObject({ courses: 3, dealDelta: 0, medianCourses: 3 })
  })

  it('reports menuCoverage none until tagging produced courses', () => {
    const { entries } = buildEntries(inputs())
    expect(entries[0]!.menuCoverage).toBe('none')
  })

  it('reports menuCoverage full when tagging exists', () => {
    const { entries } = buildEntries(inputs({ tagged: { m1: tagging(3) } }))
    expect(entries[0]!.menuCoverage).toBe('full')
  })
})

describe('buildEntries with one document covering two meals', () => {
  const lunchAndDinner: Offer[] = [{ meal: 'Lunch', price: 45 }, { meal: 'Dinner', price: 75 }]
  const twoMenus = taggingOf([...sections('Lunch', 3), ...sections('Dinner', 5)])

  const offersOf = (r: Restaurant, tagged: Record<string, MenuTagging>) => {
    const { entries } = buildEntries(inputs({ restaurants: [r], tagged }))
    return Object.fromEntries(entries[0]!.offers.map((o) => [`${o.meal} $${o.price}`, o.courses]))
  }

  it('counts each meal from its own sections and lets neither leak into the other', () => {
    const counts = offersOf(restaurant('a', 'm1', lunchAndDinner), { m1: twoMenus })
    expect(counts).toEqual({ 'Lunch $45': 3, 'Dinner $75': 5 })
  })

  it('withholds a count for a meal the document names no section for', () => {
    const withBrunch: Offer[] = [...lunchAndDinner, { meal: 'Brunch', price: 30 }]
    const counts = offersOf(restaurant('a', 'm1', withBrunch), { m1: twoMenus })
    expect(counts['Brunch $30']).toBeNull()
  })

  it('keeps the $45 lunch median off the dinner sections in the same document', () => {
    const rs = [
      restaurant('two-menus', 'm0', lunchAndDinner),
      restaurant('t1', 'm1'), restaurant('t2', 'm2'), restaurant('t3', 'm3'), restaurant('t4', 'm4'),
    ]
    const tagged = { m0: twoMenus, m1: tagging(3), m2: tagging(3), m3: tagging(5), m4: tagging(5) }
    const { entries } = buildEntries(inputs({ restaurants: rs, tagged }))
    const lunch = entries.flatMap((e) => e.offers).filter((o) => o.meal === 'Lunch' && o.price === 45)
    expect(lunch.map((o) => o.courses)).toEqual([3, 3, 3, 5, 5])
    expect(lunch.every((o) => o.medianCourses === 3)).toBe(true)
  })

  it('withholds every count when the document attributes nothing and the restaurant offers two meals', () => {
    const counts = offersOf(restaurant('a', 'm1', lunchAndDinner), { m1: tagging(8) })
    expect(counts).toEqual({ 'Lunch $45': null, 'Dinner $75': null })
  })

  it('withholds the count when two offers share a meal at different prices', () => {
    const twoDinners: Offer[] = [{ meal: 'Dinner', price: 60 }, { meal: 'Dinner', price: 90 }]
    const counts = offersOf(restaurant('a', 'm1', twoDinners), { m1: taggingOf(sections('Dinner', 4)) })
    expect(counts).toEqual({ 'Dinner $60': null, 'Dinner $90': null })
  })

  it('withholds every count when the document names the meal for only some sections', () => {
    const mixed = taggingOf([...sections('Dinner', 3), ...sections(null, 1)])
    const counts = offersOf(restaurant('a', 'm1', lunchAndDinner), { m1: mixed })
    expect(counts).toEqual({ 'Lunch $45': null, 'Dinner $75': null })
  })

  it('withholds the count on a single offer too when the document is only part attributed', () => {
    const mixed = taggingOf([...sections('Lunch', 3), ...sections(null, 1)])
    const counts = offersOf(restaurant('a', 'm1'), { m1: mixed })
    expect(counts).toEqual({ 'Lunch $45': null })
  })

  it('reads an unattributed document as the single offer it describes', () => {
    const counts = offersOf(restaurant('a', 'm1'), { m1: tagging(3) })
    expect(counts).toEqual({ 'Lunch $45': 3 })
  })
})

describe('buildEntries personal publication gate', () => {
  const labels: Verification[] = [
    'city checked',
    'name only',
    'name and city only, export coordinate unreliable',
    'name only, export coordinate unreliable',
  ]

  for (const label of labels) {
    it(`excludes a personal entry labelled "${label}"`, () => {
      const result = buildEntries(inputs({ personal: { a: personalFor(label) } }))
      expect(result.entries[0]!.personal).toBeNull()
      expect(result.excludedPersonal).toBe(1)
    })
  }

  it('includes a personal entry labelled "distance checked"', () => {
    const result = buildEntries(inputs({ personal: { a: personalFor('distance checked') } }))
    expect(result.entries[0]!.personal).toMatchObject({ rating: 4, visitDate: '2025-06-16T05:54:12+00:00' })
    expect(result.excludedPersonal).toBe(0)
  })
})

describe('buildEntries personal accounting', () => {
  it('counts a distance checked entry with no visits instead of dropping it', () => {
    const empty = { ...personalFor('distance checked'), visits: [] }
    const rs = [restaurant('a', null), restaurant('b', null), restaurant('c', null)]
    const personal = { a: empty, b: personalFor('distance checked'), c: personalFor('name only') }
    const result = buildEntries(inputs({ restaurants: rs, personal }))
    expect(result.entries.filter((e) => e.personal !== null)).toHaveLength(1)
    expect(result.excludedPersonal).toBe(1)
    expect(result.personalWithoutVisits).toBe(1)
  })
})

describe('buildMeta', () => {
  it('counts what was emitted, not what was read', () => {
    const rs = [restaurant('a', 'm1'), restaurant('b', null), restaurant('c', null)]
    const personal = {
      a: personalFor('city checked'),
      b: personalFor('name only'),
      c: personalFor('name and city only, export coordinate unreliable'),
    }
    const { entries } = buildEntries(inputs({ restaurants: rs, personal }))
    const meta = buildMeta(entries, new Date('2026-10-08T00:00:00Z'))
    expect(Object.keys(personal)).toHaveLength(3)
    expect(meta.personal).toBe(0)
    expect(meta.restaurants).toBe(3)
    expect(meta.withMenus).toBe(0)
    expect(meta.mapped).toBe(0)
  })
})

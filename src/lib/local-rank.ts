import type { Entry } from './entry.js'
import { MOOD_LABELS, type MoodTag } from './moods.js'
import type { Meal } from './types.js'

export interface Pick {
  slug: string
  reason: string
}

const STOP = new Set([
  'a', 'an', 'the', 'for', 'with', 'and', 'in', 'on', 'near', 'me', 'to', 'at', 'of', 'or', 'is', 'are',
  'somewhere', 'something', 'anywhere', 'people', 'person', 'want', 'need', 'looking', 'find', 'some',
  'good', 'nice', 'great', 'best', 'please', 'restaurant', 'restaurants', 'dining', 'food', 'eat',
  'under', 'below', 'over', 'less', 'than', 'max', 'within', 'dollars', 'dollar', 'bucks',
  'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'our', 'we', 'you', 'can', 'get',
])

const MEAL_WORDS: Record<string, Meal> = { dinner: 'Dinner', lunch: 'Lunch', brunch: 'Brunch' }
const CHEAP_WORDS = new Set(['cheap', 'cheaper', 'cheapest', 'budget', 'affordable', 'inexpensive'])
const CHEAP_LIMIT = 35

interface Alias {
  cuisines?: string[]
  text?: string
  mood?: MoodTag
}

const ALIASES: Record<string, Alias> = {
  pasta: { cuisines: ['Italian'] },
  sushi: { cuisines: ['Japanese'] },
  ramen: { cuisines: ['Japanese'] },
  taco: { cuisines: ['Mexican'] },
  burrito: { cuisines: ['Mexican'] },
  steak: { cuisines: ['Steakhouse'] },
  curry: { cuisines: ['Indian'] },
  dumpling: { cuisines: ['Chinese'] },
  pho: { cuisines: ['Vietnamese'] },
  fish: { cuisines: ['Seafood'] },
  oyster: { cuisines: ['Seafood'] },
  crab: { cuisines: ['Seafood'] },
  patio: { text: 'outdoor' },
  outside: { text: 'outdoor' },
  veggie: { text: 'vegetarian', mood: 'vegetarian-friendly' },
  vegan: { text: 'vegetarian', mood: 'vegetarian-friendly' },
  vegetarian: { mood: 'vegetarian-friendly' },
  warm: { mood: 'comfort-food' },
  cozy: { mood: 'comfort-food' },
  comfort: { mood: 'comfort-food' },
  hearty: { mood: 'comfort-food' },
  date: { mood: 'date-night' },
  romantic: { mood: 'date-night' },
  anniversary: { mood: 'date-night' },
  group: { mood: 'big-group' },
  party: { mood: 'big-group' },
  friends: { mood: 'big-group' },
  family: { mood: 'big-group' },
  solo: { mood: 'solo-friendly' },
  alone: { mood: 'solo-friendly' },
  business: { mood: 'business-dinner' },
  client: { mood: 'business-dinner' },
  celebrate: { mood: 'celebration' },
  celebration: { mood: 'celebration' },
  birthday: { mood: 'celebration' },
  light: { mood: 'light-and-fresh' },
  fresh: { mood: 'light-and-fresh' },
  healthy: { mood: 'light-and-fresh' },
  adventurous: { mood: 'adventurous' },
  unusual: { mood: 'adventurous' },
  theater: { mood: 'pre-theater' },
  theatre: { mood: 'pre-theater' },
  opera: { mood: 'pre-theater' },
  symphony: { mood: 'pre-theater' },
}

interface ParsedQuery {
  tokens: string[]
  meals: Meal[]
  budget: number | null
}

const BUDGET_PATTERNS = [
  /\b(?:under|below|less than|up to|max(?:imum)?|within)\s*\$?\s*(\d{1,3})\b/,
  /\$\s*(\d{1,3})\b/,
]

function parse(query: string): ParsedQuery {
  let text = query.toLowerCase()
  let budget: number | null = null
  for (const pattern of BUDGET_PATTERNS) {
    const found = pattern.exec(text)
    if (found) {
      budget = Number(found[1])
      text = text.replace(pattern, ' ')
      break
    }
  }

  const meals: Meal[] = []
  const tokens: string[] = []
  for (const word of text.split(/[^a-z0-9]+/)) {
    if (CHEAP_WORDS.has(word)) {
      budget = Math.min(budget ?? CHEAP_LIMIT, CHEAP_LIMIT)
    } else if (Object.hasOwn(MEAL_WORDS, word)) {
      const meal = MEAL_WORDS[word]!
      if (!meals.includes(meal)) meals.push(meal)
    } else if (word.length > 2 && !STOP.has(word) && !/^\d+$/.test(word)) {
      tokens.push(word)
    }
  }
  return { tokens, meals, budget }
}

function stems(term: string): string[] {
  return term.length > 3 && term.endsWith('s') ? [term, term.slice(0, -1)] : [term]
}

function hasWord(text: string, term: string): boolean {
  return stems(term).some((stem) => new RegExp(`\\b${stem}`).test(text))
}

const normalize = (text: string) => text.toLowerCase().replace(/-/g, ' ')

interface Hit {
  weight: number
  reason: string
}

function textHits(e: Entry, term: string): Hit[] {
  const hits: Hit[] = []
  const alias = stems(term).map((s) => (Object.hasOwn(ALIASES, s) ? ALIASES[s] : undefined)).find(Boolean)
  const searched = alias?.text ?? term

  if (hasWord(normalize(e.cuisine), searched) || alias?.cuisines?.some((c) => normalize(e.cuisine).includes(normalize(c)))) {
    hits.push({ weight: 3, reason: `${e.cuisine} cuisine` })
  }
  if (hasWord(normalize(e.neighborhood), searched)) hits.push({ weight: 3, reason: `in ${e.neighborhood}` })
  if (hasWord(normalize(e.name), searched)) hits.push({ weight: 2, reason: `name matches ${term}` })

  for (const claim of e.moods) {
    const byTag = alias?.mood === claim.tag
    if (byTag || hasWord(normalize(`${claim.tag} ${claim.evidence}`), searched)) {
      hits.push({ weight: 2, reason: `${Object.hasOwn(MOOD_LABELS, claim.tag) ? MOOD_LABELS[claim.tag] : claim.tag}:${claim.evidence}` })
    }
  }
  if (e.blurb && hasWord(normalize(e.blurb), searched)) hits.push({ weight: 1, reason: `menu mentions ${term}` })

  const option = e.diningOptions.find((o) => hasWord(normalize(o), searched))
  if (option) hits.push({ weight: 1, reason: option })
  if (e.vegetarianFriendly && (searched === 'vegetarian' || alias?.mood === 'vegetarian-friendly')) {
    hits.push({ weight: 2, reason: 'vegetarian friendly' })
  }
  return hits
}

function relevantOffers(e: Entry, meals: Meal[]) {
  return meals.length ? e.offers.filter((o) => meals.includes(o.meal)) : e.offers
}

function lowestPrice(e: Entry, meals: Meal[]): number | null {
  const prices = relevantOffers(e, meals).map((o) => o.price)
  return prices.length ? Math.min(...prices) : null
}

function sentence(parts: string[]): string {
  const text = parts.join(', ')
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`
}

export function localRank(entries: Entry[], query: string, limit: number): Pick[] {
  const { tokens, meals, budget } = parse(query)
  const hasConstraint = meals.length > 0 || budget !== null
  if (!tokens.length && !hasConstraint) return []

  const candidates = entries
    .map((entry) => ({ entry, price: lowestPrice(entry, meals) }))
    .filter(({ entry, price }) => {
      if (meals.length && !relevantOffers(entry, meals).length) return false
      return budget === null || (price !== null && price <= budget)
    })

  const scored = candidates.map((c) => {
    const reasons = new Map<string, number>()
    for (const term of tokens) {
      for (const hit of textHits(c.entry, term)) reasons.set(hit.reason, (reasons.get(hit.reason) ?? 0) + hit.weight)
    }
    const score = [...reasons.values()].reduce((sum, w) => sum + w, 0)
    return { ...c, reasons, score }
  })

  const hasText = tokens.length > 0
  if (hasText && !scored.some((s) => s.score > 0)) return []
  const pool = hasText ? scored.filter((s) => s.score > 0) : scored

  pool.sort(
    (a, b) =>
      b.score - a.score ||
      (hasConstraint ? (a.price ?? Infinity) - (b.price ?? Infinity) : 0) ||
      a.entry.name.localeCompare(b.entry.name),
  )

  return pool.slice(0, limit).map((s) => {
    const parts = [...s.reasons.entries()].sort((a, b) => b[1] - a[1]).map(([reason]) => reason).slice(0, 2)
    if (hasConstraint && s.price !== null) {
      const meal = meals.map((m) => m.toLowerCase()).join(' or ')
      parts.push(`${meal ? `${meal} ` : ''}from $${s.price}`)
    }
    return { slug: s.entry.slug, reason: sentence(parts) }
  })
}

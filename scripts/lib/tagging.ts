import { createHash } from 'node:crypto'
import type { Course, MoodClaim } from '../../src/lib/entry.js'
import { MOOD_TAGS, type MoodTag } from '../../src/lib/moods.js'
import { MEALS, type Meal } from '../../src/lib/types.js'

export const TAGGING_MODEL = 'claude-sonnet-5-5'

const DIETARY_KEYS = ['vegetarianFriendly', 'veganFriendly', 'glutenFreeFriendly'] as const

export type DietaryKey = (typeof DIETARY_KEYS)[number]

export interface DietaryClaim {
  value: boolean
  evidence: string
}

export interface MenuTagging {
  courses: Course[]
  moods: MoodClaim[]
  dietary: Partial<Record<DietaryKey, DietaryClaim>>
  blurb: string
}

const KNOWN_MOODS: ReadonlySet<string> = new Set<string>(MOOD_TAGS)
const KNOWN_DIETARY: ReadonlySet<string> = new Set<string>(DIETARY_KEYS)
const KNOWN_MEALS: ReadonlySet<string> = new Set<string>(MEALS)

// PDF text positions each glyph separately, so "saltimbocca" can arrive as "SA LTi M BO C C A".
// Matching therefore ignores whitespace in the menu text.
const MIN_EVIDENCE_SUPPORT = 0.6
const MIN_CONTENT_WORDS = 2
const MIN_CONTENT_WORD_LENGTH = 4
const STOPWORDS: ReadonlySet<string> = new Set([
  'about', 'also', 'and', 'are', 'choice', 'course', 'courses', 'dish', 'dishes', 'each',
  'from', 'have', 'into', 'menu', 'over', 'served', 'style', 'that', 'their', 'them',
  'then', 'there', 'these', 'they', 'this', 'those', 'than', 'under', 'where', 'which',
  'with', 'will', 'your',
])

// Throws on the first problem. The whole response is rejected, never partly kept.
export function validateTagging(raw: unknown): MenuTagging {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('tagging must be a JSON object')
  }
  const record = raw as Record<string, unknown>

  return {
    courses: validateCourses(record.courses),
    moods: validateMoods(record.moods),
    dietary: validateDietary(record.dietary),
    blurb: validateBlurb(record.blurb),
  }
}

// Returns each evidence quote that the menu text does not support.
export function evidenceAppearsIn(menuText: string, tagging: MenuTagging): string[] {
  const menu = normalizeForMatch(menuText)
  const quotes = [
    ...tagging.moods.map((mood) => mood.evidence),
    ...DIETARY_KEYS.flatMap((key) => {
      const claim = tagging.dietary[key]
      return claim ? [claim.evidence] : []
    }),
  ]
  return quotes.filter((quote) => !isSupported(quote, menu))
}

export function taggingCacheKey(
  menuText: string,
  model: string = TAGGING_MODEL,
  prompt: string = TAGGING_SYSTEM_PROMPT,
): string {
  return createHash('sha256').update(JSON.stringify([model, prompt, menuText])).digest('hex')
}

function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '')
}

function isSupported(quote: string, normalizedMenu: string): boolean {
  const contentWords = quote
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((word) => word.length >= MIN_CONTENT_WORD_LENGTH && !STOPWORDS.has(word))
  if (contentWords.length < MIN_CONTENT_WORDS) return false

  const found = contentWords.filter((word) => normalizedMenu.includes(word)).length
  return found / contentWords.length >= MIN_EVIDENCE_SUPPORT
}

function validateCourses(courses: unknown): Course[] {
  if (!Array.isArray(courses) || courses.length === 0) {
    throw new Error('tagging must contain at least one course')
  }
  const validated = courses.map((course: unknown) => {
    const { name, meal, dishes } = objectOrThrow(course, 'every course must be an object')
    if (typeof name !== 'string' || !name.trim()) throw new Error('every course needs a name')
    if (!Array.isArray(dishes)) throw new Error(`course ${name} needs a dishes array`)
    return {
      name,
      meal: validateMeal(meal, name),
      dishes: dishes.map((dish: unknown) => {
        const d = objectOrThrow(dish, `course ${name} has a dish that is not an object`)
        if (typeof d.name !== 'string' || !d.name.trim()) {
          throw new Error(`course ${name} has a dish with no name`)
        }
        return { name: d.name, description: typeof d.description === 'string' ? d.description : '' }
      }),
    }
  })
  if (!validated.some((course) => course.dishes.length > 0)) {
    throw new Error('tagging needs at least one dish')
  }
  return validated
}

function validateMeal(meal: unknown, courseName: string): Meal | null {
  if (meal === null) return null
  if (typeof meal !== 'string' || !KNOWN_MEALS.has(meal)) {
    throw new Error(`course ${courseName} has an unknown meal: ${String(meal)}`)
  }
  return meal as Meal
}

function validateMoods(moods: unknown): MoodClaim[] {
  if (!Array.isArray(moods)) throw new Error('tagging must contain a moods array')
  const seen = new Set<string>()
  return moods.map((mood: unknown) => {
    const { tag, evidence } = objectOrThrow(mood, 'every mood must be an object')
    if (typeof tag !== 'string' || !KNOWN_MOODS.has(tag)) {
      throw new Error(`unknown mood tag: ${String(tag)}`)
    }
    if (seen.has(tag)) throw new Error(`duplicate mood tag: ${tag}`)
    seen.add(tag)
    return { tag: tag as MoodTag, evidence: requireEvidence(evidence, `mood ${tag}`) }
  })
}

function validateDietary(dietary: unknown): MenuTagging['dietary'] {
  if (dietary === undefined) return {}
  const entries = objectOrThrow(dietary, 'dietary must be an object')
  const result: MenuTagging['dietary'] = {}
  for (const [key, claim] of Object.entries(entries)) {
    if (!KNOWN_DIETARY.has(key)) throw new Error(`unknown dietary key: ${key}`)
    const { value, evidence } = objectOrThrow(claim, `dietary ${key} must be an object`)
    if (typeof value !== 'boolean') throw new Error(`dietary ${key} needs a boolean value`)
    result[key as DietaryKey] = { value, evidence: requireEvidence(evidence, `dietary ${key}`) }
  }
  return result
}

function validateBlurb(blurb: unknown): string {
  if (typeof blurb !== 'string' || !blurb.trim()) throw new Error('tagging needs a blurb')
  return blurb
}

function objectOrThrow(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(message)
  return value as Record<string, unknown>
}

function requireEvidence(evidence: unknown, label: string): string {
  if (typeof evidence !== 'string' || evidence.trim().length < 3) {
    throw new Error(`${label} is missing its evidence`)
  }
  return evidence
}

export const TAGGING_SYSTEM_PROMPT = `You read a prix-fixe menu and return structured JSON.

The menu text comes from a PDF that positions each glyph separately, so words
often contain stray spaces inside words, such as "SA LTi M BO C C A" for
"saltimbocca". Read through that spacing. Quote each dish in normal spelling,
correcting that spacing: write "saltimbocca", never "sa lti m bo c c a".

One document often holds several menus at once: a restaurant may serve a $45 lunch
of three courses and a $75 dinner of five, printed one after the other in the same
file. Read it as several menus, not as one long menu.

Return only JSON matching this shape:
{
  "courses": [{ "name": string, "meal": string | null, "dishes": [{ "name": string, "description": string }] }],
  "moods": [{ "tag": string, "evidence": string }],
  "dietary": {
    "vegetarianFriendly": { "value": boolean, "evidence": string },
    "veganFriendly": { "value": boolean, "evidence": string },
    "glutenFreeFriendly": { "value": boolean, "evidence": string }
  },
  "blurb": string
}

"tag" must be one of exactly these values:
${MOOD_TAGS.join(', ')}

Rules:
- Every mood tag must be supported by the menu. Quote the supporting dishes in
  "evidence", in under 12 words, using the dish wording as it appears on the menu.
- Returning few tags is correct. Returning no tags is correct when the menu
  supports none. Do not pad the list.
- Do not invent a tag that is not in the list above.
- In "dietary", include a key only when the menu supports it, and give it
  evidence quoting the menu. Omit any key you cannot support. Do not add a
  dietary key with no evidence.
- "blurb" is one sentence describing the meal, under 20 words.
- A course is a section of the menu a diner picks from, such as Antipasti or
  Dolce. Count a prix-fixe section once even when it offers a choice.
- "meal" says which menu the section belongs to. It must be exactly one of
  ${MEALS.join(', ')}, or null.
- Use the heading, the price and the position of the section to decide. A section
  printed under "$45 LUNCH MENU" is "Lunch"; a section printed under "$75 DINNER
  MENU" further down the same page is "Dinner".
- Give every section of a two-menu document the meal it belongs to. Never give a
  lunch section the dinner meal, or the other way round.
- Use null only when the document never says which meal a section is for. Do not
  guess from the dishes alone.`

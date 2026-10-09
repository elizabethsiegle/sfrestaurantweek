import { describe, expect, it } from 'vitest'
import { MOOD_TAGS } from '../src/lib/moods.js'
import {
  TAGGING_SYSTEM_PROMPT,
  evidenceAppearsIn,
  taggingCacheKey,
  validateTagging,
  type MenuTagging,
} from '../scripts/lib/tagging.js'

const valid = {
  courses: [
    { name: 'Antipasti', meal: 'Dinner', dishes: [{ name: 'Insalata di Indivia', description: 'endive, radicchio, pear' }] },
    { name: 'Dolce', meal: 'Dinner', dishes: [{ name: 'Tiramisu', description: 'espresso soaked ladyfingers' }] },
  ],
  moods: [{ tag: 'date-night', evidence: 'shared antipasti and a whole-fish secondo' }],
  dietary: { vegetarianFriendly: { value: true, evidence: 'endive salad and a squash risotto' } },
  blurb: 'A four course Italian dinner built around autumn vegetables.',
}

const menuText =
  'Antipasti: Insalata di Indivia, endive, radicchio, pear. Secondo: whole fish with lemon. Dolce: Tiramisu, espresso soaked ladyfingers. Each course is served also from the cellar.'

function taggingWith(evidence: string, dietary: unknown = {}): MenuTagging {
  return validateTagging({ ...valid, moods: [{ tag: 'date-night', evidence }], dietary })
}

describe('validateTagging', () => {
  it('accepts a well formed record and preserves it exactly', () => {
    expect(validateTagging(valid)).toEqual(valid)
  })

  it('exposes exactly the ten agreed mood tags', () => {
    expect(MOOD_TAGS).toEqual([
      'date-night',
      'big-group',
      'solo-friendly',
      'business-dinner',
      'celebration',
      'comfort-food',
      'light-and-fresh',
      'adventurous',
      'vegetarian-friendly',
      'pre-theater',
    ])
  })

  it.each([
    'constructor',
    '__proto__',
    'toString',
    'hasOwnProperty',
    'Date-Night',
    ' date-night',
    'date-night ',
    5,
    null,
  ])('rejects mood tag %j as outside the closed vocabulary', (tag) => {
    const invented = { ...valid, moods: [{ tag, evidence: 'candles and wine' }] }
    expect(() => validateTagging(invented)).toThrow(/unknown mood tag/)
  })

  it('rejects the whole record when one mood tag is invented, even if another is valid', () => {
    const mixed = {
      ...valid,
      moods: [
        { tag: 'date-night', evidence: 'shared antipasti and a whole-fish secondo' },
        { tag: 'cozy-vibes', evidence: 'candles' },
      ],
    }
    expect(() => validateTagging(mixed)).toThrow(/unknown mood tag: cozy-vibes/)
  })

  it('rejects the same mood tag twice, even with different evidence', () => {
    const repeated = {
      ...valid,
      moods: [
        { tag: 'date-night', evidence: 'shared antipasti' },
        { tag: 'date-night', evidence: 'whole fish secondo' },
      ],
    }
    expect(() => validateTagging(repeated)).toThrow(/duplicate mood tag: date-night/)
  })

  it.each([
    ['empty', ''],
    ['whitespace only', '   \n\t  '],
    ['one character', 'a'],
    ['two characters', 'ab'],
    ['a number', 5],
    ['null', null],
  ])('rejects mood evidence that is %s', (_label, evidence) => {
    const bad = { ...valid, moods: [{ tag: 'date-night', evidence }] }
    expect(() => validateTagging(bad)).toThrow(/evidence/)
  })

  it('rejects a mood with no evidence key', () => {
    const bare = { ...valid, moods: [{ tag: 'date-night' }] }
    expect(() => validateTagging(bare)).toThrow(/evidence/)
  })

  it('rejects a record with no courses', () => {
    expect(() => validateTagging({ ...valid, courses: [] })).toThrow(/at least one course/)
  })

  it('rejects a course that has no dishes array', () => {
    const noDishes = { ...valid, courses: [{ name: 'Antipasti' }] }
    expect(() => validateTagging(noDishes)).toThrow(/dishes/)
  })

  it('rejects a record whose courses have no dishes at all', () => {
    const emptyDishes = { ...valid, courses: [{ name: 'x', meal: null, dishes: [] }] }
    expect(() => validateTagging(emptyDishes)).toThrow(/at least one dish/)
  })

  it('rejects valid JSON that is not an object', () => {
    expect(() => validateTagging([valid])).toThrow(/must be a JSON object/)
    expect(() => validateTagging('a menu')).toThrow(/must be a JSON object/)
    expect(() => validateTagging(null)).toThrow(/must be a JSON object/)
  })

  it('rejects a dietary claim with no evidence', () => {
    const bare = { ...valid, dietary: { veganFriendly: { value: true, evidence: ' ' } } }
    expect(() => validateTagging(bare)).toThrow(/veganFriendly/)
  })

  it('rejects an unknown dietary key', () => {
    const extra = { ...valid, dietary: { kosher: { value: true, evidence: 'matzo ball soup' } } }
    expect(() => validateTagging(extra)).toThrow(/unknown dietary key: kosher/)
  })

  it('accepts a record with no mood tags at all', () => {
    expect(validateTagging({ ...valid, moods: [] }).moods).toEqual([])
  })

  it('keeps each course with the meal it was attributed to', () => {
    const twoMenus = {
      ...valid,
      courses: [
        { name: 'Antipasti', meal: 'Lunch', dishes: [{ name: 'Insalata', description: 'endive' }] },
        { name: 'Secondi', meal: 'Dinner', dishes: [{ name: 'Branzino', description: 'whole fish' }] },
      ],
    }
    expect(validateTagging(twoMenus).courses.map((c) => c.meal)).toEqual(['Lunch', 'Dinner'])
  })

  it('accepts a null meal for a section the document never attributes', () => {
    const unmarked = { ...valid, courses: [{ name: 'Dolce', meal: null, dishes: [{ name: 'Tiramisu', description: '' }] }] }
    expect(validateTagging(unmarked).courses[0]!.meal).toBeNull()
  })

  it('rejects an unknown meal value', () => {
    const supper = { ...valid, courses: [{ name: 'Dolce', meal: 'Supper', dishes: [{ name: 'Tiramisu', description: '' }] }] }
    expect(() => validateTagging(supper)).toThrow(/unknown meal: Supper/)
  })

  it('rejects a lowercase meal value rather than guessing the case', () => {
    const lower = { ...valid, courses: [{ name: 'Dolce', meal: 'dinner', dishes: [{ name: 'Tiramisu', description: '' }] }] }
    expect(() => validateTagging(lower)).toThrow(/unknown meal: dinner/)
  })

  it('rejects a course with no meal key at all', () => {
    const noMeal = { ...valid, courses: [{ name: 'Dolce', dishes: [{ name: 'Tiramisu', description: '' }] }] }
    expect(() => validateTagging(noMeal)).toThrow(/unknown meal/)
  })

  it('tells the model that one document can hold menus for several meals', () => {
    expect(TAGGING_SYSTEM_PROMPT).toMatch(/several menus/)
    expect(TAGGING_SYSTEM_PROMPT).toMatch(/"meal"/)
    expect(TAGGING_SYSTEM_PROMPT).toContain('Brunch, Lunch, Dinner')
  })
})

describe('evidenceAppearsIn', () => {
  it('returns nothing when the evidence names dishes on the menu', () => {
    const tagging = taggingWith('endive, radicchio and a whole fish secondo')
    expect(evidenceAppearsIn(menuText, tagging)).toEqual([])
  })

  it('reports evidence that names dishes absent from the menu', () => {
    const tagging = taggingWith('lobster bisque with truffle foam')
    expect(evidenceAppearsIn(menuText, tagging)).toEqual(['lobster bisque with truffle foam'])
  })

  it('does not reject evidence because the menu text has stray spaces inside words', () => {
    const spaced = 'Secondo: SA LTi M BO C C A con VE AL.'
    const tagging = taggingWith('saltimbocca veal')
    expect(evidenceAppearsIn(spaced, tagging)).toEqual([])
  })

  it('accepts evidence at exactly the 60 percent threshold', () => {
    // endive, radicchio, pear found; truffle, lobster missing: 3 of 5 content words.
    const tagging = taggingWith('endive radicchio pear truffle lobster')
    expect(evidenceAppearsIn(menuText, tagging)).toEqual([])
  })

  it('reports evidence just below the 60 percent threshold', () => {
    // endive, pear found; truffle, lobster missing: 2 of 4 content words.
    const tagging = taggingWith('endive truffle lobster pear')
    expect(evidenceAppearsIn(menuText, tagging)).toEqual(['endive truffle lobster pear'])
  })

  it('reports evidence with fewer than two content words', () => {
    expect(evidenceAppearsIn(menuText, taggingWith('a fish'))).toEqual(['a fish'])
  })

  it('treats evidence made only of stopwords as unsupported', () => {
    // Every word here is on the menu, so only the stopword filter can reject it.
    const stopwordsOnly = 'each course served also from'
    expect(evidenceAppearsIn(menuText, taggingWith(stopwordsOnly))).toEqual([stopwordsOnly])
  })

  it('tells the model to quote in normal spelling, matching the stray-spacing checker', () => {
    expect(TAGGING_SYSTEM_PROMPT).toMatch(/normal spelling/)
    expect(TAGGING_SYSTEM_PROMPT).toContain('"saltimbocca"')
    expect(TAGGING_SYSTEM_PROMPT).not.toMatch(/do not correct/i)
  })

  it('checks dietary evidence as well as mood evidence', () => {
    const tagging = taggingWith(
      'endive radicchio pear',
      { veganFriendly: { value: true, evidence: 'lobster bisque' } },
    )
    expect(evidenceAppearsIn(menuText, tagging)).toEqual(['lobster bisque'])
  })
})

describe('taggingCacheKey', () => {
  it('is stable for the same menu text, model and prompt', () => {
    expect(taggingCacheKey(menuText)).toBe(taggingCacheKey(menuText))
  })

  it('changes when the menu text changes', () => {
    expect(taggingCacheKey(menuText)).not.toBe(taggingCacheKey(`${menuText} Extra course.`))
  })

  it('changes when the model changes', () => {
    expect(taggingCacheKey(menuText)).not.toBe(taggingCacheKey(menuText, 'another-model'))
  })

  it('changes when the prompt changes', () => {
    expect(taggingCacheKey(menuText)).not.toBe(taggingCacheKey(menuText, undefined, 'a new prompt'))
  })
})

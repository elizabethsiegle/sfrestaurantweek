import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { extractPdfText } from '../scripts/lib/pdf-text.js'
import { isReadableMenuText } from '../scripts/lib/readable.js'

describe('isReadableMenuText', () => {
  it('accepts the 54 Mint fixture after extraction', () => {
    const text = extractPdfText(readFileSync('test/fixtures/menu-54mint.pdf'))
    expect(isReadableMenuText(text)).toBe(true)
  })

  it('accepts a short menu that carries only three menu words', () => {
    const text =
      'Precita Park Oc t o b e r 16 , 2026 th r u Oc t o b e r 25 , 2026 Dungeness Crab Eggs Benedict Crab salad, poac hed egg, hollandaise sauce, ar ugula, c hiv es Cesar Salad Baby R omaine, P ecorino R amano c heese, house-made croutons, egg less Caesar dressing $25'
    expect(isReadableMenuText(text)).toBe(true)
  })

  it('rejects the shifted-letter garbage from pod 12725', () => {
    const garbage =
      '& n q b o b e b  e f  $ i p d m p  z f m m p x  d p s o  q s p w p m p o f  d i f f t f  s j d p u u b'
    expect(isReadableMenuText(garbage)).toBe(false)
  })

  it('rejects the symbol-heavy garbage from pod 12695', () => {
    expect(isReadableMenuText(', ) ! 5 4   2 5 # /  4 / -')).toBe(false)
  })

  it('accepts a tasting menu whose headers use the word list', () => {
    expect(isReadableMenuText('Omakase Hamachi Otoro Uni Ikura Tamago Kanpachi Hirame Sashimi Nigiri')).toBe(true)
  })

  // Deliberate: without menu vocabulary the guard cannot tell a readable
  // names-only menu from garbage. Rejecting it records a failure instead of
  // admitting weak evidence silently.
  it('rejects a names-only tasting menu that has no menu vocabulary', () => {
    expect(isReadableMenuText('Hamachi Otoro Uni Ikura Tamago Kanpachi Hirame Aji Sawara Kohada')).toBe(false)
  })

  it('rejects empty and whitespace-only text', () => {
    expect(isReadableMenuText('')).toBe(false)
    expect(isReadableMenuText('   \n\t  ')).toBe(false)
  })
})

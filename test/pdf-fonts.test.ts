import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseToUnicode } from '../scripts/lib/pdf-fonts.js'
import { extractWithStats } from '../scripts/lib/pdf-text.js'

describe('parseToUnicode', () => {
  it('maps single codes with bfchar', () => {
    const cmap = '1 begincodespacerange <00> <FF> endcodespacerange 2 beginbfchar <21> <0041> <22> <0042> endbfchar'
    const { width, map } = parseToUnicode(cmap)
    expect(width).toBe(1)
    expect(map.get(0x21)).toBe('A')
    expect(map.get(0x22)).toBe('B')
  })

  it('counts up from a single destination in bfrange', () => {
    const cmap = '1 beginbfrange <21> <23> <0061> endbfrange'
    const { map } = parseToUnicode(cmap)
    expect(map.get(0x21)).toBe('a')
    expect(map.get(0x22)).toBe('b')
    expect(map.get(0x23)).toBe('c')
  })

  it('maps each code to its own destination in an array bfrange', () => {
    const cmap = '1 beginbfrange <01> <02> [<0058> <0059>] endbfrange'
    const { map } = parseToUnicode(cmap)
    expect(map.get(0x01)).toBe('X')
    expect(map.get(0x02)).toBe('Y')
  })

  it('skips a bfrange too wide to expand instead of looping over it', () => {
    const cmap = '1 beginbfrange <00000000> <FFFFFFFF> <0041> endbfrange 1 beginbfchar <0001> <0042> endbfchar'
    const { map } = parseToUnicode(cmap)
    expect(map.size).toBe(1)
    expect(map.get(1)).toBe('B')
  })
})

describe('extractWithStats on a custom-encoded menu', () => {
  it('decodes pod 12725, whose raw text is shifted letters, with no dropped glyphs', () => {
    const { text, glyphs, dropped } = extractWithStats(readFileSync('test/fixtures/menu-12725.pdf'))
    expect(text.replace(/\s+/g, '').toUpperCase()).toContain('EMPANADADECHOCLO')
    expect(glyphs).toBeGreaterThan(0)
    expect(dropped).toBe(0)
  })
})

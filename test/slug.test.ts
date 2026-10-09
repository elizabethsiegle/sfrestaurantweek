import { describe, expect, it } from 'vitest'
import { slugify } from '../src/lib/slug.js'

describe('slugify', () => {
  it('folds accents to ascii instead of dropping them', () => {
    expect(slugify('Côte Ouest Bistro')).toBe('cote-ouest-bistro')
    expect(slugify('Caché')).toBe('cache')
  })

  it('keeps the two Mediterranee locations distinct and readable', () => {
    expect(slugify('La Méditerranée (Castro)')).toBe('la-mediterranee-castro')
    expect(slugify('La Méditerranée (Fillmore)')).toBe('la-mediterranee-fillmore')
  })

  it('does not leave leading or trailing separators', () => {
    expect(slugify('  54 Mint!  ')).toBe('54-mint')
  })
})

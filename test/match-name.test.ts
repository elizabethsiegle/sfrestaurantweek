import { describe, expect, it } from 'vitest'
import { matchKey } from '../scripts/lib/match-name.js'

describe('matchKey', () => {
  it('matches across punctuation and case', () => {
    expect(matchKey("Scoma's Restaurant")).toBe(matchKey('Scomas'))
  })

  it('matches across accents', () => {
    expect(matchKey('Côte Ouest Bistro')).toBe(matchKey('Cote Ouest Bistro'))
  })

  it('ignores filler words that differ between sources', () => {
    expect(matchKey('The Cavalier')).toBe(matchKey('Cavalier'))
    expect(matchKey('Gyu-Kaku Japanese BBQ (SF)')).toBe(matchKey('Gyu-Kaku Japanese BBQ'))
  })

  it('keeps genuinely different restaurants apart', () => {
    expect(matchKey('Fiorella Polk')).not.toBe(matchKey('Fiorella Clement'))
    expect(matchKey('La Mediterranee (Castro)')).not.toBe(matchKey('La Mediterranee (Fillmore)'))
  })
})

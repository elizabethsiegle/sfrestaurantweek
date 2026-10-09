import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseListing } from '../scripts/lib/listing.js'

const html = readFileSync('test/fixtures/listing.html', 'utf8')

describe('parseListing', () => {
  const rows = parseListing(html)

  it('reads every participating restaurant', () => {
    expect(rows).toHaveLength(174)
  })

  it('reads the fields of a known restaurant', () => {
    const mint = rows.find((r) => r.name === '54 Mint')!
    expect(mint.slug).toBe('54-mint')
    expect(mint.neighborhood).toBe('Mid Market')
    expect(mint.cuisine).toBe('Italian')
    expect(mint.diningOptions).toEqual(['Takeout', 'Delivery', 'Outdoor Dining', 'Indoor Dining'])
    expect(mint.offers).toEqual([
      { meal: 'Lunch', price: 45 },
      { meal: 'Dinner', price: 75 },
    ])
    expect(mint.menuId).toBe('17051')
    expect(mint.openTableUrl).toContain('opentable.com')
  })

  it('records a null menuId when no menu is published', () => {
    const noMenu = rows.filter((r) => r.menuId === null)
    expect(noMenu.length).toBe(51)
  })

  it('treats an empty data-restaurant-id as no menu, not as an id', () => {
    const lobbyBar = rows.find((r) => r.name === 'Lobby Bar')!
    expect(lobbyBar.menuId).toBeNull()
  })

  it('gives every restaurant at least one prix-fixe offer', () => {
    expect(rows.filter((r) => r.offers.length === 0)).toEqual([])
    expect(rows.reduce((n, r) => n + r.offers.length, 0)).toBe(272)
  })

  it('refuses a page whose prices no longer parse rather than emptying every row', () => {
    const noPrices = html.replace(/(Dinner|Lunch|Brunch) \$\d+/g, 'price on request')
    // Names the price guard specifically: both floors are 150, so a generic
    // match would also pass if the row guard fired instead.
    expect(() => parseListing(noPrices)).toThrow(/price format has probably changed/i)
  })

  it('produces a unique slug for every restaurant', () => {
    expect(new Set(rows.map((r) => r.slug)).size).toBe(rows.length)
  })

  it('refuses a truncated page rather than shipping a short list', () => {
    const truncated = html.slice(0, html.indexOf('data-item-20'))
    expect(() => parseListing(truncated)).toThrow(/expected at least 150/i)
  })
})

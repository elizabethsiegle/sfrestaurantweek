import { parse } from 'node-html-parser'
import { slugify } from '../../src/lib/slug.js'
import type { Meal, Offer, Restaurant } from '../../src/lib/types.js'

const MIN_ROWS = 150
// Offers are dropped individually when they do not parse, so a change to the
// price format would empty every row while the row count stayed healthy. This
// floor turns that silent loss into a failed run. The live page yields 272.
const MIN_OFFERS = 150
const OFFER = /^(Brunch|Lunch|Dinner)\s*\$(\d+)$/

function parseOffer(text: string): Offer | null {
  const m = OFFER.exec(text.trim())
  if (!m) return null
  return { meal: m[1] as Meal, price: Number(m[2]) }
}

// One row (Lobby Bar) carries data-restaurant-id="", a menu link with no menu
// behind it. Treat it as absent, or the fetcher spends a request discovering
// the id is unusable and the restaurant looks menu-bearing in the index.
function parseMenuId(raw: string | undefined): string | null {
  const id = raw?.trim()
  return id ? id : null
}

export function parseListing(html: string): Restaurant[] {
  const root = parse(html)
  const rows = root.querySelectorAll('div[id^="data-item-"]')

  const out: Restaurant[] = []
  for (const row of rows) {
    const name = row.querySelector('.restaurant-list-name')?.text.trim()
    if (!name) continue

    const offers = row
      .querySelectorAll('.restaurant-list-price li')
      .map((li) => parseOffer(li.text))
      .filter((o): o is Offer => o !== null)

    const links = row.querySelectorAll('.restaurant-list-menu a')
    const openTable = links.find((a) => a.getAttribute('href')?.includes('opentable.com'))
    const website = links.find((a) => {
      const href = a.getAttribute('href')
      return href && !href.includes('opentable.com') && href.startsWith('http')
    })

    out.push({
      slug: slugify(name),
      name,
      neighborhood: row.querySelector('.restaurant-list-address')?.text.trim() ?? '',
      cuisine: row.querySelector('.restaurant-list-cuisine')?.text.trim() ?? '',
      diningOptions: row
        .querySelectorAll('.restaurant-list-dining-options li')
        .map((li) => li.text.trim())
        .filter(Boolean),
      offers,
      menuId: parseMenuId(row.querySelector('.openMenuLink')?.getAttribute('data-restaurant-id')),
      openTableUrl: openTable?.getAttribute('href') ?? null,
      websiteUrl: website?.getAttribute('href') ?? null,
    })
  }

  if (out.length < MIN_ROWS) {
    throw new Error(
      `listing parse produced ${out.length} rows, expected at least ${MIN_ROWS}. ` +
        'The page markup has probably changed; re-check the row selectors.',
    )
  }

  const offers = out.reduce((n, r) => n + r.offers.length, 0)
  if (offers < MIN_OFFERS) {
    throw new Error(
      `listing parse produced ${offers} offers, expected at least ${MIN_OFFERS}. ` +
        'The price format has probably changed; re-check the OFFER pattern.',
    )
  }
  return out
}

import { mkdirSync, writeFileSync } from 'node:fs'
import { parseListing } from './lib/listing.js'

const URL_LISTING = 'https://www.sfrestaurantweek.com/restaurants/'

const res = await fetch(URL_LISTING, { headers: { 'User-Agent': 'Mozilla/5.0' } })
if (!res.ok) throw new Error(`listing fetch failed: ${res.status} ${res.statusText}`)

const restaurants = parseListing(await res.text())

mkdirSync('data', { recursive: true })
writeFileSync('data/01-restaurants.json', JSON.stringify(restaurants, null, 1))
console.log(`wrote ${restaurants.length} restaurants, ${restaurants.filter((r) => r.menuId).length} with menus`)

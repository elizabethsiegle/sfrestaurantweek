import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { Restaurant } from '../src/lib/types.js'
import { csvRow } from './lib/csv.js'
import { inBayArea, PlacesFatalError, resolvePlace, type Place } from './lib/places.js'

if (!process.env.GOOGLE_MAPS_API_KEY) {
  throw new Error('GOOGLE_MAPS_API_KEY is not set. See .env.example.')
}

const CACHE_DIR = 'data/cache/places'
mkdirSync(CACHE_DIR, { recursive: true })

const restaurants: Restaurant[] = JSON.parse(readFileSync('data/01-restaurants.json', 'utf8'))
const resolved: Record<string, Place> = {}
const errors: string[] = ['slug,name,neighborhood,reason']

let stoppedEarly: string | null = null

for (const r of restaurants) {
  const cachePath = `${CACHE_DIR}/${r.slug}.json`
  if (existsSync(cachePath)) {
    const cached: Place = JSON.parse(readFileSync(cachePath, 'utf8'))
    if (inBayArea(cached.lat, cached.lng)) {
      resolved[r.slug] = cached
      continue
    }
  }

  // After a fatal error every further request would fail the same way, so the run
  // stops calling out. It keeps walking the list to collect the rest of the cache,
  // otherwise a rerun would drop places it had already resolved.
  if (stoppedEarly) continue

  try {
    const place = await resolvePlace(r.name, r.neighborhood)
    if (!place) {
      errors.push(csvRow([r.slug, r.name, r.neighborhood, 'no acceptable match']))
      continue
    }
    writeFileSync(cachePath, JSON.stringify(place, null, 1))
    resolved[r.slug] = place
  } catch (err) {
    if (err instanceof PlacesFatalError) stoppedEarly = (err as Error).message
    errors.push(csvRow([r.slug, r.name, r.neighborhood, (err as Error).message]))
  }
}

writeFileSync('data/03-resolved.json', JSON.stringify(resolved, null, 1))
writeFileSync('data/03-unresolved.csv', errors.join('\n'))
console.log(`resolved ${Object.keys(resolved).length} of ${restaurants.length}, ${errors.length - 1} unresolved`)
if (stoppedEarly) {
  console.error(`stopped early: ${stoppedEarly}`)
  process.exitCode = 1
}

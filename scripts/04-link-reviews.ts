// Only entries whose verification is "distance checked" may be published (see isPublishable).
// Every other label is an unvalidated pair. Re-run this script after data/03-resolved.json changes,
// or data/04-personal.json keeps the old pairs.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { Restaurant } from '../src/lib/types.js'
import { csvRow } from './lib/csv.js'
import { decidePair, type ExportBusiness } from './lib/decide-pair.js'
import { matchKey } from './lib/match-name.js'
import type { PersonalLayer, PersonalPhoto } from './lib/personal.js'
import { parseBizPhotos } from './lib/yelp-media.js'
import type { Place } from './lib/places.js'

const EXPORT_PATH =
  process.env.YELP_EXPORT_PATH ?? '../yelp-map-lizzies-reviews/data/02-resolved.json'
const PLACES_PATH = 'data/03-resolved.json'
// Point this at an unpacked Yelp data export to publish the photos with the reviews.
const MEDIA_DIR = process.env.YELP_MEDIA_DIR
const PHOTO_OUT = 'public/data/photos'
const PERSONAL_PATH = 'data/04-personal.json'

interface ExportEntry extends ExportBusiness {
  visits?: { date: string; rating: number; text: string }[]
  meanRating?: number | null
  yelpUrl?: string | null
}

const restaurants: Restaurant[] = JSON.parse(readFileSync('data/01-restaurants.json', 'utf8'))

if (!existsSync(EXPORT_PATH)) {
  writeFileSync('data/04-personal.json', '{}')
  console.log(`no export at ${EXPORT_PATH}; wrote an empty personal layer`)
  process.exit(0)
}

const placesBySlug: Record<string, Place> = existsSync(PLACES_PATH)
  ? JSON.parse(readFileSync(PLACES_PATH, 'utf8'))
  : {}
if (Object.keys(placesBySlug).length === 0) {
  console.log(`no Places coordinates at ${PLACES_PATH}; distance check skipped for every row`)
}

const exported: { resolved: ExportEntry[] } = JSON.parse(readFileSync(EXPORT_PATH, 'utf8'))

const reviewedByKey = new Map<string, ExportEntry[]>()
for (const business of exported.resolved) {
  if (!business.visits?.length) continue
  const key = matchKey(business.name)
  reviewedByKey.set(key, [...(reviewedByKey.get(key) ?? []), business])
}

// Photos are keyed by the same name match the reviews use.
const photosByKey = new Map<string, { file: string; caption: string }[]>()
const mediaReady = Boolean(MEDIA_DIR) && existsSync(`${MEDIA_DIR}/html/biz_photo.html`)
if (mediaReady) {
  for (const photo of parseBizPhotos(readFileSync(`${MEDIA_DIR}/html/biz_photo.html`, 'utf8'))) {
    const key = matchKey(photo.business)
    photosByKey.set(key, [...(photosByKey.get(key) ?? []), { file: photo.file, caption: photo.caption }])
  }
}

// Without an export this run cannot rebuild the photos, so it must not destroy the
// ones already published. It carries the previous run's list forward untouched and
// leaves the files in place; only a run that can rebuild them clears the directory.
const previous: PersonalLayer = existsSync(PERSONAL_PATH)
  ? JSON.parse(readFileSync(PERSONAL_PATH, 'utf8'))
  : {}
if (mediaReady) {
  rmSync(PHOTO_OUT, { recursive: true, force: true })
} else {
  console.log(
    MEDIA_DIR
      ? `no biz_photo.html under ${MEDIA_DIR}; keeping the photos already published`
      : 'YELP_MEDIA_DIR is not set; keeping the photos already published',
  )
}

function copyPhotos(slug: string, name: string): PersonalPhoto[] {
  if (!mediaReady) return previous[slug]?.photos ?? []
  const found = photosByKey.get(matchKey(name)) ?? []
  const out: PersonalPhoto[] = []
  for (const photo of found) {
    const from = `${MEDIA_DIR}/media/${photo.file}`
    if (!existsSync(from)) continue
    const base = photo.file.split('/').pop()!
    mkdirSync(`${PHOTO_OUT}/${slug}`, { recursive: true })
    copyFileSync(from, `${PHOTO_OUT}/${slug}/${base}`)
    out.push({ src: `/data/photos/${slug}/${base}`, caption: photo.caption })
  }
  return out
}

const personal: PersonalLayer = {}
const matchRows: string[] = [
  csvRow(['slug', 'restaurantWeekName', 'exportName', 'visits', 'meanRating', 'verification']),
]
const rejectedRows: string[] = [csvRow(['slug', 'restaurantWeekName', 'exportName', 'reason'])]

for (const restaurant of restaurants) {
  const candidates = reviewedByKey.get(matchKey(restaurant.name)) ?? []
  if (candidates.length === 0) continue
  if (candidates.length > 1) {
    const names = candidates.map((c) => c.name).join(' | ')
    throw new Error(`"${restaurant.name}" matches several reviewed businesses: ${names}`)
  }

  const [business] = candidates as [ExportEntry]
  const decision = decidePair(restaurant, business, placesBySlug[restaurant.slug])
  if (!decision.linked) {
    rejectedRows.push(csvRow([restaurant.slug, restaurant.name, business.name, decision.reason]))
    continue
  }

  const visits = business.visits ?? []
  personal[restaurant.slug] = {
    rating: business.meanRating ?? null,
    yelpUrl: business.yelpUrl ?? null,
    verification: decision.verification,
    visits: visits.map(({ date, rating, text }) => ({ date, rating, text })),
    photos: copyPhotos(restaurant.slug, restaurant.name),
  }
  matchRows.push(
    csvRow([
      restaurant.slug,
      restaurant.name,
      business.name,
      String(visits.length),
      business.meanRating == null ? '' : String(business.meanRating),
      decision.verification,
    ]),
  )
}

writeFileSync(PERSONAL_PATH, JSON.stringify(personal, null, 1))
writeFileSync('data/04-matches.csv', matchRows.join('\n') + '\n')
writeFileSync('data/04-rejected.csv', rejectedRows.join('\n') + '\n')
const photoCount = Object.values(personal).reduce((n, entry) => n + entry.photos.length, 0)
console.log(
  `linked ${Object.keys(personal).length} restaurants with ${photoCount} photo(s); ` +
    `rejected ${rejectedRows.length - 1}; review data/04-matches.csv by eye`,
)

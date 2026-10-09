export interface Place {
  placeId: string
  formattedAddress: string
  lat: number
  lng: number
}

export class PlacesAuthError extends Error {}

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText'
const FIELD_MASK = 'places.id,places.formattedAddress,places.location'
export const MAX_ERROR_BODY = 200

// Each edge sits past the listing's outer neighborhoods, with a margin.
// East: San Jose reaches about -121.75; Stockton (-121.29) falls outside.
// South: San Jose and Cupertino reach about 37.3; Santa Cruz (36.97) falls outside.
// North: Sausalito and Larkspur reach about 37.9; Napa (38.3) falls outside.
// West: the San Mateo coast (about -122.5) is inside, so this edge is margin only.
const BOUNDS = { minLat: 37.1, maxLat: 38.2, minLng: -122.9, maxLng: -121.6 }

export function inBayArea(lat: number, lng: number): boolean {
  return lat >= BOUNDS.minLat && lat <= BOUNDS.maxLat && lng >= BOUNDS.minLng && lng <= BOUNDS.maxLng
}

interface SearchHit {
  id?: unknown
  formattedAddress?: unknown
  location?: { latitude?: unknown; longitude?: unknown }
}

export function redact(text: string, secret: string): string {
  return secret ? text.replaceAll(secret, '[redacted]') : text
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export async function resolvePlace(
  name: string,
  neighborhood: string,
  fetchImpl: FetchLike = fetch,
  apiKey = process.env.GOOGLE_MAPS_API_KEY ?? '',
): Promise<Place | null> {
  const res = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify({ textQuery: `${name}, ${neighborhood}, San Francisco, CA` }),
  })

  if (!res.ok) {
    const detail = redact(await res.text(), apiKey).slice(0, MAX_ERROR_BODY)
    const message = `places search failed: ${res.status} ${detail}`
    if (res.status === 401 || res.status === 403) {
      throw new PlacesAuthError(`${message}. The key looks wrong or lacks Places API access.`)
    }
    throw new Error(message)
  }

  const hit = ((await res.json()) as { places?: SearchHit[] }).places?.[0]
  if (!hit || typeof hit.id !== 'string' || typeof hit.formattedAddress !== 'string') return null

  const lat = hit.location?.latitude
  const lng = hit.location?.longitude
  if (typeof lat !== 'number' || typeof lng !== 'number') return null
  if (!inBayArea(lat, lng)) return null

  return { placeId: hit.id, formattedAddress: hit.formattedAddress, lat, lng }
}

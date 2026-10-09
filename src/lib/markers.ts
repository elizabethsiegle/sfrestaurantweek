import type { Entry } from './entry.js'

export interface MarkerProperties {
  slug: string
  name: string
  neighborhood: string
  lowestPrice: number
}

export interface FeatureCollection {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    geometry: { type: 'Point'; coordinates: [number, number] }
    properties: MarkerProperties
  }>
}

export function toFeatureCollection(entries: Entry[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: entries
      .filter((e): e is Entry & { lat: number; lng: number } => typeof e.lat === 'number' && typeof e.lng === 'number')
      .map((e) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [e.lng, e.lat] as [number, number] },
        properties: {
          slug: e.slug,
          name: e.name,
          neighborhood: e.neighborhood,
          lowestPrice: Math.min(...e.offers.map((o) => o.price)),
        },
      })),
  }
}

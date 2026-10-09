import type { Restaurant } from '../../src/lib/types.js'
import {
  checkDistance,
  cityMatches,
  type ExportLocation,
  isTrustedLocation,
  MAX_MATCH_DISTANCE_M,
  mayReject,
  type Verification,
  verificationLabel,
} from './match-guard.js'
import type { Place } from './places.js'

export interface ExportBusiness extends ExportLocation {
  name: string
  city?: string | null
}

export type PairDecision = { linked: true; verification: Verification } | { linked: false; reason: string }

export function decidePair(
  restaurant: Restaurant,
  business: ExportBusiness,
  place: Place | undefined,
): PairDecision {
  const neighborhood = restaurant.neighborhood
  const cityFits = cityMatches(neighborhood, business.city)

  if (!cityFits) {
    // The city is derived from the same geocode, so a weak geocode cannot prove the city wrong.
    if (mayReject(business)) {
      return {
        linked: false,
        reason: `export city "${business.city ?? ''}" does not fit listing neighborhood "${neighborhood}"`,
      }
    }
    return {
      linked: true,
      verification: verificationLabel({ check: 'unchecked', trusted: false, neighborhood }),
    }
  }

  const check = checkDistance(business, place)
  if (check === 'rejected') {
    return {
      linked: false,
      reason: `export location is more than ${MAX_MATCH_DISTANCE_M} m from the Places coordinate`,
    }
  }

  return {
    linked: true,
    verification: verificationLabel({
      check,
      trusted: isTrustedLocation(business),
      neighborhood,
    }),
  }
}

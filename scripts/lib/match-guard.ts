import { distanceMeters, type Origin } from '../../src/lib/geo.js'

export const MAX_MATCH_DISTANCE_M = 750
export const SF_CITY = 'sf'
const MIN_TRUSTED_CONFIDENCE = 0.5
// Rejecting discards real review data, so it needs stronger evidence than acceptance. Below this
// bar we cannot prove a pair wrong, so the pair stays linked as unchecked.
export const REJECT_CONFIDENCE = 0.9

// Listing neighborhoods outside San Francisco. Their export city values (for example "peninsula"
// or "eastbay") do not map to SF_CITY, so the city rule is skipped for them. Keep this list in
// step with the site's neighborhood filter. An unlisted out-of-city neighborhood fails closed.
const OUT_OF_CITY_NEIGHBORHOODS: ReadonlySet<string> = new Set([
  'Berkeley',
  'Burlingame',
  'Concord',
  'Cupertino',
  'Emeryville',
  'Larkspur',
  'Mill Valley',
  'San Jose',
  'Sausalito',
])

export interface ExportLocation {
  lat?: number | null
  lng?: number | null
  confidence?: number | null
  unresolvedReason?: string | null
}

export type DistanceCheck = 'passed' | 'rejected' | 'unchecked'

export const VERIFICATION_LABELS = [
  'distance checked',
  'city checked',
  'name only',
  'name and city only, export coordinate unreliable',
  'name only, export coordinate unreliable',
] as const

export type Verification = (typeof VERIFICATION_LABELS)[number]

// Only a passed distance check is publishable. Every other label is an unvalidated pair.
export function isPublishable(verification: Verification): verification is 'distance checked' {
  return verification === 'distance checked'
}

export function appliesCityRule(neighborhood: string): boolean {
  return !OUT_OF_CITY_NEIGHBORHOODS.has(neighborhood)
}

export function cityMatches(neighborhood: string, exportCity: string | null | undefined): boolean {
  if (!appliesCityRule(neighborhood)) return true
  return exportCity === SF_CITY
}

// The export geocoder marks some coordinates as wrong (for example "too-far"), so a
// distance check against them would reject correct matches.
export function isTrustedLocation(
  exported: ExportLocation,
): exported is ExportLocation & { lat: number; lng: number; confidence: number } {
  if (typeof exported.lat !== 'number' || typeof exported.lng !== 'number') return false
  if (exported.unresolvedReason) return false
  return typeof exported.confidence === 'number' && exported.confidence >= MIN_TRUSTED_CONFIDENCE
}

export function mayReject(exported: ExportLocation): boolean {
  return (
    typeof exported.confidence === 'number' &&
    exported.confidence >= REJECT_CONFIDENCE &&
    !exported.unresolvedReason
  )
}

// Places coordinates come from unvalidated JSON, so a bad value must not count as a failed check.
export function checkDistance(exported: ExportLocation, placed: Origin | undefined): DistanceCheck {
  if (!placed || !isTrustedLocation(exported)) return 'unchecked'
  if (!Number.isFinite(placed.lat) || !Number.isFinite(placed.lng)) return 'unchecked'
  const distance = distanceMeters({ lat: exported.lat, lng: exported.lng }, placed)
  if (!Number.isFinite(distance)) return 'unchecked'
  if (distance <= MAX_MATCH_DISTANCE_M) return 'passed'
  return mayReject(exported) ? 'rejected' : 'unchecked'
}

export function verificationLabel(input: {
  check: DistanceCheck
  trusted: boolean
  neighborhood: string
}): Verification {
  if (input.check === 'passed') return 'distance checked'
  const cityRule = appliesCityRule(input.neighborhood)
  if (!input.trusted) {
    return cityRule
      ? 'name and city only, export coordinate unreliable'
      : 'name only, export coordinate unreliable'
  }
  return cityRule ? 'city checked' : 'name only'
}

import { describe, expect, it } from 'vitest'
import { distanceMeters } from '../src/lib/geo.js'
import {
  checkDistance,
  cityMatches,
  isPublishable,
  isTrustedLocation,
  mayReject,
  MAX_MATCH_DISTANCE_M,
  REJECT_CONFIDENCE,
  VERIFICATION_LABELS,
  verificationLabel,
} from '../scripts/lib/match-guard.js'

// Gyu-Kaku in San Mateo, from the yelp export (trusted, confidence 0.998).
const gyuKakuSanMateo = {
  lat: 37.564478,
  lng: -122.322455,
  confidence: 0.9977034919666078,
  unresolvedReason: null,
}
// Approximate Tenderloin point near Polk St, standing in for Restaurant Week's Gyu-Kaku (SF).
const tenderloin = { lat: 37.7826, lng: -122.419 }

// Poesia Cafe by Montgomery BART, from the yelp export (trusted, confidence 0.990).
const poesiaDowntown = {
  lat: 37.7888541,
  lng: -122.4026296,
  confidence: 0.9904887709523373,
  unresolvedReason: null,
}
// Approximate Castro point standing in for Restaurant Week's Poesia.
const castro = { lat: 37.7609, lng: -122.435 }

// Flores at 2030 Union St, from the yelp export (trusted, confidence 0.966).
const floresExport = {
  lat: 37.797612799999996,
  lng: -122.43266190000001,
  confidence: 0.9662851465298127,
  unresolvedReason: null,
}
// Approximate Cow Hollow point near Union St and Fillmore, standing in for Restaurant Week's Flores.
const cowHollow = { lat: 37.7996, lng: -122.4345 }

// Scoma's export coordinate is known bad upstream: confidence 0, no address, unresolvedReason
// "too-far". The coordinate sits about 1.9 km from Scoma's real location at Pier 47.
// The match is correct; the guard must leave it unchecked, not reject it.
const scomaExport = {
  lat: 37.791585,
  lng: -122.414139,
  confidence: 0,
  unresolvedReason: 'too-far',
}
// Approximate Pier 47 point, standing in for a Places coordinate for Scoma's.
const pier47 = { lat: 37.8083, lng: -122.4162 }

// Beretta Divisadero: export coordinate with confidence 0 and unresolvedReason "name-mismatch".
const berettaExport = {
  lat: 37.775894,
  lng: -122.438217,
  confidence: 0,
  unresolvedReason: 'name-mismatch',
}

describe('distanceMeters', () => {
  it('measures the San Mateo to Tenderloin gap as roughly 30 km', () => {
    const meters = distanceMeters(gyuKakuSanMateo, tenderloin)
    expect(meters).toBeGreaterThan(25_000)
    expect(meters).toBeLessThan(35_000)
  })

  it('returns zero for identical points', () => {
    expect(distanceMeters(castro, castro)).toBe(0)
  })
})

describe('isTrustedLocation', () => {
  it('trusts an export coordinate with high confidence and no unresolved reason', () => {
    expect(isTrustedLocation(floresExport)).toBe(true)
  })

  it('distrusts Scoma: confidence 0 and an unresolved reason', () => {
    expect(isTrustedLocation(scomaExport)).toBe(false)
  })

  it('distrusts a confidence below 0.5 even with no unresolved reason', () => {
    expect(isTrustedLocation({ ...floresExport, confidence: 0.4 })).toBe(false)
  })

  it('trusts a confidence of exactly 0.5', () => {
    expect(isTrustedLocation({ ...floresExport, confidence: 0.5 })).toBe(true)
  })

  it('distrusts a coordinate with no confidence', () => {
    expect(isTrustedLocation({ lat: 37.7, lng: -122.4 })).toBe(false)
  })

  it('distrusts a null latitude', () => {
    expect(isTrustedLocation({ ...floresExport, lat: null })).toBe(false)
  })

  it('distrusts an unresolved reason even when confidence is high', () => {
    expect(isTrustedLocation({ ...floresExport, unresolvedReason: 'too-far' })).toBe(false)
  })
})

describe('checkDistance', () => {
  it('rejects the Gyu-Kaku false pair: trusted San Mateo export vs Tenderloin listing', () => {
    expect(checkDistance(gyuKakuSanMateo, tenderloin)).toBe('rejected')
  })

  it('rejects the Poesia false pair: trusted downtown export vs Castro listing', () => {
    expect(checkDistance(poesiaDowntown, castro)).toBe('rejected')
  })

  it('passes the Flores true pair: 2030 Union St vs Cow Hollow', () => {
    expect(checkDistance(floresExport, cowHollow)).toBe('passed')
  })

  it('leaves Scoma unchecked, not rejected, though its coordinate is far from Pier 47', () => {
    expect(distanceMeters(scomaExport, pier47)).toBeGreaterThan(MAX_MATCH_DISTANCE_M)
    expect(checkDistance(scomaExport, pier47)).toBe('unchecked')
  })

  it('leaves Beretta Divisadero unchecked when its export coordinate is untrusted', () => {
    expect(checkDistance(berettaExport, cowHollow)).toBe('unchecked')
  })

  it('is unchecked when no Places coordinate exists for the slug', () => {
    expect(checkDistance(floresExport, undefined)).toBe('unchecked')
  })

  it('is unchecked, not rejected, when the Places latitude is NaN', () => {
    expect(checkDistance(poesiaDowntown, { lat: Number.NaN, lng: -122.435 })).toBe('unchecked')
  })

  it('is unchecked, not rejected, when the Places longitude is missing', () => {
    expect(checkDistance(poesiaDowntown, { lat: 37.7609, lng: undefined as unknown as number })).toBe(
      'unchecked',
    )
  })

  it('is unchecked when the Places latitude is null from unvalidated JSON', () => {
    expect(checkDistance(poesiaDowntown, { lat: null as unknown as number, lng: -122.435 })).toBe(
      'unchecked',
    )
  })
})

describe('cityMatches', () => {
  it('rejects a San Francisco listing whose export business is in the peninsula', () => {
    expect(cityMatches('Tenderloin', 'peninsula')).toBe(false)
  })

  it('accepts a San Francisco listing whose export business is in sf', () => {
    expect(cityMatches('Castro', 'sf')).toBe(true)
  })

  it('does not apply the city rule to an out-of-city neighborhood', () => {
    expect(cityMatches('Burlingame', 'peninsula')).toBe(true)
    expect(cityMatches('San Jose', 'sf')).toBe(true)
  })

  it.each(['Berkeley', 'Emeryville', 'Mill Valley', 'Larkspur'])(
    'does not apply the city rule to %s',
    (neighborhood) => {
      expect(cityMatches(neighborhood, 'eastbay')).toBe(true)
    },
  )

  it('rejects when the export has no city', () => {
    expect(cityMatches('Castro', undefined)).toBe(false)
  })
})

describe('verificationLabel', () => {
  it('says distance checked when the distance check passed', () => {
    expect(
      verificationLabel({ check: 'passed', trusted: true, neighborhood: 'Cow Hollow' }),
    ).toBe('distance checked')
  })

  it('says city checked when the export coordinate is trusted but no Places coordinate exists', () => {
    expect(
      verificationLabel({ check: 'unchecked', trusted: true, neighborhood: 'Cow Hollow' }),
    ).toBe('city checked')
  })

  it('flags an untrusted export coordinate, for Scoma in an SF neighborhood', () => {
    expect(
      verificationLabel({ check: 'unchecked', trusted: false, neighborhood: 'North Beach' }),
    ).toBe('name and city only, export coordinate unreliable')
  })

  it('flags an untrusted export coordinate outside SF, where the city rule is skipped', () => {
    expect(
      verificationLabel({ check: 'unchecked', trusted: false, neighborhood: 'Burlingame' }),
    ).toBe('name only, export coordinate unreliable')
  })

  it('labels a trusted out-of-city pair with no Places coordinate as name only', () => {
    expect(
      verificationLabel({ check: 'unchecked', trusted: true, neighborhood: 'Burlingame' }),
    ).toBe('name only')
  })
})

describe('isPublishable', () => {
  it('publishes only distance checked', () => {
    expect(VERIFICATION_LABELS.filter(isPublishable)).toEqual(['distance checked'])
  })
})

// Amelie's export geocode is the Trade Mart in Brussels (confidence 0.6, city "elsewhere").
// The review text ("$12.50 wine flight at happy hour") describes the Russian Hill wine bar,
// so the coordinate is known wrong upstream. Rejecting on it would drop a correct pair.
const amelieExport = {
  lat: 50.897077599999996,
  lng: 4.342358,
  confidence: 0.6,
  unresolvedReason: null,
}
// Approximate Russian Hill point, standing in for Restaurant Week's Amelie (SF).
const russianHill = { lat: 37.801, lng: -122.419 }

describe('REJECT_CONFIDENCE', () => {
  it('requires a stronger geocode to reject than to trust', () => {
    expect(REJECT_CONFIDENCE).toBeGreaterThan(0.5)
  })

  it('may reject at exactly the threshold', () => {
    expect(mayReject({ ...poesiaDowntown, confidence: REJECT_CONFIDENCE })).toBe(true)
  })

  it('may not reject just below the threshold', () => {
    expect(mayReject({ ...poesiaDowntown, confidence: 0.89 })).toBe(false)
  })

  it('may not reject with an unresolved reason, even at high confidence', () => {
    expect(mayReject({ ...poesiaDowntown, unresolvedReason: 'too-far' })).toBe(false)
  })

  it('leaves Amelie, a wrong geocode at confidence 0.6, unchecked rather than rejected', () => {
    expect(checkDistance(amelieExport, russianHill)).toBe('unchecked')
  })

  it('keeps rejecting Poesia at confidence 0.99 on distance', () => {
    expect(checkDistance(poesiaDowntown, castro)).toBe('rejected')
  })

  it('rejects a far coordinate at exactly the reject threshold', () => {
    expect(checkDistance({ ...poesiaDowntown, confidence: 0.9 }, castro)).toBe('rejected')
  })

  it('does not reject a far coordinate just below the reject threshold', () => {
    expect(checkDistance({ ...poesiaDowntown, confidence: 0.89 }, castro)).toBe('unchecked')
  })
})

describe('checkDistance with a non-finite distance', () => {
  it('is unchecked when a trusted export latitude is NaN', () => {
    expect(checkDistance({ ...floresExport, lat: Number.NaN }, cowHollow)).toBe('unchecked')
  })

  it('is unchecked when a trusted export longitude is Infinity', () => {
    expect(checkDistance({ ...floresExport, lng: Number.POSITIVE_INFINITY }, cowHollow)).toBe(
      'unchecked',
    )
  })
})

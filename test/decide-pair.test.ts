import { describe, expect, it } from 'vitest'
import { decidePair, type ExportBusiness } from '../scripts/lib/decide-pair.js'
import type { Place } from '../scripts/lib/places.js'
import type { Restaurant } from '../src/lib/types.js'

function restaurant(name: string, neighborhood: string): Restaurant {
  return {
    slug: name.toLowerCase().replace(/\W+/g, '-'),
    name,
    neighborhood,
    cuisine: 'Test',
    diningOptions: [],
    offers: [],
    menuId: null,
    openTableUrl: null,
    websiteUrl: null,
  }
}

function place(lat: number, lng: number): Place {
  return { placeId: 'test', formattedAddress: 'test', lat, lng }
}

// Gyu-Kaku in San Mateo, from the yelp export (trusted).
const gyuKakuExport: ExportBusiness = {
  name: 'Gyu-Kaku Japanese BBQ',
  city: 'peninsula',
  lat: 37.564478,
  lng: -122.322455,
  confidence: 0.9977034919666078,
  unresolvedReason: null,
}

// Poesia Cafe by Montgomery BART, from the yelp export (trusted).
const poesiaExport: ExportBusiness = {
  name: 'Poesia Café',
  city: 'sf',
  lat: 37.7888541,
  lng: -122.4026296,
  confidence: 0.9904887709523373,
  unresolvedReason: null,
}

// Scoma's export coordinate is known bad upstream (confidence 0, unresolvedReason "too-far").
const scomaExport: ExportBusiness = {
  name: "Scoma's Restaurant",
  city: 'sf',
  lat: 37.791585,
  lng: -122.414139,
  confidence: 0,
  unresolvedReason: 'too-far',
}

// Flores at 2030 Union St, from the yelp export (trusted).
const floresExport: ExportBusiness = {
  name: 'Flores San Francisco',
  city: 'sf',
  lat: 37.797612799999996,
  lng: -122.43266190000001,
  confidence: 0.9662851465298127,
  unresolvedReason: null,
}

describe('decidePair', () => {
  it('rejects Gyu-Kaku on city, before any distance is considered', () => {
    const decision = decidePair(
      restaurant('Gyu-Kaku Japanese BBQ (SF)', 'Tenderloin'),
      gyuKakuExport,
      place(37.7826, -122.419),
    )
    expect(decision.linked).toBe(false)
    if (!decision.linked) expect(decision.reason).toContain('peninsula')
  })

  it('rejects Poesia on distance once a Places coordinate exists', () => {
    const decision = decidePair(restaurant('Poesia', 'Castro'), poesiaExport, place(37.7609, -122.435))
    expect(decision.linked).toBe(false)
    if (!decision.linked) expect(decision.reason).toContain('750 m')
  })

  it('links Poesia as city checked while no Places coordinate exists', () => {
    expect(decidePair(restaurant('Poesia', 'Castro'), poesiaExport, undefined)).toEqual({
      linked: true,
      verification: 'city checked',
    })
  })

  it('links Scoma unchecked, with the unreliable-coordinate label', () => {
    expect(
      decidePair(restaurant("Scoma's Restaurant", 'North Beach'), scomaExport, place(37.8083, -122.4162)),
    ).toEqual({
      linked: true,
      verification: 'name and city only, export coordinate unreliable',
    })
  })

  it('links Flores as distance checked when the Places coordinate is close', () => {
    expect(
      decidePair(restaurant('Flores', 'Cow Hollow'), floresExport, place(37.7996, -122.4345)),
    ).toEqual({ linked: true, verification: 'distance checked' })
  })

  // Amelie's export geocode (Brussels, confidence 0.6, city "elsewhere") is known wrong: the
  // review text describes the Russian Hill wine bar. Rejecting it would drop a correct pair.
  it('keeps Amelie as unverified rather than rejecting it on a wrong geocode', () => {
    const amelieExport: ExportBusiness = {
      name: 'Amélie',
      city: 'elsewhere',
      lat: 50.897077599999996,
      lng: 4.342358,
      confidence: 0.6,
      unresolvedReason: null,
    }
    expect(decidePair(restaurant('Amelie', 'Russian Hill'), amelieExport, place(37.801, -122.419))).toEqual({
      linked: true,
      verification: 'name and city only, export coordinate unreliable',
    })
  })

  it('still rejects Gyu-Kaku on city at confidence 0.998', () => {
    expect(
      decidePair(restaurant('Gyu-Kaku Japanese BBQ (SF)', 'Tenderloin'), gyuKakuExport, undefined)
        .linked,
    ).toBe(false)
  })

  it('rejects on city at exactly the reject threshold', () => {
    const decision = decidePair(
      restaurant('Gyu-Kaku Japanese BBQ (SF)', 'Tenderloin'),
      { ...gyuKakuExport, confidence: 0.9 },
      undefined,
    )
    expect(decision.linked).toBe(false)
  })
})

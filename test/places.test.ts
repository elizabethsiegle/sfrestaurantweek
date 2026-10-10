import { describe, expect, it } from 'vitest'
import { inBayArea, PlacesAuthError, PlacesFatalError, PlacesQuotaError, resolvePlace } from '../scripts/lib/places.js'

function stubFetch(body: unknown) {
  return async () => new Response(JSON.stringify(body), { status: 200 })
}

describe('inBayArea', () => {
  it('accepts a San Francisco coordinate', () => {
    expect(inBayArea(37.7749, -122.4194)).toBe(true)
  })

  it('rejects a same-named restaurant in another state', () => {
    expect(inBayArea(40.7128, -74.006)).toBe(false)
  })

  it('accepts the outer neighborhoods the listing includes', () => {
    expect(inBayArea(37.32, -122.03)).toBe(true) // Cupertino
    expect(inBayArea(37.34, -121.89)).toBe(true) // San Jose
    expect(inBayArea(37.859, -122.485)).toBe(true) // Sausalito
    expect(inBayArea(37.978, -122.031)).toBe(true) // Concord
  })

  it('pins the east edge from both sides', () => {
    expect(inBayArea(37.34, -121.75)).toBe(true) // eastern San Jose, past the old -121.8 edge
    expect(inBayArea(37.96, -121.29)).toBe(false) // Stockton, just past the new -121.6 edge
  })

  it('rejects the cities just outside the area', () => {
    expect(inBayArea(36.974, -122.03)).toBe(false) // Santa Cruz
    expect(inBayArea(38.297, -122.286)).toBe(false) // Napa
    expect(inBayArea(37.957, -121.291)).toBe(false) // Stockton
    expect(inBayArea(38.58, -121.49)).toBe(false) // Sacramento
  })
})

describe('resolvePlace', () => {
  it('treats an expired key as fatal, not as one unresolved row', async () => {
    const expired = async () =>
      new Response(
        JSON.stringify({
          error: { code: 400, message: 'API key expired. Please renew the API key.', status: 'INVALID_ARGUMENT' },
        }),
        { status: 400 },
      )

    await expect(resolvePlace('54 Mint', 'Mid Market', expired, 'k')).rejects.toBeInstanceOf(
      PlacesAuthError,
    )
  })

  it('treats a spent quota as fatal, so the run stops instead of burning the list', async () => {
    const exhausted = async () =>
      new Response(
        JSON.stringify({ error: { code: 429, message: "Quota exceeded for quota metric 'SearchTextRequest'" } }),
        { status: 429 },
      )

    const failure = resolvePlace('54 Mint', 'Mid Market', exhausted, 'k')
    await expect(failure).rejects.toBeInstanceOf(PlacesQuotaError)
    await expect(failure).rejects.toBeInstanceOf(PlacesFatalError)
  })

  it('keeps an unrelated 400 as an ordinary per-row error', async () => {
    const badRequest = async () =>
      new Response(JSON.stringify({ error: { code: 400, message: 'textQuery is required' } }), {
        status: 400,
      })

    const failure = resolvePlace('54 Mint', 'Mid Market', badRequest, 'k')
    await expect(failure).rejects.toThrow('places search failed: 400')
    await expect(failure).rejects.not.toBeInstanceOf(PlacesFatalError)
  })

  it('keeps only place id, address and coordinates', async () => {
    const place = await resolvePlace('54 Mint', 'Mid Market', stubFetch({
      places: [{
        id: 'ChIJtest',
        formattedAddress: '16 Mint Plaza, San Francisco, CA 94103, USA',
        location: { latitude: 37.7825, longitude: -122.4094 },
        rating: 4.4,
        priceLevel: 'PRICE_LEVEL_MODERATE',
      }],
    }))

    expect(place).toEqual({
      placeId: 'ChIJtest',
      formattedAddress: '16 Mint Plaza, San Francisco, CA 94103, USA',
      lat: 37.7825,
      lng: -122.4094,
    })
    expect(JSON.stringify(place)).not.toContain('rating')
    expect(JSON.stringify(place)).not.toContain('priceLevel')
  })

  it('sends a POST with the exact field mask', async () => {
    let captured: RequestInit | undefined
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      captured = init
      return new Response(JSON.stringify({ places: [] }), { status: 200 })
    }

    await resolvePlace('54 Mint', 'Mid Market', fetchImpl, 'test-key')

    expect(captured?.method).toBe('POST')
    const headers = captured?.headers as Record<string, string>
    expect(headers['X-Goog-FieldMask']).toBe('places.id,places.formattedAddress,places.location')
    expect(headers['X-Goog-Api-Key']).toBe('test-key')
  })

  it('returns null rather than a wrong pin when the match is outside the Bay Area', async () => {
    const place = await resolvePlace('Amelie', 'Russian Hill', stubFetch({
      places: [{
        id: 'ChIJparis',
        formattedAddress: '24 Rue Example, Paris, France',
        location: { latitude: 48.8566, longitude: 2.3522 },
      }],
    }))
    expect(place).toBeNull()
  })

  it('returns null when the hit has no location object', async () => {
    const place = await resolvePlace('Amelie', 'Russian Hill', stubFetch({
      places: [{ id: 'ChIJnoloc', formattedAddress: '1 Example St, San Francisco, CA, USA' }],
    }))
    expect(place).toBeNull()
  })

  it('returns null when the hit has no id or address', async () => {
    const place = await resolvePlace('Amelie', 'Russian Hill', stubFetch({
      places: [{ formattedAddress: '1 Example St, San Francisco, CA, USA', location: { latitude: 37.8, longitude: -122.4 } }],
    }))
    expect(place).toBeNull()
  })

  it('returns null when the search finds nothing', async () => {
    expect(await resolvePlace('Nowhere', 'Nowhere', stubFetch({ places: [] }))).toBeNull()
  })

  it('throws with the response body when the request fails', async () => {
    const fetchImpl = async () =>
      new Response('{"error":{"message":"Places API (New) has not been used in project 123"}}', { status: 403 })

    const failure = resolvePlace('Amelie', 'Russian Hill', fetchImpl, 'test-key')
    await expect(failure).rejects.toThrow('places search failed: 403')
    await expect(failure).rejects.toThrow('Places API (New) has not been used in project 123')
    await expect(failure).rejects.toBeInstanceOf(PlacesAuthError)
  })

  it('redacts the API key if the error body echoes it', async () => {
    const fetchImpl = async () => new Response('bad key: test-key', { status: 400 })

    const message = await resolvePlace('Amelie', 'Russian Hill', fetchImpl, 'test-key').then(
      () => '',
      (err: Error) => err.message,
    )
    expect(message).toContain('[redacted]')
    expect(message).not.toContain('test-key')
  })

  it('truncates a long response body in the error message', async () => {
    const fetchImpl = async () => new Response('x'.repeat(1000), { status: 500 })

    const error = await resolvePlace('Amelie', 'Russian Hill', fetchImpl).catch((err: Error) => err)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(PlacesAuthError)
    expect((error as Error).message.length).toBeLessThan(250)
  })
})

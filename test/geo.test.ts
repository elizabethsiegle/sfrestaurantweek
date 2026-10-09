import { describe, expect, it } from 'vitest'
import { distanceMeters, requestOrigin, walkMinutes } from '../src/lib/geo.js'

const failingWith = (code: number) =>
  ({
    getCurrentPosition: (_ok: PositionCallback, fail?: PositionErrorCallback) =>
      fail?.({ code, message: 'raw browser text' } as GeolocationPositionError),
  }) as Geolocation

const messageFor = async (code: number): Promise<string> => {
  try {
    await requestOrigin(failingWith(code))
  } catch (err) {
    return (err as Error).message
  }
  throw new Error('expected a rejection')
}

describe('distanceMeters', () => {
  it('is zero for the same point', () => {
    expect(distanceMeters({ lat: 37.7749, lng: -122.4194 }, { lat: 37.7749, lng: -122.4194 })).toBe(0)
  })

  it('measures a known short hop within a few percent', () => {
    const d = distanceMeters({ lat: 37.7749, lng: -122.4194 }, { lat: 37.7849, lng: -122.4194 })
    expect(d).toBeGreaterThan(1050)
    expect(d).toBeLessThan(1170)
  })
})

describe('walkMinutes', () => {
  it('converts metres to whole minutes at walking pace', () => {
    expect(walkMinutes(84)).toBe(1)
    expect(walkMinutes(1400)).toBe(17)
  })

  it('never reports zero minutes for a nonzero distance', () => {
    expect(walkMinutes(10)).toBe(1)
  })

  it('returns 1 for a distance under one minute of walking', () => {
    expect(walkMinutes(0.5)).toBe(1)
    expect(walkMinutes(29)).toBe(1)
  })
})

describe('requestOrigin', () => {
  it('resolves with the browser coordinates', async () => {
    const geo = {
      getCurrentPosition: (ok: PositionCallback) =>
        ok({ coords: { latitude: 37.77, longitude: -122.42 } } as GeolocationPosition),
    } as Geolocation
    await expect(requestOrigin(geo)).resolves.toEqual({ lat: 37.77, lng: -122.42 })
  })

  it('rejects with a readable reason when the person declines', async () => {
    await expect(requestOrigin(failingWith(1))).rejects.toThrow(/location permission was declined/i)
  })

  it('rejects when the browser has no geolocation at all', async () => {
    await expect(requestOrigin(undefined)).rejects.toThrow(/does not support location/i)
  })

  it('tells a declined permission apart from a failed fix', async () => {
    const declined = await messageFor(1)
    const unavailable = await messageFor(2)
    const timedOut = await messageFor(3)
    expect(declined).not.toBe(unavailable)
    expect(unavailable).toBe(timedOut)
    expect(declined).toMatch(/declined/i)
    expect(unavailable).not.toMatch(/declined/i)
  })

  it('never leaks raw browser text, codes or the word geolocation', async () => {
    for (const code of [1, 2, 3]) {
      const message = await messageFor(code)
      expect(message).not.toMatch(/raw browser text|geolocation|code \d/i)
    }
  })

  it('replaces a real Error thrown synchronously with the authored unavailable sentence', async () => {
    const geo = {
      getCurrentPosition: () => {
        throw new Error('Only secure origins are allowed (see: https://goo.gl/Y0ZkNV)')
      },
    } as unknown as Geolocation
    const message = await requestOrigin(geo).then(
      () => '',
      (err: Error) => err.message,
    )
    expect(message).toMatch(/^Location is unavailable right now/)
    expect(message).not.toMatch(/secure origins|goo\.gl/i)
  })

  it('passes a finite timeout so a hanging request cannot spin forever', () => {
    let seen: PositionOptions | undefined
    const geo = {
      getCurrentPosition: (_ok: PositionCallback, _fail?: PositionErrorCallback | null, options?: PositionOptions) => {
        seen = options
      },
    } as Geolocation
    void requestOrigin(geo)
    expect(seen?.timeout).toBeGreaterThan(0)
    expect(seen?.timeout).toBeLessThanOrEqual(30_000)
  })
})

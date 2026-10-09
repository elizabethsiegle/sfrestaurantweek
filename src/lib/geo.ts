export interface Origin {
  lat: number
  lng: number
}

const EARTH_RADIUS_M = 6_371_000
const WALK_METRES_PER_SECOND = 1.4

const toRad = (deg: number) => (deg * Math.PI) / 180

export function distanceMeters(a: Origin, b: Origin): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

export function walkMinutes(meters: number): number {
  if (meters <= 0) return 0
  return Math.max(1, Math.round(meters / WALK_METRES_PER_SECOND / 60))
}

const PERMISSION_DENIED = 1
const DECLINED_MESSAGE =
  'Location permission was declined, so distances are hidden until you allow it in your browser settings and press Near me again.'
const UNAVAILABLE_MESSAGE = 'Location is unavailable right now, so distances are hidden. Try again in a moment.'

export function requestOrigin(geo: Geolocation | undefined): Promise<Origin> {
  if (!geo) return Promise.reject(new Error('This browser does not support location.'))

  return new Promise((resolve, reject) => {
    try {
      geo.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        (err) => reject(new Error(err.code === PERMISSION_DENIED ? DECLINED_MESSAGE : UNAVAILABLE_MESSAGE)),
        { timeout: 10_000 },
      )
    } catch {
      reject(new Error(UNAVAILABLE_MESSAGE))
    }
  })
}

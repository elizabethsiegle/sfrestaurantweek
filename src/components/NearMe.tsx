import { signal } from '@preact/signals'
import { entries, origin, sort } from '../state/board.js'
import { requestOrigin } from '../lib/geo.js'

export const problem = signal<string | null>(null)
export const busy = signal(false)

export async function locate(geo: Geolocation | undefined): Promise<void> {
  busy.value = true
  problem.value = null
  try {
    origin.value = await requestOrigin(geo)
    if (entries.value.some((e) => e.lat !== null && e.lng !== null)) {
      sort.value = 'distance'
    } else {
      problem.value = 'Got your location, but walking times are not available yet.'
    }
  } catch (err) {
    problem.value = (err as Error).message
  } finally {
    busy.value = false
  }
}

export function NearMe() {
  return (
    <div class="near-me">
      <button type="button" onClick={() => void locate(navigator.geolocation)} disabled={busy.value}>
        {busy.value ? 'Finding you' : 'Near me'}
      </button>
      {problem.value && (
        <p class="near-me__problem" role="status">
          {problem.value}
        </p>
      )}
    </div>
  )
}

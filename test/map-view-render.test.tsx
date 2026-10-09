import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/preact'
import { entries, filters } from '../src/state/board.js'
import { EMPTY_FILTERS } from '../src/lib/filter.js'
import type { Entry } from '../src/lib/entry.js'

vi.mock('maplibre-gl', () => ({
  Map: class {
    on() {}
    remove() {}
    getSource() { return undefined }
  },
  GeoJSONSource: class {},
  setWorkerUrl: () => {},
}))
vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', () => ({ default: '/worker.js' }))
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}))

import { MapView } from '../src/components/MapView.js'

const make = (over: Partial<Entry>): Entry => ({
  slug: 'x', name: 'X', neighborhood: 'Mission', cuisine: 'Italian',
  diningOptions: [], openTableUrl: null, websiteUrl: null,
  offers: [{ meal: 'Dinner', price: 75, courses: 3, dealDelta: 0, medianCourses: 3 }],
  menuCoverage: 'full', moods: [], blurb: null, vegetarianFriendly: false,
  lat: null, lng: null, address: null, personal: null, ...over,
})

beforeEach(() => { filters.value = EMPTY_FILTERS })
afterEach(() => { cleanup(); entries.value = [] })

describe('MapView', () => {
  it('labels the map region for assistive tech', () => {
    entries.value = [make({ lat: 37.78, lng: -122.41 })]
    render(<MapView />)
    expect(screen.getByLabelText('Map of participating restaurants')).toBeTruthy()
  })

  it('says plainly why the map is empty when no restaurant has coordinates', () => {
    entries.value = [make({ slug: 'a' }), make({ slug: 'b' })]
    render(<MapView />)
    expect(screen.getByText(/locations are not available yet/i)).toBeTruthy()
  })

  it('shows no empty-state message once restaurants have coordinates', () => {
    entries.value = [make({ slug: 'a', lat: 37.78, lng: -122.41 })]
    render(<MapView />)
    expect(screen.queryByText(/locations are not available yet/i)).toBeNull()
  })

  it('drops the note within the same mount once an entry gains coordinates', async () => {
    entries.value = [make({ slug: 'a' })]
    render(<MapView />)
    expect(screen.getByText(/locations are not available yet/i)).toBeTruthy()
    entries.value = [make({ slug: 'a', lat: 37.78, lng: -122.41 })]
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  })

  it('says no restaurants match when filters exclude every located entry', () => {
    entries.value = [make({ slug: 'a', neighborhood: 'Mission', lat: 37.78, lng: -122.41 })]
    filters.value = { ...EMPTY_FILTERS, neighborhoods: ['Marina'] }
    render(<MapView />)
    expect(screen.getByText('No restaurants match the current filters.')).toBeTruthy()
  })

  it('says visible restaurants have no location when only hidden ones are located', () => {
    entries.value = [
      make({ slug: 'a', neighborhood: 'Mission' }),
      make({ slug: 'b', neighborhood: 'Marina', lat: 37.8, lng: -122.43 }),
    ]
    filters.value = { ...EMPTY_FILTERS, neighborhoods: ['Mission'] }
    render(<MapView />)
    expect(screen.getByText(/None of these restaurants have a location yet/)).toBeTruthy()
  })
})

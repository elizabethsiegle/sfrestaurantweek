import { useEffect, useRef } from 'preact/hooks'
import { GeoJSONSource, Map as MapLibreMap, setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { entries, visible } from '../state/board.js'
import { toFeatureCollection } from '../lib/markers.js'
import { openDetail } from './DetailCard.js'
import 'maplibre-gl/dist/maplibre-gl.css'
import '../styles/map.css'

// Under a bundler the worker cannot be located from import.meta.url, so give it explicitly.
setWorkerUrl(workerUrl)

const SOURCE = 'restaurants'
const KEY = import.meta.env.VITE_PROTOMAPS_API_KEY as string | undefined

function emptyMessage(visibleCount: number, anyLocated: boolean): string {
  if (!anyLocated) {
    return 'Restaurant locations are not available yet, so there are no pins to show. The list has every restaurant.'
  }
  if (visibleCount === 0) return 'No restaurants match the current filters.'
  return 'None of these restaurants have a location yet. The list has all of them.'
}

export function MapView() {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)

  useEffect(() => {
    if (!container.current || map.current) return

    const instance = new MapLibreMap({
      container: container.current,
      style: KEY
        ? `https://api.protomaps.com/styles/v5/light/en.json?key=${KEY}`
        : {
            version: 8,
            sources: {},
            layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#e9e7e0' } }],
          },
      center: [-122.4194, 37.7749],
      zoom: 12,
    })
    map.current = instance

    instance.on('load', () => {
      instance.addSource(SOURCE, { type: 'geojson', data: toFeatureCollection(visible.value) as never })
      instance.addLayer({
        id: 'pins',
        type: 'circle',
        source: SOURCE,
        paint: {
          'circle-radius': 6,
          'circle-color': '#10261f',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#e3b23c',
        },
      })
      instance.on('click', 'pins', (e) => {
        const slug = e.features?.[0]?.properties?.slug
        if (typeof slug !== 'string') return
        // The list only offers a menu when one was published. A pin must say the
        // same thing rather than report a load failure the visitor cannot clear.
        const entry = entries.value.find((candidate) => candidate.slug === slug)
        if (!entry) return
        void openDetail(entry.slug, entry.name, null, entry.menuCoverage === 'full')
      })
    })

    return () => {
      instance.remove()
      map.current = null
    }
  }, [])

  const features = toFeatureCollection(visible.value)

  useEffect(() => {
    const source = map.current?.getSource(SOURCE) as GeoJSONSource | undefined
    // setData returns a promise in v6. Nothing awaits it, so swallow a rejection
    // rather than leave an unhandled one when the map is torn down mid-update.
    void source?.setData(features as never).catch(() => {})
  }, [visible.value])

  const anyLocated = toFeatureCollection(entries.value).features.length > 0

  return (
    <div class="map-frame">
      <div ref={container} class="map" role="region" aria-label="Map of participating restaurants" />
      {features.features.length === 0 && (
        <p class="map-frame__empty" role="status">
          {emptyMessage(visible.value.length, anyLocated)}
        </p>
      )}
    </div>
  )
}

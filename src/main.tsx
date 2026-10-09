import { render } from 'preact'
import { signal } from '@preact/signals'
import { loadBoard, meta } from './state/board.js'
import { eventStamp } from './lib/stamp.js'
import { SearchBar } from './components/SearchBar.js'
import { FilterChips } from './components/FilterChips.js'
import { Listing } from './components/Listing.js'
import { DetailCard } from './components/DetailCard.js'
import { LoadFailure } from './components/LoadFailure.js'
import { NearMe } from './components/NearMe.js'
import { Suspense, lazy } from 'preact/compat'
import './styles/app.css'

const MapView = lazy(() => import('./components/MapView.js').then((m) => m.MapView))

const showMap = signal(false)

function App() {
  const m = meta.value
  return (
    <>
      <header class="masthead">
        <h1>San Francisco Restaurant Week</h1>
        {m && (
          <p class="masthead__stamp">{eventStamp(m.eventStart, m.eventEnd)}</p>
        )}
        {m && (
          <p class="masthead__counts">
            {m.restaurants} restaurants · {m.withMenus} with published menus · {m.mapped} mapped
          </p>
        )}
      </header>
      <main>
        <SearchBar />
        <NearMe />
        <FilterChips />
        <div class="board">
          <div class="board__toggle" role="group" aria-label="Choose view">
            <button type="button" aria-pressed={!showMap.value} onClick={() => (showMap.value = false)}>
              List
            </button>
            <button type="button" aria-pressed={showMap.value} onClick={() => (showMap.value = true)}>
              Map
            </button>
          </div>
          {showMap.value ? (
            <Suspense fallback={<p class="map-frame__loading" role="status">Loading the map</p>}>
              <MapView />
            </Suspense>
          ) : (
            <Listing />
          )}
        </div>
        <DetailCard />
      </main>
    </>
  )
}

const root = document.getElementById('app')!
try {
  await loadBoard()
  render(<App />, root)
} catch (error) {
  console.error('Could not load the restaurant list', error)
  render(<LoadFailure />, root)
}

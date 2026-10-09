import { signal } from '@preact/signals'
import {
  entries,
  restoreSortAfterShortlist,
  setFilters,
  shortlistReasons,
  showShortlistOrder,
  visible,
} from '../state/board.js'
import { fetchShortlist } from '../lib/shortlist-client.js'

export const SEARCH_PLACEHOLDER = 'italian in the mission under $50'
const MAX_QUERY_LENGTH = 400
const NOTHING_MATCHED = 'Nothing matched that. Showing everything again.'

const shownCount = (n: number) => `${n} ${n === 1 ? 'restaurant' : 'restaurants'} shown.`

export const query = signal('')
export const notice = signal<string | null>(null)
export const busy = signal(false)

// A search that was cleared or replaced while in flight must not write its answer to the board.
let latestSearch = 0

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export async function runSearch(fetchImpl?: FetchLike): Promise<void> {
  const text = query.value.trim()
  if (!text) return

  const mine = ++latestSearch
  busy.value = true
  try {
    const result = await fetchShortlist(text, entries.value, fetchImpl)
    if (mine !== latestSearch) return

    const found = result.picks.length > 0
    shortlistReasons.value = new Map(result.picks.map((p) => [p.slug, p.reason]))
    setFilters({ shortlist: found ? result.picks.map((p) => p.slug) : null })
    if (found) showShortlistOrder()
    else restoreSortAfterShortlist()
    notice.value = found ? [result.notice, shownCount(visible.value.length)].filter(Boolean).join(' ') : NOTHING_MATCHED
  } finally {
    if (mine === latestSearch) busy.value = false
  }
}

export function clearSearch(): void {
  latestSearch++
  busy.value = false
  query.value = ''
  notice.value = null
  shortlistReasons.value = new Map()
  setFilters({ shortlist: null })
  restoreSortAfterShortlist()
}

export function SearchBar() {
  return (
    <form
      class="search"
      onSubmit={(event) => {
        event.preventDefault()
        void runSearch()
      }}
    >
      <label class="search__label" for="search-input">
        What are you in the mood for?
      </label>
      <input
        id="search-input"
        class="search__input"
        maxLength={MAX_QUERY_LENGTH}
        placeholder={SEARCH_PLACEHOLDER}
        value={query.value}
        onInput={(e) => (query.value = (e.target as HTMLInputElement).value)}
      />
      <button type="submit" disabled={busy.value}>
        {busy.value ? 'Thinking' : 'Find me a table'}
      </button>
      <button type="button" onClick={clearSearch}>
        Clear
      </button>
      <p class="search__notice" role="status">
        {notice.value}
      </p>
    </form>
  )
}

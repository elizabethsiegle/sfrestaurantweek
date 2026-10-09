import { cleanup, render, screen, waitFor } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { entries, filters } from '../src/state/board.js'
import { EMPTY_FILTERS } from '../src/lib/filter.js'
import { notice, query, runSearch, SearchBar } from '../src/components/SearchBar.js'
import type { Entry } from '../src/lib/entry.js'

const pasta: Entry = {
  slug: 'pasta', name: 'Pasta Place', neighborhood: 'Marina', cuisine: 'Italian',
  diningOptions: [], openTableUrl: null, websiteUrl: null,
  offers: [{ meal: 'Dinner', price: 45, courses: null, dealDelta: null, medianCourses: null }],
  menuCoverage: 'none', moods: [], blurb: null, vegetarianFriendly: false,
  lat: null, lng: null, address: null, personal: null,
}

afterEach(cleanup)

beforeEach(() => {
  entries.value = [pasta]
  filters.value = EMPTY_FILTERS
  query.value = ''
  notice.value = null
})

describe('SearchBar render', () => {
  it('labels the input and renders the live region before any text exists', () => {
    render(<SearchBar />)
    expect(screen.getByLabelText('What are you in the mood for?')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('announces the count in the same region after a successful search', async () => {
    render(<SearchBar />)
    const region = screen.getByRole('status')
    query.value = 'pasta'
    await runSearch(async () =>
      new Response(JSON.stringify({ picks: [{ slug: 'pasta', reason: 'Pasta.' }] }), { status: 200 }),
    )
    await waitFor(() => expect(region.textContent).toBe('1 restaurant shown.'))
    expect(screen.getByRole('status')).toBe(region)
  })
})

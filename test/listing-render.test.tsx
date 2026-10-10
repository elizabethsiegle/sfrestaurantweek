import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { Listing } from '../src/components/Listing.js'
import { DetailCard, openDetail } from '../src/components/DetailCard.js'
import { FilterChips } from '../src/components/FilterChips.js'
import { LoadFailure } from '../src/components/LoadFailure.js'
import { entries, filters, origin, shortlistReasons } from '../src/state/board.js'
import { EMPTY_FILTERS } from '../src/lib/filter.js'
import type { Entry } from '../src/lib/entry.js'

const make = (over: Partial<Entry>): Entry => ({
  slug: 'x', name: 'X', neighborhood: 'Mission', cuisine: 'Italian',
  diningOptions: [], openTableUrl: null, websiteUrl: null,
  offers: [{ meal: 'Dinner', price: 75, courses: 3, dealDelta: 0, medianCourses: 3 }],
  menuCoverage: 'full', moods: [], blurb: null, vegetarianFriendly: false,
  lat: null, lng: null, address: null, personal: null, ...over,
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

beforeEach(() => {
  filters.value = EMPTY_FILTERS
  origin.value = null
  shortlistReasons.value = new Map()
})

describe('Listing', () => {
  it('states the value comparison in plain words', () => {
    entries.value = [make({ name: 'Four Course', offers: [{ meal: 'Lunch', price: 45, courses: 4, dealDelta: 1, medianCourses: 3 }] })]
    render(<Listing />)
    expect(screen.getByText(/4 courses at \$45/i)).toBeTruthy()
    expect(screen.getByText(/most \$45 lunches are 3/i)).toBeTruthy()
  })

  it('pluralises every meal correctly, including dinner', () => {
    entries.value = [
      make({ slug: 'd', name: 'Dinner Spot', offers: [{ meal: 'Dinner', price: 75, courses: 4, dealDelta: 1, medianCourses: 3 }] }),
      make({ slug: 'b', name: 'Brunch Spot', offers: [{ meal: 'Brunch', price: 35, courses: 3, dealDelta: 0, medianCourses: 3 }] }),
    ]
    render(<Listing />)
    expect(screen.getByText(/most \$75 dinners are 3/i)).toBeTruthy()
    expect(screen.getByText(/most \$35 brunches are 3/i)).toBeTruthy()
    expect(screen.queryByText(/dinneres|brunchs/i)).toBeNull()
  })

  it('says a menu is missing on the one row that lacks it when others have menus', () => {
    entries.value = [
      make({ slug: 'a', name: 'No Menu', menuCoverage: 'none', offers: [{ meal: 'Dinner', price: 60, courses: null, dealDelta: null, medianCourses: null }] }),
      make({ slug: 'b', name: 'Has Menu', menuCoverage: 'full' }),
    ]
    render(<Listing />)
    expect(screen.getAllByText(/menu not available yet/i)).toHaveLength(1)
    expect(screen.queryByText(/menus are not available yet/i)).toBeNull()
  })

  it('shows one notice instead of a line per row when no restaurant has a menu', () => {
    entries.value = [
      make({ slug: 'a', menuCoverage: 'none' }),
      make({ slug: 'b', menuCoverage: 'none' }),
    ]
    render(<Listing />)
    expect(screen.getByText(/menus are not available yet/i)).toBeTruthy()
    expect(screen.queryByText(/^menu not available yet/i)).toBeNull()
  })

  it('shows mood evidence, not just the tag', () => {
    entries.value = [make({ moods: [{ tag: 'date-night', evidence: 'shared antipasti and a whole-fish secondo' }] })]
    render(<Listing />)
    expect(screen.getByTitle(/shared antipasti and a whole-fish secondo/i)).toBeTruthy()
  })

  it('renders mood evidence as text, never as markup', () => {
    const evidence = '<img src=x onerror=alert(1)>'
    entries.value = [make({ moods: [{ tag: 'date-night', evidence }] })]
    const { container } = render(<Listing />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByTitle(evidence).textContent).toBe('Date night')
  })

  it('surfaces a personal review when there is one', () => {
    entries.value = [make({ personal: { rating: 4, yelpUrl: null, excerpt: 'One of my favorites.', text: 'One of my favorites.', visitDate: '2018-11-19T03:17:48+00:00', photos: [] } })]
    render(<Listing />)
    expect(screen.getByText(/one of my favorites/i)).toBeTruthy()
    expect(screen.getByText(/2018/)).toBeTruthy()
  })

  it('hides the long tail of a review behind the dots until they are used', async () => {
    const personal = {
      rating: 5, yelpUrl: null,
      excerpt: 'The tea leaf salad is the reason to come\u2026',
      text: 'The tea leaf salad is the reason to come, and the chili lamb is the reason to come back.',
      visitDate: '2018-11-19T03:17:48+00:00', photos: [],
    }
    entries.value = [make({ personal })]
    render(<Listing />)
    expect(screen.queryByText(/reason to come back/)).toBeNull()

    const open = screen.getByRole('button', { name: /read my whole review/i })
    expect(open.getAttribute('aria-expanded')).toBe('false')
    open.click()
    await waitFor(() => expect(screen.getByText(/reason to come back/)).toBeTruthy())
    expect(screen.getByRole('button', { name: /shorten my review/i })).toBeTruthy()
  })

  it('offers no dots when the review is short and carries no photos', () => {
    const text = 'Short and complete.'
    entries.value = [make({ personal: { rating: 4, yelpUrl: null, excerpt: text, text, visitDate: '2018-11-19T03:17:48+00:00', photos: [] } })]
    render(<Listing />)
    expect(screen.queryByRole('button', { name: /read my whole review/i })).toBeNull()
  })

  it('reveals the photos from the review once expanded, captioned', async () => {
    const text = 'Short and complete.'
    entries.value = [make({
      personal: {
        rating: 4, yelpUrl: null, excerpt: text, text, visitDate: '2018-11-19T03:17:48+00:00',
        photos: [{ src: '/data/photos/x/a.jpg', caption: 'Chili Lamb' }, { src: '/data/photos/x/b.jpg', caption: '' }],
      },
    })]
    const { container } = render(<Listing />)
    expect(container.querySelectorAll('.row__photos img').length).toBe(0)

    screen.getByRole('button', { name: /read my whole review/i }).click()
    await waitFor(() => expect(container.querySelectorAll('.row__photos img').length).toBe(2))
    expect(screen.getByAltText('Chili Lamb')).toBeTruthy()
    // An uncaptioned photo still needs an accessible name.
    expect(screen.getByAltText(/my photo of/i)).toBeTruthy()
  })

  it('renders no quote block when there is no personal review', () => {
    entries.value = [make({ personal: null })]
    const { container } = render(<Listing />)
    expect(container.querySelector('blockquote')).toBeNull()
  })

  it('renders a bespoke empty state when filters match nothing', () => {
    entries.value = [make({ neighborhood: 'Mission' })]
    filters.value = { ...EMPTY_FILTERS, neighborhoods: ['Nowhere'] }
    render(<Listing />)
    expect(screen.getByText(/no dishes match that order yet/i)).toBeTruthy()
  })

  it('says why a restaurant has no walk time once a location is known', () => {
    entries.value = [make({ name: 'Unmapped', lat: null, lng: null })]
    origin.value = { lat: 37.7749, lng: -122.4194 }
    render(<Listing />)
    expect(screen.getByText(/address could not be found/i)).toBeTruthy()
  })

  it('does not nag about a missing address before a location is known', () => {
    entries.value = [make({ name: 'Unmapped', lat: null, lng: null })]
    origin.value = null
    render(<Listing />)
    expect(screen.queryByText(/address could not be found/i)).toBeNull()
  })


  it("renders today's data shape without a chip list, links or stray separators", () => {
    entries.value = [make({
      name: 'Today', menuCoverage: 'none', moods: [], personal: null,
      offers: [{ meal: 'Dinner', price: 60, courses: null, dealDelta: null, medianCourses: null }],
    })]
    const { container } = render(<Listing />)
    expect(container.querySelector('.row__moods')).toBeNull()
    expect(container.querySelector('blockquote')).toBeNull()
    expect(container.querySelector('button')).toBeNull()
    expect(container.querySelector('.row__links')).toBeNull()
    expect(container.querySelector('.row__where')!.textContent).toBe('Mission · Italian')
    expect(screen.getByText('Dinner $60')).toBeTruthy()
    expect(screen.getByText(/menus are not available yet/i)).toBeTruthy()
  })

  it('renders no empty chip list for a full menu with no moods', () => {
    entries.value = [make({ menuCoverage: 'full', moods: [] })]
    const { container } = render(<Listing />)
    expect(container.querySelector('.row__moods')).toBeNull()
  })

  it('renders each offer as its own list item', () => {
    entries.value = [make({ offers: [
      { meal: 'Lunch', price: 45, courses: null, dealDelta: null, medianCourses: null },
      { meal: 'Dinner', price: 60, courses: null, dealDelta: null, medianCourses: null },
    ] })]
    const { container } = render(<Listing />)
    expect(container.querySelectorAll('.row__offers > li').length).toBe(2)
  })

  it('uses singular course and star for one', () => {
    entries.value = [make({
      offers: [{ meal: 'Lunch', price: 20, courses: 1, dealDelta: 0, medianCourses: 3 }],
      personal: { rating: 1, yelpUrl: null, excerpt: 'Meh.', text: 'Meh.', visitDate: '2019-05-01T12:00:00+00:00', photos: [] },
    })]
    render(<Listing />)
    expect(screen.getByText(/1 course at \$20\./)).toBeTruthy()
    expect(screen.getByText(/1 star$/)).toBeTruthy()
    expect(screen.queryByText(/1 courses|1 stars/)).toBeNull()
  })

  it('separates the price from the median sentence', () => {
    entries.value = [make({ offers: [{ meal: 'Dinner', price: 75, courses: 4, dealDelta: 1, medianCourses: 3 }] })]
    const { container } = render(<Listing />)
    expect(container.querySelector('.offer')!.textContent).toBe('4 courses at $75. Most $75 dinners are 3.')
  })

  it('renders a fully populated row with every layer', () => {
    entries.value = [make({
      name: 'Full House', lat: 37.7750, lng: -122.4194,
      openTableUrl: 'https://example.com/book', websiteUrl: 'https://example.com',
      offers: [{ meal: 'Dinner', price: 75, courses: 4, dealDelta: 1, medianCourses: 3 }],
      moods: [{ tag: 'date-night', evidence: 'shared plates' }, { tag: 'celebration', evidence: 'tasting menu' }],
      personal: { rating: 4, yelpUrl: null, excerpt: 'Worth it.', text: 'Worth it.', visitDate: '2018-11-19T03:17:48+00:00', photos: [] },
    })]
    origin.value = { lat: 37.7749, lng: -122.4194 }
    shortlistReasons.value = new Map([['x', 'Fits a date night']])
    const { container } = render(<Listing />)
    expect(container.querySelector('.row__walk')!.textContent).toMatch(/^ · \d+ min walk$/)
    expect(container.querySelector('.row__unmapped')).toBeNull()
    expect(container.querySelectorAll('.row__moods > li').length).toBe(2)
    expect(screen.getByText('Fits a date night')).toBeTruthy()
    expect(screen.getByText(/4 courses at \$75\./)).toBeTruthy()
    expect(screen.getByText(/most \$75 dinners are 3/i)).toBeTruthy()
    expect(screen.getByText(/Worth it/)).toBeTruthy()
    expect(container.querySelector('footer')!.textContent).toBe('Lizzie, 2018 · 4 stars')
    expect(screen.getByRole('button', { name: 'See the menu' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Book a table' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Website' })).toBeTruthy()
  })

  it('tells a visitor with no filters that the list is empty, not to loosen a filter', () => {
    entries.value = []
    render(<Listing />)
    expect(screen.getByRole('status').textContent).toMatch(/no restaurants are listed yet/i)
    expect(screen.queryByText(/loosen a filter/i)).toBeNull()
  })

  it('treats an empty shortlist as an active filter', () => {
    entries.value = [make({})]
    filters.value = { ...EMPTY_FILTERS, shortlist: [] }
    render(<Listing />)
    expect(screen.getByText(/loosen a filter/i)).toBeTruthy()
  })
})

describe('FilterChips', () => {
  it('hides the Mood group when no entry carries a mood', () => {
    entries.value = [make({ moods: [] })]
    render(<FilterChips />)
    expect(screen.queryByRole('button', { name: 'Date night' })).toBeNull()
    expect(screen.queryByText('Mood')).toBeNull()
    expect(screen.getByText('Sort')).toBeTruthy()
  })

  it('shows the Mood group once any entry carries a mood', () => {
    entries.value = [make({ moods: [{ tag: 'date-night', evidence: 'shared plates' }] })]
    render(<FilterChips />)
    expect(screen.getByRole('button', { name: 'Date night' })).toBeTruthy()
  })

  it('offers a chip for every meal on the board and none the board does not serve', () => {
    entries.value = [
      make({ slug: 'l', offers: [{ meal: 'Lunch', price: 45, courses: null, dealDelta: null, medianCourses: null }] }),
      make({ slug: 'd' }),
    ]
    render(<FilterChips />)
    expect(screen.getByRole('button', { name: 'Lunch' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Dinner' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Brunch' })).toBeNull()
  })

  it('caps the price tiers below the dearest offer, which would filter nothing', () => {
    entries.value = [
      make({ slug: 'a', offers: [{ meal: 'Lunch', price: 45, courses: null, dealDelta: null, medianCourses: null }] }),
      make({ slug: 'b' }),
    ]
    render(<FilterChips />)
    expect(screen.getByRole('button', { name: '$45 or less' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '$75 or less' })).toBeNull()
  })

  it('hides the Price group when every offer costs the same', () => {
    entries.value = [make({ slug: 'a' }), make({ slug: 'b' })]
    render(<FilterChips />)
    expect(screen.queryByText('Price')).toBeNull()
  })

  it('sets and clears the price cap from one chip', () => {
    entries.value = [
      make({ slug: 'a', offers: [{ meal: 'Lunch', price: 45, courses: null, dealDelta: null, medianCourses: null }] }),
      make({ slug: 'b' }),
    ]
    render(<FilterChips />)
    const chip = screen.getByRole('button', { name: '$45 or less' })
    fireEvent.click(chip)
    expect(filters.value.maxPrice).toBe(45)
    fireEvent.click(chip)
    expect(filters.value.maxPrice).toBeNull()
  })

  it('lists the cuisines on the board and narrows on the chosen one', () => {
    entries.value = [make({ slug: 'a', cuisine: 'Italian' }), make({ slug: 'b', cuisine: 'Burmese' })]
    render(<FilterChips />)
    const select = screen.getByLabelText('Cuisine') as HTMLSelectElement
    expect([...select.options].map((o) => o.value)).toEqual(['Burmese', 'Italian'])
    select.options[0]!.selected = true
    fireEvent.change(select)
    expect(filters.value.cuisines).toEqual(['Burmese'])
  })

  it('offers a dining option chip only for options the board carries', () => {
    entries.value = [make({ slug: 'a', diningOptions: ['Outdoor Dining'] })]
    render(<FilterChips />)
    fireEvent.click(screen.getByRole('button', { name: 'Outdoor Dining' }))
    expect(filters.value.diningOptions).toEqual(['Outdoor Dining'])
    expect(screen.queryByRole('button', { name: 'Takeout' })).toBeNull()
  })

  it('hides the Dining group when no entry lists an option', () => {
    entries.value = [make({ diningOptions: [] })]
    render(<FilterChips />)
    expect(screen.queryByText('Dining')).toBeNull()
  })

  it('keeps the vegetarian chip out of the Dining group, where the Dietary group answers it', () => {
    entries.value = [make({ diningOptions: ['Vegetarian Options'], vegetarianFriendly: true })]
    render(<FilterChips />)
    expect(screen.queryByText('Dining')).toBeNull()
    expect(screen.getByText('Dietary')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Vegetarian friendly' }))
    expect(filters.value.vegetarianOnly).toBe(true)
  })

  it('hides the Dietary group while no entry is vegetarian friendly', () => {
    entries.value = [make({ vegetarianFriendly: false })]
    render(<FilterChips />)
    expect(screen.queryByText('Dietary')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Vegetarian friendly' })).toBeNull()
  })

  it("offers the model's order as a sort only while a shortlist is on the board", () => {
    entries.value = [make({})]
    render(<FilterChips />)
    expect(screen.queryByRole('button', { name: 'Top picks' })).toBeNull()
    cleanup()
    filters.value = { ...EMPTY_FILTERS, shortlist: ['x'] }
    render(<FilterChips />)
    expect(screen.getByRole('button', { name: 'Top picks' })).toBeTruthy()
  })
})

describe('LoadFailure', () => {
  it('says the list could not be loaded and suggests a reload', () => {
    render(<LoadFailure />)
    expect(screen.getByRole('alert').textContent).toMatch(/could not be loaded.*reload/i)
  })
})

describe('DetailCard', () => {
  const menu = (dish: string) => ({ ok: true, json: async () => ({ courses: [{ name: 'Starter', dishes: [{ name: dish, description: '' }] }] }) })
  const deferred = <T,>() => {
    let resolve!: (value: T) => void
    const promise = new Promise<T>((r) => { resolve = r })
    return { promise, resolve }
  }

  it('says the menu is not published when the file is missing, and does not cache that', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404, json: async () => { throw new Error('not json') } }))
    vi.stubGlobal('fetch', fetchMock)
    render(<DetailCard />)
    await openDetail('ghost', 'Ghost Kitchen')
    // A missing file means no menu was published, which is not a failure the
    // visitor can clear by retrying.
    await waitFor(() => expect(screen.getByText(/menu not available yet/i)).toBeTruthy())
    expect(screen.queryByText(/could not load this menu/i)).toBeNull()
    await openDetail('ghost', 'Ghost Kitchen')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('still reports a real transport failure as one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })))
    render(<DetailCard />)
    await openDetail('broken', 'Broken Kitchen')
    await waitFor(() => expect(screen.getByText(/could not load this menu/i)).toBeTruthy())
  })

  it('skips the request entirely when the restaurant published no menu', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<DetailCard />)
    await openDetail('no-menu', 'Astra', null, false)
    await waitFor(() => expect(screen.getByText(/menu not available yet/i)).toBeTruthy())
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('treats a body with no courses list as a failed load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })))
    render(<DetailCard />)
    await openDetail('empty-body', 'Hollow')
    await waitFor(() => expect(screen.getByText(/could not load this menu/i)).toBeTruthy())
  })

  it('says the menu is not available yet for a valid file with no courses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ courses: [] }) })))
    render(<DetailCard />)
    await openDetail('no-courses', 'Bare')
    await waitFor(() => expect(screen.getByText(/menu not available yet/i)).toBeTruthy())
  })

  it('does not refetch the same slug, and a second slug replaces the first', async () => {
    const fetchMock = vi.fn(async (url: string) => menu(url.includes('alpha') ? 'Alpha Dish' : 'Beta Dish'))
    vi.stubGlobal('fetch', fetchMock)
    render(<DetailCard />)

    await openDetail('alpha', 'Alpha')
    await waitFor(() => expect(screen.getByText('Alpha Dish')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await openDetail('alpha', 'Alpha')
    expect(screen.getByText('Alpha Dish')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await openDetail('beta', 'Beta')
    await waitFor(() => expect(screen.getByText('Beta Dish')).toBeTruthy())
    expect(screen.queryByText('Alpha Dish')).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps the last opened menu when an earlier request resolves late', async () => {
    const slowA = deferred<ReturnType<typeof menu>>()
    const fetchMock = vi.fn((url: string) => (url.includes('race-a') ? slowA.promise : Promise.resolve(menu('B Dish'))))
    vi.stubGlobal('fetch', fetchMock)
    render(<DetailCard />)

    const opening = openDetail('race-a', 'Race A')
    await openDetail('race-b', 'Race B')
    await waitFor(() => expect(screen.getByText('B Dish')).toBeTruthy())
    slowA.resolve(menu('A Dish'))
    await opening
    expect(screen.getByText('B Dish')).toBeTruthy()
    expect(screen.queryByText('A Dish')).toBeNull()
  })

  it('moves focus into the card named after the restaurant, closes on Escape and restores focus', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => menu('Focus Dish')))
    entries.value = [make({ slug: 'focus', name: 'Focus Kitchen', menuCoverage: 'full' })]
    render(<><Listing /><DetailCard /></>)

    const button = screen.getByRole('button', { name: 'See the menu' })
    button.focus()
    fireEvent.click(button)
    const dialog = await screen.findByRole('dialog', { name: /focus kitchen/i })
    await waitFor(() => expect(document.activeElement).toBe(dialog))

    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(button)
  })

  it('announces the loading state', async () => {
    const pending = deferred<ReturnType<typeof menu>>()
    vi.stubGlobal('fetch', vi.fn(() => pending.promise))
    render(<DetailCard />)
    void openDetail('loading-slug', 'Loading Place')
    expect((await screen.findByRole('status')).textContent).toMatch(/reading the menu/i)
    pending.resolve(menu('Done'))
    await waitFor(() => expect(screen.getByText('Done')).toBeTruthy())
  })
})
